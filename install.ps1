# ─────────────────────────────────────────────────────────────────────────────
# Argus installer — Windows (PowerShell).
#
# Uses your existing Docker if it's installed; otherwise installs Docker Desktop
# via winget, then builds and starts Argus. Re-runnable.
#
#   Right-click → "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Have($c) { $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }
function DaemonUp { if (-not (Have docker)) { return $false }; docker info *> $null; return ($LASTEXITCODE -eq 0) }
function Info($m) { Write-Host "[argus] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[argus] $m" -ForegroundColor Yellow }

# Launch Docker Desktop by its real path (Start-Process "Docker Desktop" fails
# because that isn't a resolvable command). No-throw: warn if it isn't found.
function Start-DockerDesktop {
  $paths = @(
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
  )
  $exe = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($exe) { Start-Process $exe; return }
  Warn "Couldn't auto-start Docker Desktop. Open it from the Start menu, wait for 'Engine running', then re-run this script."
}

# ── 1. Ensure Docker is installed and running ────────────────────────────────
if (DaemonUp) {
  Info "Existing Docker detected - building on it."
}
elseif (Have docker) {
  Warn "Docker is installed but not running. Starting Docker Desktop..."
  Start-DockerDesktop
}
else {
  Info "Docker not found. Installing Docker Desktop via winget..."
  if (Have winget) {
    winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    Warn "Docker Desktop installed. A sign-out or REBOOT is usually required for the WSL2 backend."
    Start-DockerDesktop
  }
  else {
    Write-Error "winget isn't available. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ then re-run this script."
    exit 1
  }
}

# ── 2. Wait for the daemon ───────────────────────────────────────────────────
Info "Waiting for the Docker daemon to be ready..."
for ($i = 0; $i -lt 60; $i++) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Docker daemon didn't start. Open Docker Desktop, wait for it to be running, then re-run."
  exit 1
}

# ── 3. Ensure Compose v2 ─────────────────────────────────────────────────────
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Docker Compose v2 not found. Update Docker Desktop (it bundles Compose)."
  exit 1
}

# ── 4. Detect LAN IP and enable WebRTC ───────────────────────────────────────
# Written to .env so go2rtc advertises a reachable WebRTC candidate; without it
# the player falls back to MSE, which fails to decode some cameras (e.g. UniFi).
$ip = $null
try {
  $ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
         Select-Object -First 1).IPv4Address.IPAddress
} catch {}
if ($ip) {
  "HOST_IP=$ip" | Out-File -FilePath .env -Encoding ascii -Force
  Info "Detected LAN IP $ip (WebRTC enabled via .env)."
} else {
  Warn "Couldn't detect a LAN IP; WebRTC candidate not set. Video still works via MSE."
}

# ── 5. Build and start Argus ─────────────────────────────────────────────────
Info "Building and starting Argus..."
docker compose up -d --build

Write-Host ""
Info "Argus is running."
Info "  Video wall :  http://localhost:8080"
Info "  Add cameras:  http://localhost:8080/config.html"
Info "  Stop it     :  docker compose down   (from this folder)"
