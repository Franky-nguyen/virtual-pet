# PosturePet 2.0

A desktop virtual pet and posture companion built with **React**, **TypeScript**, **Tauri 2**, and **Python (MediaPipe + OpenCV)**.

Sit upright to keep your pet healthy and earn XP toward evolutions and wardrobe accessories, or switch to **Wellness Mode** for camera-free Pomodoro check-ins and posture breaks. Track posture & work history in the dashboard stats modal and honor past pets in the Digital Pet Graveyard.

---

## Table of Contents

- [Installing Pre-Built Releases](#installing-pre-built-releases)
  - [Windows (`.exe`)](#windows-exe)
  - [macOS (`.dmg` / `.app`)](#macos-dmg--app)
  - [Linux (`.deb` / `.rpm` / `.AppImage`)](#linux-deb--rpm--appimage)
- [Running from Source](#running-from-source)
- [Building Installers Locally](#building-installers-locally)
- [Building Installers for All OSes via GitHub Actions](#building-installers-for-all-oses-via-github-actions)
- [System Prerequisites by OS](#system-prerequisites-by-os)
- [Troubleshooting (Linux & macOS)](#troubleshooting-linux--macos)

---

## Installing Pre-Built Releases

> **Note:** Each OS needs its native installer built on that OS (see [GitHub Actions](#building-installers-for-all-oses-via-github-actions) if you are generating macOS/Linux installers from a Windows machine).

### Windows (`.exe`)
1. Download the `PosturePet 2.0_x64-setup.exe` NSIS installer (or grab it from `PosturePet_Installer/`).
2. Double-click the installer (current-user install, no admin prompt required).
3. If Windows SmartScreen warns on an unsigned build, click **More info** -> **Run anyway**.
4. Launch **PosturePet 2.0** from the Start Menu.

### macOS (`.dmg` / `.app`)
1. Download the `.dmg` installer (or the `-macOS.zip` archive).
2. Open the `.dmg` and drag **PosturePet 2.0** into **Applications** (or unzip and move `PosturePet 2.0.app` into `/Applications`).
3. **First launch (unsigned Gatekeeper bypass):**
   If macOS says the app cannot be opened or is from an unidentified developer, clear the quarantine attribute in Terminal:
   ```bash
   xattr -cr "/Applications/PosturePet 2.0.app"
   ```
   Alternatively: **Right-click -> Open**, or allow it in **System Settings -> Privacy & Security -> Open Anyway**.
4. When prompted on first launch, grant **Camera** permission in **System Settings -> Privacy & Security -> Camera** (or toggle **Wellness Mode** inside the app if you don't want webcam tracking).
5. Global hide/show shortcut on macOS: `Ctrl+Option+H` or `Cmd+Option+H`.

### Linux (`.deb` / `.rpm` / `.AppImage`)
1. Download the package matching your distro (quote the filename or press `Tab` to autocomplete if it contains spaces):
   - **Ubuntu / Debian / Pop!_OS / Mint (`.deb`)**:
     ```bash
     sudo apt update
     sudo apt install "./<downloaded-file>.deb"
     ```
   - **Fedora / RHEL / openSUSE (`.rpm`)**:
     ```bash
     sudo dnf install "./<downloaded-file>.rpm"
     ```
   - **Universal Linux (`.AppImage`)**:
     ```bash
     chmod +x "./<downloaded-file>.AppImage"
     "./<downloaded-file>.AppImage"
     ```
     > On Ubuntu 22.04+, AppImage files require `libfuse2`: `sudo apt install libfuse2`.
2. **Webcam permission (if camera does not open):**
   Ensure your user belongs to the `video` group, then log out and back in:
   ```bash
   sudo usermod -aG video "$USER"
   ```
3. Global hide/show shortcut on Linux: `Ctrl+Alt+H`.

---

## Running from Source

Make sure you have installed the [System Prerequisites](#system-prerequisites-by-os) for your OS first.

### Windows
Double-click **`PosturePet.vbs`** in the repository root. It automatically rebuilds the release binary if source files changed and launches `src-tauri\target\release\posture-pet.exe`.

### macOS
1. Open Terminal in the repository folder and make the launcher scripts executable:
   ```bash
   chmod +x PosturePet.sh PosturePet.command build-installer.sh
   ```
2. Double-click **`PosturePet.command`** in Finder (or run `npm run start:unix` / `bash ./PosturePet.sh`).

### Linux
Open a terminal in the repository folder and run:
```bash
chmod +x PosturePet.sh PosturePet.command build-installer.sh
bash ./PosturePet.sh
```
Or via npm:
```bash
npm run start:unix
```

On first run, `PosturePet.sh` automatically:
1. Installs Node.js dependencies (`node_modules/`).
2. Creates a Python `venv/` (preferring Python 3.10–3.12 for `numpy<2` + MediaPipe) and installs `requirements.txt`.
3. Builds `src-tauri/target/release/posture-pet` whenever sources/icons/configs are newer than the binary.
4. Launches the app cleanly.

---

## Building Installers Locally

Each installer script compiles `detector.py` + `pose_landmarker_heavy.task` into a standalone native sidecar executable (`detector.exe` on Windows, `detector` on Linux/macOS) via PyInstaller, bundles the Tauri application, and copies all installers into **`PosturePet_Installer/`**.

- **Windows** (`.exe` NSIS installer):
  ```bat
  build-installer.bat
  ```
  (or `npm run installer:win`)

- **macOS** (`.dmg` + `.app`) and **Linux** (`.deb`, `.rpm`, `.AppImage`):
  ```bash
  chmod +x ./build-installer.sh
  bash ./build-installer.sh
  ```
  (or `npm run installer:unix`)

> Note: On Linux, if `rpmbuild` is not installed, `build-installer.sh` automatically builds `.deb` and `.AppImage` and skips `.rpm` (install `rpm` to generate all three).

---

## Building Installers for All OSes via GitHub Actions

If you are on Windows and want native installers for **macOS** and **Linux** without owning a Mac or Linux PC, this repository includes a ready-to-run workflow at [`.github/workflows/build-installers.yml`](.github/workflows/build-installers.yml):

1. Push the repository to GitHub.
2. Open your repository on GitHub -> **Actions** -> **Build Cross-Platform Installers**.
3. Click **Run workflow** (or push a version tag such as `git tag v2.0.0 && git push --tags`).
4. Once all four build jobs (`windows-latest`, `ubuntu-22.04`, Apple Silicon macOS, Intel macOS) finish, download:
   - `PosturePet-windows-installer` (`.exe`)
   - `PosturePet-macos-arm64-installer` (`.dmg` & `-arm64-macOS.zip`) for Apple Silicon Macs
   - `PosturePet-macos-x64-installer` (`.dmg` & `-x86_64-macOS.zip`) for Intel Macs
   - `PosturePet-linux-installer` (`.deb`, `.rpm`, `.AppImage`)

---

## System Prerequisites by OS

All platforms require:
- **Node.js 20+** and **npm**
- **Rust toolchain** (`cargo` / `rustc` via [rustup.rs](https://rustup.rs))
- **Python 3.10–3.12** (Python 3.12 recommended; `numpy<2` & MediaPipe wheels target up to 3.12. The app also runs without Python in **Wellness Mode**.)

### Ubuntu / Debian
```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libgtk-3-dev \
  libgl1 \
  libglib2.0-0 \
  rpm \
  python3-venv \
  python3-pip
```
Install Rust and Node.js 20+:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Fedora
```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel \
  patchelf \
  rpm-build \
  python3 \
  python3-pip \
  @development-tools
```

### Arch Linux
```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool \
  rpm-tools \
  python \
  python-pip
```

### macOS
1. Install Xcode Command Line Tools:
   ```bash
   xcode-select --install
   ```
2. Install Node.js 20, Python 3.12, and Rust (e.g. via [Homebrew](https://brew.sh)):
   ```bash
   brew install node python@3.12
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

### Windows
- Visual Studio C++ Build Tools (Desktop development with C++)
- Node.js 20+
- Rust via [rustup.rs](https://rustup.rs)
- Python 3.12 (`py -3.12`)

---

## Troubleshooting (Linux & macOS)

- **WebKitGTK rendering / blank or slow window on Linux (NVIDIA / Wayland):**
  Launch with DMA-BUF disabled:
  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 posture-pet
  ```
- **Taskbar widget transparency on Linux:**
  Window transparency requires a running compositor (enabled by default on GNOME, KDE Plasma, and modern desktop environments).
- **Inspecting posture detector logs:**
  If camera posture detection fails to connect, check `detector_error.log`:
  - **Linux:** `~/.local/share/com.posturepet.app/detector_error.log`
  - **macOS:** `~/Library/Application Support/com.posturepet.desktop/detector_error.log`
  - **Windows:** `%APPDATA%\com.posturepet.app\detector_error.log`
- **Testing posture detector standalone:**
  ```bash
  python3 detector.py
  ```
  It downloads `pose_landmarker_heavy.task` to `~/.cache/posturepet/` if the app folder is read-only and serves on `ws://localhost:8765`.
