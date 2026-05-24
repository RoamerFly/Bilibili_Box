@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   BiliBox Windows Build Script
echo ============================================
echo.

:: Set project root directory
set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

:: Keep a single Tauri build output directory.
set "TAURI_RELEASE_DIR=src-tauri\target\release"

:: Clean previous dist_windows output
if exist "dist_windows" (
    echo Cleaning previous dist_windows directory...
    rmdir /s /q "dist_windows"
    if exist "dist_windows" (
        echo ERROR: Failed to clean dist_windows. Close bilibili-box.exe or any Explorer window using this folder, then rebuild.
        exit /b 1
    )
)

:: Create output directory structure
mkdir dist_windows
mkdir dist_windows\env
mkdir dist_windows\data
mkdir dist_windows\data\user
mkdir dist_windows\data\download

echo.
echo [1/5] Installing dependencies...
call npm install
call npm --prefix frontend install
if errorlevel 1 (
    echo ERROR: Dependency installation failed!
    exit /b 1
)

echo.
echo.
echo [2/5] Refreshing application icons...
if not exist "icon.png" (
    echo ERROR: icon.png not found!
    exit /b 1
)
call npm run tauri -- icon icon.png
if errorlevel 1 (
    echo ERROR: Icon generation failed!
    exit /b 1
)
if exist "icon.ico" (
    copy "icon.ico" "src-tauri\icons\icon.ico" /y >nul
)
if exist "src-tauri\icons\ios" (
    rmdir /s /q "src-tauri\icons\ios"
)
if exist "src-tauri\icons\android" (
    rmdir /s /q "src-tauri\icons\android"
)

echo.
echo [3/5] Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    exit /b 1
)

echo.
echo [4/5] Building Tauri application...
call npm run tauri build
if errorlevel 1 (
    echo ERROR: Tauri build failed!
    exit /b 1
)

echo.
echo [5/5] Copying build artifacts to dist_windows...

:: Copy standalone executable
if exist "%TAURI_RELEASE_DIR%\bilibili-box.exe" (
    echo   - Copying bilibili-box.exe...
    copy "%TAURI_RELEASE_DIR%\bilibili-box.exe" "dist_windows\" /y >nul
    if errorlevel 1 (
        echo ERROR: Failed to copy bilibili-box.exe. Close the running app and rebuild.
        exit /b 1
    )
) else if exist "%TAURI_RELEASE_DIR%\BiliBox.exe" (
    echo   - Copying BiliBox.exe...
    copy "%TAURI_RELEASE_DIR%\BiliBox.exe" "dist_windows\" /y >nul
    if errorlevel 1 (
        echo ERROR: Failed to copy BiliBox.exe. Close the running app and rebuild.
        exit /b 1
    )
) else (
    echo ERROR: Tauri executable not found in %TAURI_RELEASE_DIR%!
    exit /b 1
)

:: Copy required DLL files
if exist "%TAURI_RELEASE_DIR%\*.dll" (
    echo   - Copying DLL files...
    xcopy "%TAURI_RELEASE_DIR%\*.dll" "dist_windows\env\" /y /q
)

:: Copy WebKit/GTK runtime files if they exist
if exist "%TAURI_RELEASE_DIR%\webkit2gtk*" (
    echo   - Copying WebKit runtime files...
    xcopy "%TAURI_RELEASE_DIR%\webkit2gtk*" "dist_windows\env\" /y /q 2>nul
)

:: Copy external runtime tools required by download/merge.
:: Preferred source order:
::   1. project env folder
::   2. project env\bin folder
::   3. project env\ffmpeg\bin folder
::   4. system PATH on the build machine
echo   - Preparing FFmpeg runtime files...
set "PROJECT_ENV=%PROJECT_ROOT%env"
if exist "%PROJECT_ENV%\" (
    xcopy "%PROJECT_ENV%\*" "dist_windows\env\" /e /i /y /q >nul
)

set "FFMPEG_SOURCE="
if exist "%PROJECT_ENV%\ffmpeg.exe" set "FFMPEG_SOURCE=%PROJECT_ENV%\ffmpeg.exe"
if not defined FFMPEG_SOURCE if exist "%PROJECT_ENV%\bin\ffmpeg.exe" set "FFMPEG_SOURCE=%PROJECT_ENV%\bin\ffmpeg.exe"
if not defined FFMPEG_SOURCE if exist "%PROJECT_ENV%\ffmpeg\bin\ffmpeg.exe" set "FFMPEG_SOURCE=%PROJECT_ENV%\ffmpeg\bin\ffmpeg.exe"
if not defined FFMPEG_SOURCE (
    for /f "delims=" %%F in ('where ffmpeg 2^>nul') do (
        if not defined FFMPEG_SOURCE set "FFMPEG_SOURCE=%%F"
    )
)
if not defined FFMPEG_SOURCE (
    echo ERROR: ffmpeg.exe was not found. Put it in env\ or add FFmpeg to PATH before building.
    exit /b 1
)
copy "%FFMPEG_SOURCE%" "dist_windows\env\ffmpeg.exe" /y >nul
for %%D in ("%FFMPEG_SOURCE%") do set "FFMPEG_DIR=%%~dpD"
if exist "!FFMPEG_DIR!*.dll" (
    copy "!FFMPEG_DIR!*.dll" "dist_windows\env\" /y >nul
)

set "FFPROBE_SOURCE="
if exist "%PROJECT_ENV%\ffprobe.exe" set "FFPROBE_SOURCE=%PROJECT_ENV%\ffprobe.exe"
if not defined FFPROBE_SOURCE if exist "%PROJECT_ENV%\bin\ffprobe.exe" set "FFPROBE_SOURCE=%PROJECT_ENV%\bin\ffprobe.exe"
if not defined FFPROBE_SOURCE if exist "%PROJECT_ENV%\ffmpeg\bin\ffprobe.exe" set "FFPROBE_SOURCE=%PROJECT_ENV%\ffmpeg\bin\ffprobe.exe"
if not defined FFPROBE_SOURCE (
    for /f "delims=" %%F in ('where ffprobe 2^>nul') do (
        if not defined FFPROBE_SOURCE set "FFPROBE_SOURCE=%%F"
    )
)
if not defined FFPROBE_SOURCE (
    echo ERROR: ffprobe.exe was not found. Put it in env\ or add FFmpeg to PATH before building.
    exit /b 1
)
copy "%FFPROBE_SOURCE%" "dist_windows\env\ffprobe.exe" /y >nul
for %%D in ("%FFPROBE_SOURCE%") do set "FFPROBE_DIR=%%~dpD"
if exist "!FFPROBE_DIR!*.dll" (
    copy "!FFPROBE_DIR!*.dll" "dist_windows\env\" /y >nul
)

echo.
echo ============================================
echo   Build completed successfully!
echo   Output directory: dist_windows
echo ============================================
echo.
echo Directory structure:
echo   dist_windows/
echo   +-- bilibili-box.exe     (or BiliBox.exe)
echo   +-- env/                 (runtime dependencies)
echo   +-- data/
echo       +-- user/            (user data)
echo       +-- download/        (default download directory)
echo.

:: List output files
echo Generated files:
dir /b dist_windows

endlocal
