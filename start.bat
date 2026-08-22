@echo off
title PosturePet Master Controller

echo ===================================================
echo   Cleaning up any old PosturePet background ghosts...
echo ===================================================
taskkill /F /IM python.exe 2>nul
taskkill /F /IM electron.exe 2>nul
taskkill /F /IM node.exe 2>nul
timeout /t 1 /nobreak >nul

echo.
echo Starting fresh PosturePet session...

:: 1. Check and install Node/React dependencies if missing
if not exist "node_modules\" (
    echo First time setup: Installing Node dependencies...
    call npm install
)

:: 2. Check and install Python dependencies if missing
python -c "import cv2, mediapipe, websockets" 2>nul
if errorlevel 1 (
    echo First time setup: Installing Python dependencies...
    pip install opencv-python mediapipe websockets scikit-learn pandas
)

:: 3. Start the Python backend in a background window
start "PosturePet Backend" cmd /k "python detector.py"
timeout /t 2 /nobreak >nul

:: 4. Start the Electron frontend in a background window
start "PosturePet Frontend" cmd /k "npm run electron:dev"

echo.
echo ===================================================
echo   PosturePet is fully running!
echo
echo   TO SHUTDOWN EVERYTHING: Come back to this window
echo   and press ANY KEY on your keyboard.
echo ===================================================
echo.

:: Keep this master window open. Pressing a key triggers cleanup.
pause >nul

echo.
echo Shutting down backend, frontend, and all processes...
taskkill /F /IM python.exe 2>nul
taskkill /F /IM electron.exe 2>nul
taskkill /F /IM node.exe 2>nul

exit