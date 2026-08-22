#!/bin/bash

# PosturePet Launcher Script

echo "🦊 Starting PosturePet..."
echo ""

# Check if Python virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python -m venv venv
fi

# Activate virtual environment
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -q -r requirements.txt

# Start Python posture detector in background
echo "Starting posture detection server..."
python detector.py &
PYTHON_PID=$!

# Wait for server to start
sleep 2

# Start Electron app
echo "Starting Electron app..."
npm run electron:dev

# Cleanup on exit
trap "kill $PYTHON_PID 2>/dev/null" EXIT
