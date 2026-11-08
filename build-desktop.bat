@echo off
setlocal
title AI DouDiZhu Desktop Builder
cd /d "%~dp0"

REM ============================================================
REM   AI DouDiZhu - one-click desktop exe builder
REM   Equivalent to: npm run desktop:build
REM   (typecheck -> vite build -> esbuild -> electron-builder)
REM   NOTE: keep this file pure ASCII (safe under any console
REM   codepage, 936 or 65001). Chinese docs: see README and docs folder.
REM ============================================================

echo ============================================================
echo   AI DouDiZhu - Desktop Builder
echo ============================================================
call :log "=== desktop build begin ==="

REM --- Locate Node (same strategy as start.bat) ---
if defined WORKBUDDY_NODE_HOME set "PATH=%WORKBUDDY_NODE_HOME%;%PATH%"
if not defined WORKBUDDY_NODE_HOME if defined NODE_HOME set "PATH=%NODE_HOME%;%PATH%"
where node >nul 2>nul
if errorlevel 1 if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe" set "PATH=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto node_not_found
where npm >nul 2>nul
if errorlevel 1 goto npm_not_found
call :log "[OK] node found"

REM --- First run: install dependencies ---
if exist "node_modules" goto deps_ok
echo [INFO] node_modules not found, installing dependencies (may take a while)...
call :log "[INFO] npm install"
call npm install
if errorlevel 1 goto install_failed
:deps_ok
call :log "[OK] deps ok"

REM --- China mirrors for first-time Electron / packer binary downloads ---
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

REM --- Pre-clean previous output: stale asar locked by editors/indexers is the usual EBUSY cause ---
if not exist "desktop-release" goto clean_done
rd /s /q "desktop-release" >nul 2>&1
if not exist "desktop-release" goto clean_done
echo [WARN] desktop-release is partially locked, cannot pre-clean.
echo [WARN] If the build fails with EBUSY, close the locking program (editor/file indexer) and retry.
call :log "[WARN] desktop-release partially locked"
:clean_done

echo [INFO] Building: typecheck -^> vite build -^> esbuild -^> electron-builder (1-3 minutes)...
call :log "[INFO] npm run desktop:build"
call npm run desktop:build
if errorlevel 1 goto build_failed

echo.
echo [OK] Build finished. exe in desktop-release\:
dir /b "desktop-release\*.exe" 2>nul
call :log "[OK] build success"

REM Open the output folder
start "" "desktop-release"
echo.
echo You can close this window. Double-click the exe in desktop-release to play.
goto end

:node_not_found
call :log "[ERROR] node not found"
echo [ERROR] Node.js not found. Please install Node.js 18+ and add it to PATH (see start.bat / README).
goto end

:npm_not_found
call :log "[ERROR] npm not found"
echo [ERROR] npm not found. Please reinstall Node.js (npm included).
goto end

:install_failed
call :log "[ERROR] npm install failed"
echo [ERROR] npm install failed. Check your network or npm registry, then retry.
goto end

:build_failed
call :log "[ERROR] desktop:build failed"
echo.
echo [ERROR] Build failed. See the error details above.
echo [TIP] Common cause 1: desktop-release locked by an editor/indexer (EBUSY) - close it or delete desktop-release, then retry.
echo [TIP] Common cause 2: first run downloads Electron slowly/fails - npmmirror is built in, just retry.
goto end

:end
call :log "=== desktop build end ==="
echo.
pause
exit /b

REM --- Append one line to desktop-build.log (ignored by .gitignore) ---
:log
echo %~1
echo %~1 >> "%~dp0desktop-build.log"
goto :eof
