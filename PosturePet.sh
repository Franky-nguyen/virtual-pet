#!/usr/bin/env bash
# PosturePet 2.0 (Tauri) one-step launcher for Linux and macOS.
# - Sets up Python venv + Node modules automatically on first run.
# - Rebuilds the release binary automatically when sources are newer.
# - Launches the compiled release application cleanly.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

OS_NAME="$(uname -s)"
RELEASE_BIN="$ROOT_DIR/src-tauri/target/release/posture-pet"

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
  echo "ERROR: Node.js and npm are required to run PosturePet from source."
  echo "Install Node.js 20+ (e.g., via nvm, Homebrew, or your package manager) and retry."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: Rust (cargo) was not found."
  echo "Install Rust from https://rustup.rs: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi

# 1. Ensure Node dependencies exist
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Installing Node.js dependencies..."
  npm install
fi

# 2. Ensure Python virtualenv exists for camera posture detection (unless ./detector exists)
if [ ! -x "$ROOT_DIR/detector" ] && [ ! -x "$ROOT_DIR/venv/bin/python3" ] && [ ! -x "$ROOT_DIR/venv/bin/python" ]; then
  if PY_CMD="$(pick_python)"; then
    PY_VER="$("$PY_CMD" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    echo "Creating Python virtual environment with $PY_CMD (v$PY_VER)..."
    if "$PY_CMD" -c 'import sys; sys.exit(0 if sys.version_info < (3, 13) else 1)'; then
      "$PY_CMD" -m venv "$ROOT_DIR/venv"
      "$ROOT_DIR/venv/bin/python" -m pip install --upgrade pip
      "$ROOT_DIR/venv/bin/python" -m pip install -r "$ROOT_DIR/requirements.txt"
    else
      echo "WARNING: Python $PY_VER detected; numpy<2 prefers Python 3.10-3.12."
      echo "Attempting install anyway (Wellness Mode remains available if MediaPipe install fails)..."
      "$PY_CMD" -m venv "$ROOT_DIR/venv" || true
      "$ROOT_DIR/venv/bin/python" -m pip install --upgrade pip || true
      "$ROOT_DIR/venv/bin/python" -m pip install -r "$ROOT_DIR/requirements.txt" || true
    fi
  else
    echo "WARNING: Python 3 not found. PosturePet will launch in Wellness Mode only until Python 3 is installed."
  fi
fi

# 3. Rebuild release binary if missing or stale
needs_build=0
if [ ! -x "$RELEASE_BIN" ]; then
  needs_build=1
else
  for dir in src src-tauri/src src-tauri/icons public; do
    if [ -d "$ROOT_DIR/$dir" ] && [ -n "$(find "$ROOT_DIR/$dir" -type f -newer "$RELEASE_BIN" -print -quit 2>/dev/null)" ]; then
      needs_build=1
      break
    fi
  done

  if [ "$needs_build" -eq 0 ]; then
    for cfg in \
      package.json \
      index.html \
      vite.config.ts \
      tailwind.config.js \
      tsconfig.json \
      src-tauri/tauri.conf.json \
      src-tauri/tauri.linux.conf.json \
      src-tauri/tauri.macos.conf.json \
      src-tauri/Cargo.toml \
      src-tauri/build.rs; do
      if [ -f "$ROOT_DIR/$cfg" ] && [ "$ROOT_DIR/$cfg" -nt "$RELEASE_BIN" ]; then
        needs_build=1
        break
      fi
    done
  fi
fi

if [ "$needs_build" -eq 1 ]; then
  echo "Building PosturePet 2.0 release binary (first build may take a few minutes)..."
  npx tauri build --no-bundle
fi

if [ ! -x "$RELEASE_BIN" ]; then
  echo "ERROR: Compiled binary not found at $RELEASE_BIN"
  exit 1
fi

echo "Launching PosturePet 2.0..."
if [ "$OS_NAME" = "Darwin" ] && [ "${1:-}" != "--foreground" ]; then
  nohup "$RELEASE_BIN" >/tmp/posture-pet.log 2>&1 &
  disown 2>/dev/null || true
elif [ "${1:-}" = "--foreground" ]; then
  exec "$RELEASE_BIN"
else
  nohup "$RELEASE_BIN" >/tmp/posture-pet.log 2>&1 &
  disown 2>/dev/null || true
fi
