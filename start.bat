@echo off
title AI DouDiZhu Launcher
cd /d "%~dp0"

REM 双击 .bat 时 Windows 会自动开 cmd 窗口运行,末尾 pause 即可保持窗口,
REM 不需要再嵌套 start cmd /k "call ..."（否则 start 命令 + start.bat 文件名 + 路径含空格
REM 会触发 cmd 解析把 start.bat 拆成 'rt' 报错）。

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

REM --- Single instance: only when a REAL Vite page (this project) is already serving AND backend healthy ---
set API_PROBE_PORT=
if exist "%~dp0.apiport" for /f "delims=" %%p in (%~dp0.apiport) do set "API_PROBE_PORT=%%p"
if "%API_PROBE_PORT%"=="" set "API_PROBE_PORT=8787"

call :scan_front_port
if "%FRONT_PORT%"=="" goto start_fresh

REM Found a Vite page port — verify backend is actually healthy before assuming existing service
call :probe_backend_health
if "%BACKEND_OK%"=="1" (
  call :log "[INFO] existing service healthy (front=%FRONT_PORT%, api=%API_PROBE_PORT%), opening browser"
  echo [INFO] Service already running. Opening game page.
  start "" "http://localhost:%FRONT_PORT%"
  goto end
)

REM Vite page found but backend unhealthy or absent: stale partial state, do not skip
call :log "[WARN] Vite page at %FRONT_PORT% but backend %API_PROBE_PORT% not healthy, treating as stale"
echo [WARN] 前端 %FRONT_PORT% 有 Vite 页面，但后端 %API_PROBE_PORT% 不健康或不存在。
echo [WARN] 可能是上一次的残留进程。建议手动清理（任务管理器结束 node.exe）后重试。
echo [WARN] 当前按单实例逻辑跳过启动，但服务可能不可用。

:start_fresh
REM (此处继续首次启动流程：deps_ok → npm run dev → wait_loop → open_browser)

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

REM --- Scan for THIS project's Vite dev page (5173..5182): sets FRONT_PORT to first port whose HTTP response is a Vite page (contains /src/main.tsx); empty if none ---
:scan_front_port
set FRONT_PORT=
for /L %%p in (5173,1,5182) do (
  call :is_vite_port %%p
  if not "%FRONT_PORT%"=="" goto :eof
)
goto :eof

REM --- Check if port %1 serves the Vite dev page (HTML contains /src/main.tsx); sets FRONT_PORT=%1 if yes ---
REM 注意用 localhost 而非 127.0.0.1：Vite 5 可能只绑定 IPv6(::1)，127.0.0.1 会连接失败
:is_vite_port
curl -s -m 1 "http://localhost:%1/" 1>"%TEMP%\ddz_vite_page.txt" 2>nul
if errorlevel 1 (
  del "%TEMP%\ddz_vite_page.txt" 2>nul
  goto :eof
)
findstr /C:"src/main.tsx" "%TEMP%\ddz_vite_page.txt" >nul 2>nul
if not errorlevel 1 set "FRONT_PORT=%1"
del "%TEMP%\ddz_vite_page.txt" 2>nul
goto :eof

REM --- Probe backend /api/health: sets BACKEND_OK=1 if HTTP 200 within 5s, else 0 ---
:probe_backend_health
set BACKEND_OK=0
if "%API_PROBE_PORT%"=="" set "API_PROBE_PORT=8787"
curl -s -o NUL -w "%%{http_code}" -m 5 "http://localhost:%API_PROBE_PORT%/api/health" 1>"%TEMP%\ddz_probe_hc.txt" 2>nul
if errorlevel 1 (
  del "%TEMP%\ddz_probe_hc.txt" 2>nul
  goto :eof
)
set /p HC=<"%TEMP%\ddz_probe_hc.txt"
if "%HC%"=="200" set BACKEND_OK=1
del "%TEMP%\ddz_probe_hc.txt" 2>nul
goto :eof

:log
echo %~1
echo %~1 >> "%~dp0start.log"
goto :eof
