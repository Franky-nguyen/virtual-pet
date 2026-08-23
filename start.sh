#!/bin/bash
# PosturePet launcher — macOS / Linux
# One-click setup: inspects the machine, installs anything missing on first
# run, then launches the app.

echo "🐾 Preparing PosturePet for Mac/Linux..."

# Gracefully stop any leftover PosturePet processes so the detector never has
# to fight over port 8765 (a stale backend would silently win the race).
pkill -f "detector.py" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

# Resolve the OS-appropriate Python interpreter: macOS/Linux ship `python3`.
PYTHON=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON="python"
else
  echo "✗ Python 3 not found — install it from https://www.python.org/downloads/"
  exit 1
fi

# Reuse the project virtualenv when present so pip dependencies stay isolated.
if [ -d "venv" ]; then
  echo "Using existing virtual environment (venv)..."
  source venv/bin/activate
  PYTHON="python"
fi

# Verify pip is available for the interpreter we will actually use.
if ! "$PYTHON" -m pip --version >/dev/null 2>&1; then
  echo "✗ pip not found for $PYTHON — install it with: $PYTHON -m ensurepip --upgrade"
  exit 1
fi

# Check Node.js / npm.
if ! command -v npm >/dev/null 2>&1; then
  echo "✗ Node.js not found — install it from https://nodejs.org/"
  exit 1
fi

# Install Node dependencies (first run = automatic setup).
if [ ! -d "node_modules" ]; then
  echo "Installing Node modules..."
  npm install
fi

# Install Python dependencies (first run = automatic setup).
echo "Installing Python requirements..."
"$PYTHON" -m pip install -q -r requirements.txt

# Start the posture detector in the background, then launch Electron.
echo "Starting posture detection server..."
"$PYTHON" detector.py &
PYTHON_PID=$!
trap 'kill $PYTHON_PID 2>/dev/null; pkill -f "detector.py" 2>/dev/null; exit' EXIT INT TERM

# Give the detector a moment to bind port 8765 before Electron connects.
sleep 2

# Launch the app (Electron + Vite dev servers)
echo "Launching PosturePet..."
npm run electron:dev
