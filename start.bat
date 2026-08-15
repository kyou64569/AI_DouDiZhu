@echo off
title AI DouDiZhu Launcher
cd /d "%~dp0"

REM === Relaunch under cmd /k so the window never auto-closes ===
if "%~1"=="keep" goto main
start "AI DouDiZhu Launcher" cmd /k "call "%~f0" keep"
exit /b

:main
echo ============================================================
echo   AI DouDiZhu Launcher
echo ============================================================
call :log "=== startup begin ==="

REM --- Ensure node/npm are available: add known node dir to PATH ---
set "NODE_HOME=C:\Users\asus\.workbuddy\binaries\node\versions\22.22.2"
set "PATH=%NODE_HOME%;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto node_not_found
where npm >nul 2>nul
if errorlevel 1 goto npm_not_found

call :log "[OK] node found"
call :log "[OK] npm found"

REM --- Single instance: if any front-end port (5173..5182) already listens, just open browser ---
call :scan_front_port
if not "%FRONT_PORT%"=="" goto already_running

REM --- 端口占用处理（2026-08-15 起）：
REM     不再强制 taskkill 占用进程 —— 被占用的端口自动跳转：
REM     - 前端：Vite strictPort=false 自动换 5174/5175...
REM     - 后端：scripts/pick-api-port.mjs 预探测 + server EADDRINUSE 兜底重试，写入 .apiport 联动 ---
call :log "[INFO] ports will auto-skip if occupied (no force-kill)"

REM --- First-time dependency install ---
if exist "node_modules" goto deps_ok
echo [INFO] First run, installing dependencies (this may take a while)...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed. Please check network or npm registry.
  goto end
)
:deps_ok

REM --- Start dev server in a separate persistent window, log to dev.log ---
echo [INFO] Starting dev server (logs go to dev.log)...
call :log "[INFO] start dev window"
start "AI DouDiZhu Dev" /d "%~dp0" cmd /k "npm run dev > dev.log 2>&1"

REM --- Wait for any front-end port (5173..5182) to be ready (up to 40 seconds) ---
set /a COUNT=0
:wait_loop
call :scan_front_port
if not "%FRONT_PORT%"=="" goto open_browser
set /a COUNT+=1
if %COUNT% geq 40 goto check_timeout
timeout /t 1 >nul
goto wait_loop

:node_not_found
call :log "[ERROR] node not found"
echo [ERROR] Node.js not found. Please install Node.js 18+ and add it to PATH.
goto end

:npm_not_found
call :log "[ERROR] npm not found"
echo [ERROR] npm not found. Please reinstall Node.js with npm.
goto end

:already_running
call :log "[INFO] front-end port %FRONT_PORT% already listening, opening browser"
echo [INFO] Service already running. Opening game page.
start "" "http://localhost:%FRONT_PORT%"
goto end

:open_browser
echo [OK] Service ready. Opening game page at http://localhost:%FRONT_PORT%...
call :log "[OK] service ready, front port %FRONT_PORT%"
start "" "http://localhost:%FRONT_PORT%"
echo [TIP] The dev server runs in the "AI DouDiZhu Dev" window. Close that window to stop.
goto end

:check_timeout
echo [ERROR] Service start timed out. dev.log content:
echo ----------------------------------------------------------
if exist "%~dp0dev.log" type "%~dp0dev.log"
echo ----------------------------------------------------------
call :log "[ERROR] timeout"
goto end

:end
echo.
echo This window stays open via cmd /k. Closing it does not stop the dev server.
echo Press any key to return to the prompt (you can keep reading output).
call :log "=== startup script end ==="
pause
exit /b

REM ============================================================
REM Subroutines (must stay at the end of the file)
REM ============================================================

REM --- Scan front-end ports 5173..5182; sets FRONT_PORT (empty if none listening) ---
:scan_front_port
set FRONT_PORT=5173
:scan_front_loop
netstat -ano 2>nul | findstr /C:":%FRONT_PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 goto :eof
set /a FRONT_PORT+=1
if %FRONT_PORT% leq 5182 goto scan_front_loop
set FRONT_PORT=
goto :eof

:log
echo %~1
echo %~1 >> "%~dp0start.log"
goto :eof
