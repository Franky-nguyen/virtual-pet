@echo off
cd /d "%~dp0"

echo 1. Ensuring Python 3.12 is available (numpy^<2 has no Python 3.14 wheels)...
py -3.12 --version >nul 2>&1
if errorlevel 1 (
    echo Python 3.12 not found - downloading it via the py launcher...
    py install 3.12
    if errorlevel 1 (
        echo ERROR: Could not install Python 3.12 automatically.
        echo Install Python 3.12 from https://www.python.org/downloads/ and re-run this script.
        pause
        exit /b 1
    )
)

echo 2. Creating a clean virtual environment for compiling...
if exist build_env rmdir /s /q build_env
py -3.12 -m venv build_env
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment.
    pause
    exit /b 1
)

echo 3. Installing strict dependencies into the clean sandbox...
build_env\Scripts\python.exe -m pip install --upgrade pip
build_env\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Dependency install failed - see output above.
    pause
    exit /b 1
)
build_env\Scripts\python.exe -m pip install pyinstaller
if errorlevel 1 (
    echo ERROR: PyInstaller install failed.
    pause
    exit /b 1
)

echo 4. Compiling Python Detector into a standalone EXE...
if exist detector.exe del /f detector.exe
build_env\Scripts\python.exe -m PyInstaller --onefile --noconsole --clean --collect-all mediapipe --add-data "pose_landmarker_heavy.task;." detector.py
if errorlevel 1 (
    echo ERROR: PyInstaller compile failed - see output above.
    pause
    exit /b 1
)

echo 5. Moving detector.exe to project root and cleaning up sandbox...
move /y dist\detector.exe .
if errorlevel 1 (
    echo ERROR: Could not move detector.exe from dist\ to project root.
    pause
    exit /b 1
)
rmdir /s /q build_env
if exist build rmdir /s /q build

echo 6. Packaging Tauri app + installer (PosturePet 2.0)...
if not exist detector.exe (
    echo ERROR: detector.exe is missing - the Tauri bundle references it as a resource.
    pause
    exit /b 1
)
if not exist pose_landmarker_heavy.task (
    echo ERROR: pose_landmarker_heavy.task is missing - the detector needs it at runtime.
    pause
    exit /b 1
)
call npx tauri build
if errorlevel 1 (
    echo ERROR: Tauri packaging failed - see output above.
    pause
    exit /b 1
)

echo 7. Organizing files and cleaning up heavy build artifacts...
if exist "PosturePet_Installer" rmdir /s /q "PosturePet_Installer"
mkdir PosturePet_Installer
set "NSIS_DIR=src-tauri\target\release\bundle\nsis"
if exist "%NSIS_DIR%\*.exe" (
    copy /y "%NSIS_DIR%\*.exe" PosturePet_Installer\ >nul
) else (
    echo ERROR: No installer produced in %NSIS_DIR%.
    pause
    exit /b 1
)

rem Keep src-tauri\target\release\posture-pet.exe: PosturePet.vbs launches it directly.
rmdir /s /q dist 2>nul
if exist build rmdir /s /q build
if exist build_env rmdir /s /q build_env

echo.
echo ==========================================
echo  SUCCESS! PosturePet 2.0 is ready for GitHub.
echo  Your final Windows installer is in: PosturePet_Installer\
echo  Portable app: src-tauri\target\release\posture-pet.exe
echo ==========================================
pause
