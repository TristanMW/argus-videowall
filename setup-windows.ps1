# ─────────────────────────────────────────────────────────────────────────────
# Argus setup — Windows, no Docker. Installs Argus as a start-at-boot service.
#
# What it does (re-runnable):
#   1. Installs Node.js LTS via winget if missing.
#   2. Downloads the go2rtc engine if missing.
#   3. Opens the Windows Firewall for LAN access (web UI, video, discovery).
#   4. Registers a "Argus Video Wall" scheduled task that runs run-argus.ps1
#      headless as SYSTEM at every boot — no login required.
#   5. Starts it now and opens the video wall.
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

$TaskName = "Argus Video Wall"
function Info($m) { Write-Host "[argus] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[argus] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[argus] $m" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

# Stop anything from a previous run so downloads/registration aren't blocked.
function Stop-Argus {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*run-argus.ps1*" -or
                   ($_.Name -eq "go2rtc.exe" -and $_.ExecutablePath -like "$PSScriptRoot*") -or
                   ($_.Name -eq "node.exe" -and $_.CommandLine -like "*$PSScriptRoot*server.js*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Stop-Argus

# ── 1. Node.js ───────────────────────────────────────────────────────────────
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

# ── 2. go2rtc engine ─────────────────────────────────────────────────────────
if (-not (Test-Path "go2rtc\go2rtc.exe")) {
  Info "Downloading the go2rtc engine..."
  $zip = Join-Path $env:TEMP "go2rtc_win64.zip"
  try {
    Invoke-WebRequest -UseBasicParsing "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_win64.zip" -OutFile $zip
    Expand-Archive -Force $zip "go2rtc"
    Remove-Item $zip -ErrorAction SilentlyContinue
  } catch {
    Warn "Download failed: $($_.Exception.Message)"
  }
}
if (-not (Test-Path "go2rtc\go2rtc.exe")) {
  Fail "go2rtc.exe missing. Get go2rtc_win64.zip from https://github.com/AlexxIT/go2rtc/releases/latest and put go2rtc.exe in the go2rtc\ folder."
}
Info "go2rtc engine: OK"

# ── 3. Firewall (LAN access to the wall, video, and argus.local discovery) ───
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

# ── 4. Scheduled task: run headless as SYSTEM at every boot ──────────────────
Info "Registering the '$TaskName' start-at-boot task..."
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\run-argus.ps1`"" `
  -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT20S"   # let the network stack settle before we bind ports
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

# ── 5. Start it now ──────────────────────────────────────────────────────────
Info "Starting Argus..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4

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
Info "  Logs        :  $PSScriptRoot\logs\"
Info "  Uninstall   :  uninstall-windows.bat"
Start-Process "http://localhost:8080"
Read-Host "Press Enter to close"
