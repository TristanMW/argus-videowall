@echo off
REM ─────────────────────────────────────────────────────────────────────────
REM  Non-Docker launcher (Windows). Docker is the recommended path — see
REM  README. This runs straight from source and needs Node.js 18+.
REM   1. starts the go2rtc streaming engine
REM   2. starts the Argus backend + web UI on http://localhost:8080
REM   3. opens it in your default browser
REM
REM  First-time setup: download go2rtc_win64.zip from
REM    https://github.com/AlexxIT/go2rtc/releases/latest
REM  and put go2rtc.exe in the go2rtc\ folder next to this script.
REM ─────────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

if not exist "go2rtc\go2rtc.exe" (
  echo [!] go2rtc\go2rtc.exe not found.
  echo     Download it from https://github.com/AlexxIT/go2rtc/releases/latest
  echo     ^(go2rtc_win64.zip^) and place go2rtc.exe in the go2rtc\ folder.
  pause
  exit /b 1
)
where node >nul 2>&1 || (
  echo [!] Node.js 18+ is required for the Argus backend.
  echo     Install from https://nodejs.org or use Docker instead.
  pause
  exit /b 1
)

echo [*] Starting go2rtc engine...
start "go2rtc" /d "%~dp0go2rtc" go2rtc.exe -config go2rtc.yaml

echo [*] Starting Argus web UI on http://localhost:8080 ...
set "GO2RTC_URL=http://localhost:1984"
set "DATA_FILE=.\data\cameras.json"
start "argus-web" /d "%~dp0" node server.js

timeout /t 2 >nul
start "" http://localhost:8080
echo [*] Running. Close the go2rtc / argus-web windows to stop.
