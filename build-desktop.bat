@echo off
setlocal
title AI DouDiZhu Desktop Builder
cd /d "%~dp0"

REM ============================================================
REM   AI DouDiZhu - one-click desktop exe builder
REM   Same steps as: npm run desktop:build
REM   (typecheck -> vite build -> esbuild -> splash bmp check -> electron-builder)
REM
REM   NOTE 1: keep this file pure ASCII (safe under codepage 936 / 65001).
REM   NOTE 2: build safety rule, changed 2026-11-18.
REM   The build used to delete desktop-release\* BEFORE packaging. If the
REM   packaging step then failed (EPERM / EBUSY on an .asar inside the old
REM   win-unpacked), the previous exe was already gone and nothing new was
REM   produced -> "the exe disappeared". Now every build goes into a scratch
REM   folder and the exe is copied into desktop-release only after success,
REM   so a locked folder can never destroy the last good build again.
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
echo [INFO] node_modules not found, installing dependencies, this may take a while...
call :log "[INFO] npm install"
call npm install
if errorlevel 1 goto install_failed
:deps_ok
call :log "[OK] deps ok"

REM --- China mirrors for first-time Electron / packer binary downloads ---
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

REM --- Pick a scratch output dir for this run -------------------
REM electron-builder unpacks into win-unpacked.tmp and then renames it to
REM win-unpacked. When any process still holds an .asar inside the OLD
REM win-unpacked - a running AI DouDiZhu exe, an Electron based editor or AI
REM agent such as WorkBuddy / Devin / VS Code, or an antivirus scan - the
REM rename fails with EPERM, and the fallback copy hits EBUSY on unlink.
REM A freshly named scratch dir has no such history, so the packaging step
REM cannot be blocked by leftovers from a previous run.
set "PACKDIR=desktop-release.build"
if exist "%PACKDIR%" rd /s /q "%PACKDIR%" >nul 2>&1
if exist "%PACKDIR%" set "PACKDIR=desktop-release.build-%RANDOM%"
if not exist "desktop-release" md "desktop-release" >nul 2>&1

if exist "desktop-release\win-unpacked" (
  echo [WARN] desktop-release\win-unpacked is a leftover from an older build.
  echo        It is not deleted here because a process may still hold its .asar.
  echo        Reclaim the space after a reboot: rd /s /q "desktop-release\win-unpacked"
)
echo [INFO] Scratch output dir: %PACKDIR%
echo [INFO] Building, this takes 1 to 3 minutes...

REM Steps live in package.json: desktop:prebuild (build + bundle + splash check +
REM patch) then desktop:pack. Only the output dir differs here, so this script
REM cannot silently drift when the npm chain gains or loses a step.
call :log "[INFO] npm run desktop:prebuild"
call npm run desktop:prebuild
if errorlevel 1 goto build_failed

call :log "[INFO] electron-builder output=%PACKDIR%"
if not exist "%PACKDIR%" md "%PACKDIR%" >nul 2>&1
call npm run desktop:pack -- --config.directories.output=%PACKDIR%
if errorlevel 1 goto build_failed

REM --- Publish: copy the new exe into desktop-release -------------
REM Only reached when the packaging step really succeeded.
echo.
set "HASEXE="
for %%F in ("%PACKDIR%\*.exe") do if exist "%%~fF" set "HASEXE=1"
if not defined HASEXE goto no_artifact

for %%F in ("%PACKDIR%\*.exe") do (
  copy /y "%%~fF" "desktop-release\" >nul 2>&1
  if errorlevel 1 goto copy_failed
)

echo [OK] Build finished. exe in desktop-release:
for %%F in ("desktop-release\*.exe") do if exist "%%~fF" echo         %%~nxF  -^>  %%~zF bytes
call :log "[OK] build success"

REM Old versioned exes are intentionally never deleted, so just point out when
REM they start piling up (portable + installer per version is 2 files).
set "EXEN=0"
for %%F in ("desktop-release\*.exe") do set /a EXEN+=1
if %EXEN% GTR 2 echo [WARN] desktop-release holds %EXEN% exe files, older versions can be deleted by hand.

REM Best effort cleanup of the scratch folder, harmless if it stays.
rd /s /q "%PACKDIR%" >nul 2>&1
if exist "%PACKDIR%" echo [WARN] Scratch folder "%PACKDIR%" is still locked, delete it after reboot.
goto open_folder

:copy_failed
echo.
echo [WARN] Could not copy the new exe into desktop-release, the folder is locked.
echo [WARN] The freshly built exe is here instead, use it directly:
for %%F in ("%PACKDIR%\*.exe") do if exist "%%~fF" echo         %%~fF
call :log "[WARN] copy to desktop-release failed, exe left in %PACKDIR%"
goto end

:open_folder
start "" "desktop-release"
echo.
echo You can close this window. Double-click the exe in desktop-release to play.
goto end

:no_artifact
echo.
echo [ERROR] Packaging reported success but produced no exe.
echo [TIP] Look into "%PACKDIR%" for a partial output, then run this script again.
call :log "[ERROR] no exe artifact produced"
goto end

:node_not_found
call :log "[ERROR] node not found"
echo [ERROR] Node.js not found. Please install Node.js 18+ and add it to PATH, see README.
goto end

:npm_not_found
call :log "[ERROR] npm not found"
echo [ERROR] npm not found. Please reinstall Node.js, npm is included.
goto end

:install_failed
call :log "[ERROR] npm install failed"
echo [ERROR] npm install failed. Check your network or npm registry, then retry.
goto end

:build_failed
call :log "[ERROR] desktop:build failed"
echo.
echo [ERROR] Build failed. See the error details above.
set "OLDEXE="
for %%F in ("desktop-release\*.exe") do if exist "%%~fF" set "OLDEXE=1"
if defined OLDEXE echo [NOTE] The previous exe in desktop-release was NOT touched:
if defined OLDEXE for %%F in ("desktop-release\*.exe") do if exist "%%~fF" echo         %%~nxF  -^>  %%~zF bytes
if not defined OLDEXE echo [NOTE] desktop-release holds no exe yet, this was the first build.
echo [TIP] Cause 1: EBUSY or EPERM on an .asar under win-unpacked. It is held by
echo       a running AI DouDiZhu exe, an Electron based editor or AI agent such
echo       as WorkBuddy / Devin / VS Code, or an antivirus scan. Close it, retry.
echo [TIP] Cause 2: first run downloads Electron slowly or fails. npmmirror is
echo       built in, just retry.
echo [TIP] The scratch dir has no locked leftovers, so retrying is usually enough.
goto end

:end
call :log "=== desktop build end ==="
echo.
pause
exit /b

REM --- Append one line to desktop-build.log, ignored by .gitignore ---
:log
echo %~1
echo %~1 >> "%~dp0desktop-build.log"
goto :eof
