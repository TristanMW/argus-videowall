#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Argus updater — pulls latest code, rebuilds the local Docker stack, and (if
# Firebase hosting is configured on this machine) redeploys the hosted UI.
#
#   ./update.sh [path-to-firebase-service-account.json]
#
# What it does:
#   1. git pull (fast-forward)
#   2. refresh HOST_IP in .env (keeps WebRTC working)
#   3. docker compose down       — stops & removes the containers
#      (named volumes are KEPT, so your camera list is preserved)
#   4. docker compose pull        — updates the go2rtc image
#   5. docker compose up -d --build  — rebuilds & starts everything
#   6. redeploy web/ to Firebase Hosting IF firebase.json + deploy-hosting.sh
#      are present locally (skipped for plain self-hosters)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

info() { printf '\033[36m[argus]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[argus]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[argus]\033[0m %s\n' "$*" >&2; }

# ── 1. Pull latest code ──────────────────────────────────────────────────────
# NOTE ON SAVED CONFIG: your cameras live in the `argus-data` Docker volume
# (cameras.json), and your wall layout lives in the browser — neither is touched
# by this update. go2rtc DOES rewrite go2rtc.yaml at runtime (candidate + stream
# list); that file is fully regenerated from cameras.json on startup, so we reset
# it (backing it up first) only so `git pull` can fast-forward cleanly.
if [ -d .git ]; then
  if ! git diff --quiet -- go2rtc/go2rtc.yaml 2>/dev/null; then
    cp go2rtc/go2rtc.yaml go2rtc/go2rtc.yaml.bak 2>/dev/null || true
    git checkout -- go2rtc/go2rtc.yaml 2>/dev/null || true
    info "Reset runtime-written go2rtc.yaml (backup: go2rtc/go2rtc.yaml.bak). Cameras are unaffected."
  fi
  info "Pulling latest code…"
  if ! git pull --ff-only; then
    err "git pull failed (local changes or diverged history). Resolve it and re-run."
    err "Your camera data is safe in the 'argus-data' volume regardless."
    exit 1
  fi
else
  warn "Not a git checkout — skipping git pull (updating containers from current files)."
fi

# ── 2. Pick docker command (sudo only if the daemon needs it) ─────────────────
if ! command -v docker >/dev/null 2>&1; then
  err "Docker isn't installed. Run ./install.sh first."
  exit 1
fi
DK="docker"
docker info >/dev/null 2>&1 || DK="sudo docker"

# ── 3. Refresh the LAN IP so WebRTC stays enabled ────────────────────────────
IP="$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null) | awk '{print $1}')"
if [ -n "${IP:-}" ]; then
  if [ -f .env ]; then grep -v '^HOST_IP=' .env > .env.tmp 2>/dev/null || true; mv .env.tmp .env 2>/dev/null || true; fi
  printf 'HOST_IP=%s\n' "$IP" >> .env
  info "LAN IP $IP (WebRTC enabled)."
fi

# ── 4. Stop + remove containers (KEEP volumes → camera list survives) ────────
info "Stopping and removing containers…"
$DK compose down --remove-orphans

# ── 5. Update images + rebuild + start ───────────────────────────────────────
info "Updating base images…"
$DK compose pull || warn "compose pull had warnings (continuing)."
info "Rebuilding and starting…"
$DK compose up -d --build

# brief health check
sleep 3
if curl -fsS "http://localhost:8080/api/ping" >/dev/null 2>&1; then
  info "Backend is up."
else
  warn "Backend not answering yet on :8080 — give it a few seconds, then check 'docker compose logs -f'."
fi

# ── 6. Redeploy the Firebase-hosted UI (only if configured on this machine) ──
if [ -f firebase.json ] && [ -f deploy-hosting.sh ]; then
  info "Redeploying the Firebase-hosted UI…"
  if ! ./deploy-hosting.sh "$@"; then
    warn "Firebase redeploy failed or was skipped (need the service-account key). Local Docker is updated regardless."
  fi
else
  info "No Firebase hosting config here — skipping hosted-UI redeploy (local Docker updated)."
fi

echo
info "✅ Update complete."
info "   Video wall :  http://localhost:8080"
[ -n "${IP:-}" ] && info "   On the LAN  :  http://$IP:8080"
