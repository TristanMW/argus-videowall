#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
#  Expose Argus over HTTPS on your Tailscale network (tailnet). Run this ON the
#  box that runs Docker, after `docker compose up -d --build`.
#
#  Result (with valid, auto-renewed certs — no port-forwarding, nothing public):
#    https://<your-box>.<tailnet>.ts.net        → the Argus UI + backend (:8080)
#    https://<your-box>.<tailnet>.ts.net:8443   → go2rtc streams (:1984)
#
#  Both are HTTPS, so the PWA installs and the (optionally Firebase-hosted) UI
#  can reach the backend with no mixed-content blocking. Only devices on your
#  tailnet can connect.
#
#  Prereqs:
#    • Tailscale installed + logged in on this box (https://tailscale.com/download)
#    • HTTPS enabled for your tailnet (Tailscale admin → DNS → enable HTTPS)
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  echo "[!] tailscale not found. Install + log in first: https://tailscale.com/download"
  exit 1
fi

echo "[*] Serving Argus UI/backend on https (443) → localhost:8080"
tailscale serve --bg --https=443 http://localhost:8080

echo "[*] Serving go2rtc on https (8443) → localhost:1984"
tailscale serve --bg --https=8443 http://localhost:1984

echo
echo "[*] Current Tailscale serve config:"
tailscale serve status || true
echo
echo "[✓] Open the UI at:  https://$(tailscale status --json 2>/dev/null | grep -o '\"DNSName\":\"[^\"]*' | head -1 | cut -d'\"' -f4 | sed 's/\.$//')"
echo "    (or run 'tailscale status' to find this machine's name)"
echo "    To stop sharing:  tailscale serve --https=443 off && tailscale serve --https=8443 off"
