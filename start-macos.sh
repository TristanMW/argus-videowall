#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
#  Non-Docker launcher (macOS / Linux). Docker is the recommended path — see
#  README. This is for running straight from source. Needs Node.js 18+.
#    1. starts the go2rtc streaming engine
#    2. starts the Argus backend + web UI on http://localhost:8080
#    3. opens it in your browser
#
#  First-time setup: download the go2rtc binary for your OS from
#    https://github.com/AlexxIT/go2rtc/releases/latest
#  and place it at go2rtc/go2rtc (chmod +x it).
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

BIN="go2rtc/go2rtc"
if [[ ! -x "$BIN" ]]; then
  echo "[!] $BIN not found or not executable."
  echo "    Download from https://github.com/AlexxIT/go2rtc/releases/latest,"
  echo "    place it at $BIN, then: chmod +x $BIN"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js 18+ is required for the Argus backend. Install it or use Docker."
  exit 1
fi

cleanup() { kill "${GO2RTC_PID:-}" "${WEB_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "[*] Starting go2rtc engine..."
( cd go2rtc && ./go2rtc -config go2rtc.yaml ) & GO2RTC_PID=$!

echo "[*] Starting Argus web UI on http://localhost:8080 ..."
GO2RTC_URL="http://localhost:1984" DATA_FILE="./data/cameras.json" node server.js & WEB_PID=$!

sleep 2
open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 2>/dev/null || true

echo "[*] Running. Press Ctrl+C to stop."
wait
