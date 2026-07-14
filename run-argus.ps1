# ─────────────────────────────────────────────────────────────────────────────
# Argus headless runner — launched by the "Argus Video Wall" scheduled task.
#
# Runs go2rtc + the Argus backend with no console windows, restarts either one
# if it dies, and logs to logs\. You don't run this by hand — setup-windows.ps1
# registers it to run at boot. (For a visible, manual run use start-windows.bat.)
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# At boot the LAN may not be up yet; wait for it (up to 60s) so the backend can
# advertise a reachable WebRTC candidate. It falls back to MSE if none appears.
$ip = $null
for ($i = 0; $i -lt 12 -and -not $ip; $i++) {
  $ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
         Select-Object -First 1).IPv4Address.IPAddress
  if (-not $ip) { Start-Sleep -Seconds 5 }
}

# The task runs as SYSTEM, so resolve node.exe from the machine PATH or the
# default install location rather than assuming a user profile.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe") |
          Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $node) {
  "node.exe not found — install Node.js LTS and re-run setup-windows.ps1" |
    Out-File (Join-Path $logDir "argus.err.log")
  exit 1
}

$env:GO2RTC_URL = "http://localhost:1984"
$env:DATA_FILE  = Join-Path $PSScriptRoot "data\cameras.json"
if ($ip) { $env:HOST_IP = $ip }

$go2rtcDir = Join-Path $PSScriptRoot "go2rtc"
$engine = $null
$web    = $null

while ($true) {
  if (-not $engine -or $engine.HasExited) {
    $engine = Start-Process -FilePath (Join-Path $go2rtcDir "go2rtc.exe") `
      -ArgumentList "-config", "go2rtc.yaml" -WorkingDirectory $go2rtcDir `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $logDir "go2rtc.log") `
      -RedirectStandardError  (Join-Path $logDir "go2rtc.err.log")
  }
  if (-not $web -or $web.HasExited) {
    $web = Start-Process -FilePath $node -ArgumentList "server.js" `
      -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $logDir "argus.log") `
      -RedirectStandardError  (Join-Path $logDir "argus.err.log")
  }
  Start-Sleep -Seconds 10
}
