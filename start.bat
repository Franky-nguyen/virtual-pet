@echo off
cd /d "%~dp0"

:: Kill any lingering background processes to prevent zombie locks
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im electron.exe >nul 2>&1

:: Launch the application (Electron spawns and manages detector.py itself,
:: piping any Python crash tracebacks to detector_error.log)
echo Launching PosturePet...
npm run dev
