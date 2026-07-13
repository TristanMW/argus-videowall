@echo off
REM ─────────────────────────────────────────────────────────────────────────
REM  Argus for Windows — no Docker required.
REM
REM  Runs the go2rtc engine + the Argus backend directly. No virtualization,
REM  no WSL2, no Docker Desktop (and no Docker licensing). Ideal for a client
REM  PC that can't or shouldn't run Docker.
REM
REM  Only prerequisite: Node.js 18+  (https://nodejs.org — install the LTS).
REM  This script downloads go2rtc automatically on first run.
REM
REM  Double-click it, or run:  start-windows.bat
REM ─────────────────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>&1 || (
  echo [!] Node.js 18+ is required. Install the LTS from https://nodejs.org then re-run.
  pause
  exit /b 1
)

REM ── Download go2rtc.exe on first run ─────────────────────────────────────
if not exist "go2rtc\go2rtc.exe" (
  echo [*] Downloading go2rtc engine...
  if not exist "go2rtc" mkdir "go2rtc"
  curl -L -o "%TEMP%\go2rtc_win64.zip" "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_win64.zip"
  if errorlevel 1 (
    echo [!] Download failed. Get go2rtc_win64.zip from
    echo     https://github.com/AlexxIT/go2rtc/releases/latest and put go2rtc.exe in the go2rtc\ folder.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "Expand-Archive -Force '%TEMP%\go2rtc_win64.zip' 'go2rtc'"
  del "%TEMP%\go2rtc_win64.zip" >nul 2>&1
)
if not exist "go2rtc\go2rtc.exe" (
  echo [!] go2rtc.exe missing after download. Check the go2rtc\ folder.
  pause
  exit /b 1
)

REM ── Detect the LAN IP so go2rtc advertises a reachable WebRTC candidate ───
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } ^| Select-Object -First 1).IPv4Address.IPAddress"`) do set "HOST_IP=%%i"
if defined HOST_IP ( echo [*] LAN IP !HOST_IP! ^(WebRTC enabled^) ) else ( echo [*] No LAN IP detected - video will use the MSE fallback. )

echo [*] Starting go2rtc engine...
start "go2rtc" /d "%~dp0go2rtc" go2rtc.exe -config go2rtc.yaml

echo [*] Starting Argus on http://localhost:8080 ...
set "GO2RTC_URL=http://localhost:1984"
set "DATA_FILE=.\data\cameras.json"
start "argus-web" /d "%~dp0" node server.js

timeout /t 2 >nul
start "" http://localhost:8080
echo.
echo [*] Argus is running.
echo     Video wall :  http://localhost:8080
echo     Add cameras:  http://localhost:8080/config.html
if defined HOST_IP echo     On the LAN  :  http://!HOST_IP!:8080
echo     Stop it     :  close the go2rtc and argus-web windows.
