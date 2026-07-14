# ─────────────────────────────────────────────────────────────────────────────
# Argus uninstaller — Windows. Removes everything the setup created.
#
#   • Stops go2rtc + the Argus backend and deletes the start-at-boot task.
#   • Removes the Argus firewall rules.
#   • Tears down the Docker deployment too (containers, volume, images) if the
#     Docker install path was used on this machine.
#   • Deletes the downloaded engine, logs, and saved cameras — and optionally
#     the whole Argus folder.
#
# It does NOT uninstall Node.js or Docker Desktop themselves (shared tools —
# remove them from Windows "Installed apps" if you no longer want them).
#
# Double-click uninstall-windows.bat, or run:
#   powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "SilentlyContinue"

# Deleting the scheduled task + firewall rules needs admin.
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
  exit
}
Set-Location $PSScriptRoot

$TaskName = "Argus Video Wall"
function Info($m) { Write-Host "[argus] $m" -ForegroundColor Cyan }

# ── 1. Stop the supervisor first (it restarts the others), then the engines ──
Info "Stopping Argus..."
Stop-ScheduledTask -TaskName $TaskName
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like "*run-argus.ps1*" -or
                 ($_.Name -eq "go2rtc.exe" -and $_.ExecutablePath -like "$PSScriptRoot*") -or
                 ($_.Name -eq "node.exe" -and $_.CommandLine -like "*$PSScriptRoot*server.js*") } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# ── 2. Remove the start-at-boot task and firewall rules ──────────────────────
Info "Removing the start-at-boot task..."
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Info "Removing the Argus firewall rules..."
Remove-NetFirewallRule -Group "Argus"

# ── 3. Docker path (if it was ever used here): containers, volume, images ────
if ((Get-Command docker) -and (Test-Path "docker-compose.yml")) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) {
    Info "Removing the Docker deployment (containers, volume, images)..."
    docker compose down -v --rmi local --remove-orphans *> $null
  }
}

# ── 4. Delete files ───────────────────────────────────────────────────────────
Write-Host ""
$all = Read-Host "Delete the ENTIRE Argus folder, including saved cameras? [Y/n]"
if ($all -notmatch "^[nN]") {
  Info "Deleting $PSScriptRoot ..."
  # A script can't delete the folder it's running from - hand it to a detached
  # cmd that waits for this window to exit first.
  Set-Location $env:TEMP
  Start-Process cmd.exe -WindowStyle Hidden `
    -ArgumentList "/c ping -n 4 127.0.0.1 >nul & rd /s /q `"$PSScriptRoot`""
  Info "Argus is fully uninstalled. This window will close; the folder disappears in a few seconds."
  Start-Sleep -Seconds 2
  exit
}

# Keep the app files, remove everything the app created at runtime.
Info "Keeping the app files; removing runtime data..."
Remove-Item -Recurse -Force "logs", "data", ".env", "setup.log" -ErrorAction SilentlyContinue
Remove-Item -Force "go2rtc\go2rtc.exe" -ErrorAction SilentlyContinue
Info "Done. Argus no longer starts at boot and all runtime data is removed."
Read-Host "Press Enter to close"
