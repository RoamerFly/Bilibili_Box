@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

set "OUTPUT_DIR=dist_windows"
set "TAURI_RELEASE_DIR=src-tauri\target\release"
set "ICON_SOURCE=icon.png"
set "REFRESH_ICONS=0"

if /I "%~1"=="--refresh-icons" (
    set "REFRESH_ICONS=1"
    shift
)
if not "%~1"=="" (
    echo ERROR: Usage: build-windows.bat [--refresh-icons]
    exit /b 1
)

echo ============================================
echo   BiliBox Windows Build Script
echo ============================================
echo.

echo [1/5] Installing locked dependencies...
if not exist "package-lock.json" (
    echo ERROR: package-lock.json was not found.
    exit /b 1
)
if not exist "frontend\package-lock.json" (
    echo ERROR: frontend\package-lock.json was not found.
    exit /b 1
)
call npm ci --no-audit --no-fund
if errorlevel 1 (
    echo ERROR: Root dependency installation failed.
    exit /b 1
)
call npm --prefix frontend ci --no-audit --no-fund
if errorlevel 1 (
    echo ERROR: Frontend dependency installation failed.
    exit /b 1
)

echo.
if "%REFRESH_ICONS%"=="1" (
    echo [2/5] Regenerating application icons from %ICON_SOURCE%...
    if not exist "%ICON_SOURCE%" (
        echo ERROR: %ICON_SOURCE% was not found.
        exit /b 1
    )
    call npm run tauri -- icon "%ICON_SOURCE%"
    if errorlevel 1 (
        echo ERROR: Icon generation failed.
        exit /b 1
    )
    if exist "src-tauri\icons\ios" rmdir /s /q "src-tauri\icons\ios"
    if exist "src-tauri\icons\android" rmdir /s /q "src-tauri\icons\android"
) else (
    echo [2/5] Using committed application icons.
    if not exist "src-tauri\icons\icon.ico" (
        echo ERROR: Windows icon was not found. Run build-windows.bat --refresh-icons.
        exit /b 1
    )
)

echo.
echo [3/5] Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed.
    exit /b 1
)

echo.
echo [4/5] Building Tauri application...
call npm run tauri -- build
if errorlevel 1 (
    echo ERROR: Tauri build failed.
    exit /b 1
)

echo.
echo [5/5] Preparing portable package in %OUTPUT_DIR%...
if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%"
    if exist "%OUTPUT_DIR%" (
        echo ERROR: Failed to clean %OUTPUT_DIR%. Close any application using it and rebuild.
        exit /b 1
    )
)
mkdir "%OUTPUT_DIR%\env" >nul
mkdir "%OUTPUT_DIR%\data\guest" >nul
mkdir "%OUTPUT_DIR%\data\guest\cache" >nul
mkdir "%OUTPUT_DIR%\data\guest\download" >nul
if exist "THIRD_PARTY_NOTICES.md" copy "THIRD_PARTY_NOTICES.md" "%OUTPUT_DIR%\" /y >nul

if exist "%TAURI_RELEASE_DIR%\bilibili-box.exe" (
    copy "%TAURI_RELEASE_DIR%\bilibili-box.exe" "%OUTPUT_DIR%\" /y >nul
) else if exist "%TAURI_RELEASE_DIR%\BiliBox.exe" (
    copy "%TAURI_RELEASE_DIR%\BiliBox.exe" "%OUTPUT_DIR%\" /y >nul
) else (
    echo ERROR: Tauri executable not found in %TAURI_RELEASE_DIR%.
    exit /b 1
)
if errorlevel 1 (
    echo ERROR: Failed to copy the application executable.
    exit /b 1
)

if exist "%TAURI_RELEASE_DIR%\*.dll" (
    copy "%TAURI_RELEASE_DIR%\*.dll" "%OUTPUT_DIR%\env\" /y >nul
)

set "PROJECT_ENV=%PROJECT_ROOT%env"
if exist "%PROJECT_ENV%\" (
    xcopy "%PROJECT_ENV%\*" "%OUTPUT_DIR%\env\" /e /i /y /q >nul
)

call :copy_runtime_tool ffmpeg.exe
if errorlevel 1 exit /b 1
call :copy_runtime_tool ffprobe.exe
if errorlevel 1 exit /b 1

echo.
echo ============================================
echo   Build completed successfully.
echo   Output directory: %OUTPUT_DIR%
echo ============================================
echo.
echo Generated files:
dir /b "%OUTPUT_DIR%"
exit /b 0

:copy_runtime_tool
set "TOOL_NAME=%~1"
set "TOOL_SOURCE="
if exist "%PROJECT_ENV%\%TOOL_NAME%" set "TOOL_SOURCE=%PROJECT_ENV%\%TOOL_NAME%"
if not defined TOOL_SOURCE if exist "%PROJECT_ENV%\bin\%TOOL_NAME%" set "TOOL_SOURCE=%PROJECT_ENV%\bin\%TOOL_NAME%"
if not defined TOOL_SOURCE if exist "%PROJECT_ENV%\ffmpeg\bin\%TOOL_NAME%" set "TOOL_SOURCE=%PROJECT_ENV%\ffmpeg\bin\%TOOL_NAME%"
if not defined TOOL_SOURCE (
    for /f "delims=" %%F in ('where %TOOL_NAME% 2^>nul') do (
        if not defined TOOL_SOURCE set "TOOL_SOURCE=%%F"
    )
)
if not defined TOOL_SOURCE (
    echo ERROR: %TOOL_NAME% was not found. Put it in env\ or add it to PATH before building.
    exit /b 1
)
echo   - Copying %TOOL_NAME% from !TOOL_SOURCE!
copy "!TOOL_SOURCE!" "%OUTPUT_DIR%\env\%TOOL_NAME%" /y >nul
if errorlevel 1 (
    echo ERROR: Failed to copy %TOOL_NAME%.
    exit /b 1
)
for %%D in ("!TOOL_SOURCE!") do set "TOOL_DIR=%%~dpD"
if exist "!TOOL_DIR!*.dll" (
    copy "!TOOL_DIR!*.dll" "%OUTPUT_DIR%\env\" /y >nul
)
exit /b 0
