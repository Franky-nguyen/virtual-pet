#!/usr/bin/env bash
# Build standalone PosturePet 2.0 installers for Linux (.deb, .rpm, .AppImage)
# or macOS (.dmg, .app). Output is placed in PosturePet_Installer/.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

OS_NAME="$(uname -s)"
if [ "$OS_NAME" != "Linux" ] && [ "$OS_NAME" != "Darwin" ]; then
  echo "This script targets Linux and macOS. On Windows, run build-installer.bat instead."
  exit 1
fi

pick_python() {
  for py in python3.12 python3.11 python3.10 python3; do
    if command -v "$py" >/dev/null 2>&1; then
      echo "$py"
      return 0
    fi
  done
  return 1
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node.js 20+ and npm are required."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: Rust (cargo) not found. Install from https://rustup.rs"
  exit 1
fi

echo "1. Finding Python interpreter (Python 3.10-3.12 recommended for numpy<2 + mediapipe)..."
PY_CMD="$(pick_python)" || {
  echo "ERROR: Python 3 is required. Install Python 3.12 and retry."
  exit 1
}
echo "Using: $PY_CMD ($("$PY_CMD" --version))"

if [ ! -f "$ROOT_DIR/pose_landmarker_heavy.task" ]; then
  echo "pose_landmarker_heavy.task missing — downloading MediaPipe pose model..."
  curl -fsSL \
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task" \
    -o "$ROOT_DIR/pose_landmarker_heavy.task"
fi

echo "2. Creating clean virtual environment (build_env)..."
rm -rf build_env build dist
"$PY_CMD" -m venv build_env

echo "3. Installing Python dependencies & PyInstaller..."
build_env/bin/python -m pip install --upgrade pip
build_env/bin/python -m pip install -r requirements.txt pyinstaller

echo "4. Compiling detector.py into standalone native binary..."
rm -f "$ROOT_DIR/detector"
build_env/bin/python -m PyInstaller \
  --onefile \
  --noconsole \
  --clean \
  --collect-all mediapipe \
  --add-data "pose_landmarker_heavy.task:." \
  detector.py

mv -f dist/detector "$ROOT_DIR/detector"
chmod +x "$ROOT_DIR/detector"
rm -rf build_env build

echo "5. Ensuring Node modules are installed..."
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  npm install
fi

echo "6. Packaging Tauri app & native installers..."
TAURI_RESOURCE_CONFIG='{"bundle":{"resources":{"../detector":"detector"}}}'

build_bundle() {
  local target="$1"
  echo "Building ${target} bundle..."
  npx tauri build --bundles "$target" --config "$TAURI_RESOURCE_CONFIG"
}

build_deb_fallback() {
  local bundle_dir="$ROOT_DIR/src-tauri/target/release/bundle"
  local bin_path="$ROOT_DIR/src-tauri/target/release/posture-pet"
  if [ ! -x "$bin_path" ]; then
    echo "Compiled binary missing at $bin_path — building binary with --no-bundle..."
    npx tauri build --no-bundle --config "$TAURI_RESOURCE_CONFIG"
  fi

  local version
  version="$(node -p "require('./package.json').version")"
  local stage="$bundle_dir/deb/posture-pet_${version}_amd64"
  local deb_out="$bundle_dir/deb/posture-pet_${version}_amd64.deb"

  rm -rf "$stage"
  mkdir -p \
    "$stage/DEBIAN" \
    "$stage/usr/bin" \
    "$stage/usr/lib/posture-pet/fixtures" \
    "$stage/usr/share/applications" \
    "$stage/usr/share/icons/hicolor/32x32/apps" \
    "$stage/usr/share/icons/hicolor/128x128/apps" \
    "$stage/usr/share/icons/hicolor/256x256@2/apps"

  cp -f "$bin_path" "$stage/usr/bin/posture-pet"
  chmod 0755 "$stage/usr/bin/posture-pet"

  cp -f "$ROOT_DIR/detector" "$stage/usr/lib/posture-pet/detector"
  chmod 0755 "$stage/usr/lib/posture-pet/detector"
  cp -f "$ROOT_DIR/detector.py" "$stage/usr/lib/posture-pet/detector.py"
  cp -f "$ROOT_DIR/pose_landmarker_heavy.task" "$stage/usr/lib/posture-pet/pose_landmarker_heavy.task"
  if [ -d "$ROOT_DIR/fixtures/mochi-cat-pack" ]; then
    cp -R "$ROOT_DIR/fixtures/mochi-cat-pack" "$stage/usr/lib/posture-pet/fixtures/mochi-cat-pack"
  fi

  cp -f "$ROOT_DIR/src-tauri/icons/32x32.png" "$stage/usr/share/icons/hicolor/32x32/apps/posture-pet.png"
  cp -f "$ROOT_DIR/src-tauri/icons/128x128.png" "$stage/usr/share/icons/hicolor/128x128/apps/posture-pet.png"
  cp -f "$ROOT_DIR/src-tauri/icons/128x128@2x.png" "$stage/usr/share/icons/hicolor/256x256@2/apps/posture-pet.png"

  cat > "$stage/usr/share/applications/posture-pet.desktop" << 'EOF'
[Desktop Entry]
Categories=Utility;
Comment=PosturePet 2.0 — Desktop Virtual Pet & Posture Companion
Exec=posture-pet
Icon=posture-pet
Name=PosturePet 2.0
Terminal=false
Type=Application
EOF

  cat > "$stage/DEBIAN/control" << EOF
Package: posture-pet
Version: ${version}
Architecture: amd64
Maintainer: PosturePet Team <support@posturepet.app>
Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libayatana-appindicator3-1 | libappindicator3-1, librsvg2-2, libgl1, libglib2.0-0
Description: PosturePet 2.0 — Desktop Virtual Pet & Posture Companion
EOF

  dpkg-deb --root-owner-group --build "$stage" "$deb_out"
  rm -rf "$stage"
}

if [ "$OS_NAME" = "Linux" ]; then
  # Keep .deb as the required Linux deliverable. AppImage and RPM tooling can
  # vary by runner/distro, so a failure in either optional format must not
  # prevent the reliable Debian package from being published.
  if ! build_bundle deb; then
    echo "Warning: tauri deb bundler failed — falling back to dpkg-deb packaging..."
  fi

  has_deb=0
  for deb_file in "$ROOT_DIR/src-tauri/target/release/bundle/deb"/*.deb; do
    if [ -e "$deb_file" ]; then
      has_deb=1
      break
    fi
  done
  if [ "$has_deb" -eq 0 ]; then
    build_deb_fallback
  fi

  if command -v rpmbuild >/dev/null 2>&1; then
    if ! build_bundle rpm; then
      echo "Warning: RPM packaging failed — continuing with the .deb and AppImage."
    fi
  else
    echo "Note: rpmbuild not found — skipping .rpm."
  fi

  if ! build_bundle appimage; then
    echo "Warning: AppImage packaging failed — continuing with the .deb package."
  fi
else
  build_bundle "$( [ "$OS_NAME" = "Darwin" ] && echo dmg,app || echo nsis )"
fi

echo "7. Collecting installers in PosturePet_Installer/..."
rm -rf PosturePet_Installer
mkdir -p PosturePet_Installer

BUNDLE_DIR="$ROOT_DIR/src-tauri/target/release/bundle"
copied=0

if [ "$OS_NAME" = "Darwin" ]; then
  for f in "$BUNDLE_DIR"/dmg/*.dmg; do
    [ -e "$f" ] || continue
    cp -f "$f" PosturePet_Installer/
    copied=$((copied + 1))
  done
  for app in "$BUNDLE_DIR"/macos/*.app; do
    [ -d "$app" ] || continue
    cp -R "$app" PosturePet_Installer/
    copied=$((copied + 1))
  done
else
  for subdir in deb rpm appimage; do
    for f in "$BUNDLE_DIR/$subdir"/*; do
      [ -e "$f" ] || continue
      cp -f "$f" PosturePet_Installer/
      copied=$((copied + 1))
    done
  done
fi

rm -rf dist build build_env

if [ "$copied" -eq 0 ]; then
  echo "ERROR: No installer artifacts found under $BUNDLE_DIR"
  exit 1
fi

echo ""
echo "=========================================="
echo " SUCCESS! PosturePet 2.0 installers ready:"
ls -lh PosturePet_Installer/
echo "=========================================="
