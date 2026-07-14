# ─────────────────────────────────────────────────────────────────────────────
# Argus setup — Windows, no Docker. Installs Argus as a start-at-boot service.
#
# What it does (re-runnable):
#   1. Installs Node.js LTS via winget if missing.
#   2. Downloads the go2rtc engine if missing.
#   3. Seeds data\cameras.json (the camera config file).
#   4. Opens the Windows Firewall for LAN access (web UI, video, discovery).
#   5. Registers an "Argus Video Wall" scheduled task that runs run-argus.ps1
#      headless as SYSTEM at every boot — no login required.
#   6. Starts it now, verifies it answers, and opens the video wall.
#
# Everything is logged to setup.log next to this script.
#
# Double-click setup-windows.bat, or run:
#   powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
#
# To remove everything: uninstall-windows.bat
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"

# Scheduled tasks + firewall rules need admin — relaunch elevated if we aren't.
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
  exit
}
Set-Location $PSScriptRoot
try { Start-Transcript -Path (Join-Path $PSScriptRoot "setup.log") -Force | Out-Null } catch {}

$TaskName = "Argus Video Wall"
function Info($m) { Write-Host "[argus] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[argus] $m" -ForegroundColor Yellow }
function Fail($m) {
  Write-Host "[argus] $m" -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch {}
  Read-Host "Press Enter to close"
  exit 1
}

try {
  # Stop anything from a previous run so downloads/registration aren't blocked.
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*run-argus.ps1*" -or
                   ($_.Name -eq "go2rtc.exe" -and $_.ExecutablePath -like "$PSScriptRoot*") -or
                   ($_.Name -eq "node.exe" -and $_.CommandLine -like "*$PSScriptRoot*server.js*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  # ── 1. Node.js ─────────────────────────────────────────────────────────────
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    $node = @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe") |
            Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if (-not $node) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Info "Node.js not found - installing the LTS via winget..."
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      $node = "$env:ProgramFiles\nodejs\node.exe"
    }
    if (-not $node -or -not (Test-Path $node)) {
      Fail "Node.js is required. Install the LTS from https://nodejs.org then re-run this script."
    }
  }
  Info "Node.js: $node"

  # ── 2. go2rtc engine ───────────────────────────────────────────────────────
  if (-not (Test-Path "go2rtc\go2rtc.exe")) {
    Info "Downloading the go2rtc engine..."
    $zip = Join-Path $env:TEMP "go2rtc_win64.zip"
    Invoke-WebRequest -UseBasicParsing "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_win64.zip" -OutFile $zip
    Expand-Archive -Force $zip "go2rtc"
    Remove-Item $zip -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path "go2rtc\go2rtc.exe")) {
    Fail "go2rtc.exe missing. Get go2rtc_win64.zip from https://github.com/AlexxIT/go2rtc/releases/latest and put go2rtc.exe in the go2rtc\ folder."
  }
  Info "go2rtc engine: OK"

  # ── 3. Seed the camera config file ─────────────────────────────────────────
  New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "data") | Out-Null
  $camFile = Join-Path $PSScriptRoot "data\cameras.json"
  if (-not (Test-Path $camFile)) {
    "[]" | Out-File -FilePath $camFile -Encoding ascii
    Info "Camera config created: data\cameras.json (add cameras in the web UI)"
  } else {
    Info "Camera config found: data\cameras.json (keeping it)"
  }

  # ── 4. Firewall (LAN access to the wall, video, and argus.local discovery) ─
  Info "Adding Windows Firewall rules (group 'Argus')..."
  Remove-NetFirewallRule -Group "Argus" -ErrorAction SilentlyContinue
  $rules = @(
    @{ N = "Argus web UI (TCP 8080)";        P = "TCP"; Port = 8080 },
    @{ N = "Argus go2rtc API/MSE (TCP 1984)"; P = "TCP"; Port = 1984 },
    @{ N = "Argus WebRTC media (TCP 8555)";  P = "TCP"; Port = 8555 },
    @{ N = "Argus WebRTC media (UDP 8555)";  P = "UDP"; Port = 8555 },
    @{ N = "Argus mDNS discovery (UDP 5353)"; P = "UDP"; Port = 5353 }
  )
  foreach ($r in $rules) {
    New-NetFirewallRule -Group "Argus" -DisplayName $r.N -Direction Inbound -Action Allow `
      -Protocol $r.P -LocalPort $r.Port -Profile Domain, Private | Out-Null
  }

  # ── 5. Scheduled task: run headless as SYSTEM at every boot ────────────────
  Info "Registering the '$TaskName' start-at-boot task..."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\run-argus.ps1`"" `
    -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -AtStartup
  # Let the network stack settle before we bind ports (best-effort — some
  # builds expose Delay as read-only; run-argus.ps1 also waits for the LAN).
  try { $trigger.Delay = "PT20S" } catch { Warn "Couldn't set a boot delay (harmless)." }
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  # Passing zero to -ExecutionTimeLimit is rejected on some Windows builds;
  # setting the property to PT0S afterwards reliably means "no time limit"
  # (the default would kill Argus after 72 hours).
  $settings.ExecutionTimeLimit = "PT0S"
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

  # Verify it really exists — this is the whole point of the setup.
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    Fail "The '$TaskName' task did not register. See setup.log and send it to support."
  }
  Info "Scheduled task registered (Task Scheduler Library > '$TaskName')."

  # ── 6. Start it now and verify it answers ──────────────────────────────────
  Info "Starting Argus..."
  Start-ScheduledTask -TaskName $TaskName
  $up = $false
  for ($i = 0; $i -lt 20; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing "http://localhost:8080/api/ping" -TimeoutSec 2 | Out-Null
      $up = $true; break
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $up) {
    Warn "Argus didn't answer on http://localhost:8080 within 20s."
    Warn "Task state: $((Get-ScheduledTask -TaskName $TaskName).State). Check logs\argus.err.log and setup.log."
  }

  Write-Host ""
  Info "Argus is installed and will start automatically at every boot."
  Info "  Video wall :  http://localhost:8080"
  Info "  Add cameras:  http://localhost:8080/config.html"
  $ip = $null
  try {
    $ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
           Select-Object -First 1).IPv4Address.IPAddress
  } catch {}
  if ($ip) { Info "  On the LAN  :  http://${ip}:8080" }
  Info "  Cameras file:  data\cameras.json   Logs: logs\   Setup log: setup.log"
  Info "  Uninstall   :  uninstall-windows.bat"
  if ($up) { Start-Process "http://localhost:8080" }
}
catch {
  Write-Host ""
  Write-Host "[argus] SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "[argus] At: $($_.InvocationInfo.PositionMessage)" -ForegroundColor Red
  Write-Host "[argus] Full details are in setup.log - please send that file to support." -ForegroundColor Yellow
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
}
Read-Host "Press Enter to close"
