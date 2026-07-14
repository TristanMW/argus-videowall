# ─────────────────────────────────────────────────────────────────────────────
# Expose Argus over HTTPS on your Tailscale network - Windows version of
# tailscale-serve.sh. Run ON the box that runs Argus, after setup-windows.bat.
#
# Why: browsers only treat https:// (or localhost) as secure. Over a plain
# http://<LAN-IP>:8080 the PWA shows "Not secure" and won't install cleanly,
# and two-way talk can't use the microphone. This publishes the app with a
# valid, auto-renewed certificate - visible only to devices on your tailnet:
#   https://<this-box>.<tailnet>.ts.net        → the Argus UI + backend (:8080)
#   https://<this-box>.<tailnet>.ts.net:8443   → go2rtc streams (:1984)
#
# Prereqs:
#   • Tailscale installed + logged in on this box (https://tailscale.com/download)
#   • HTTPS enabled for your tailnet (Tailscale admin → DNS → enable HTTPS)
#
# Run:  powershell -ExecutionPolicy Bypass -File .\tailscale-serve.ps1
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"

$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) {
  $ts = @("$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ts) {
  Write-Host "[!] tailscale not found. Install + log in first: https://tailscale.com/download" -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host "[*] Serving Argus UI/backend on https (443) -> localhost:8080"
& $ts serve --bg --https=443 http://localhost:8080

Write-Host "[*] Serving go2rtc on https (8443) -> localhost:1984"
& $ts serve --bg --https=8443 http://localhost:1984

Write-Host ""
Write-Host "[*] Current Tailscale serve config:"
& $ts serve status

$dns = $null
try { $dns = ((& $ts status --json | ConvertFrom-Json).Self.DNSName).TrimEnd(".") } catch {}
Write-Host ""
if ($dns) { Write-Host "[+] Open (and install the PWA from):  https://$dns" -ForegroundColor Green }
else      { Write-Host "[+] Run 'tailscale status' to find this machine's name, then open https://<name>.<tailnet>.ts.net" }
Write-Host "    To stop sharing:  tailscale serve --https=443 off ; tailscale serve --https=8443 off"
Read-Host "Press Enter to close"
