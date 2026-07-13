#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Argus installer — macOS & Linux.
#
# Uses your existing Docker if it's installed; otherwise installs Docker, then
# builds and starts Argus. Re-runnable (idempotent).
#
#   ./install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

info() { printf '\033[36m[argus]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[argus]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[argus]\033[0m %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"

daemon_up()  { docker info >/dev/null 2>&1; }
compose_ok() { docker compose version >/dev/null 2>&1; }

wait_for_docker() {
  info "Waiting for the Docker daemon to be ready…"
  for _ in $(seq 1 60); do daemon_up && return 0; sleep 2; done
  err "Docker daemon didn't come up. Start Docker and re-run this script."
  exit 1
}

install_docker_linux() {
  info "Installing Docker Engine via get.docker.com (needs sudo)…"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sudo sh /tmp/get-docker.sh
  sudo systemctl enable --now docker 2>/dev/null || true
  if ! id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
    sudo usermod -aG docker "$USER" || true
    warn "Added '$USER' to the docker group — log out/in (or run 'newgrp docker') to use docker without sudo."
  fi
}

install_docker_mac() {
  if have brew; then
    info "Installing Docker Desktop via Homebrew…"
    brew install --cask docker
  else
    err "Docker isn't installed and Homebrew isn't available."
    err "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and re-run this script."
    exit 1
  fi
  info "Starting Docker Desktop…"
  open -a Docker || true
}

# ── 1. Ensure Docker is installed and running ────────────────────────────────
if have docker && daemon_up; then
  info "Existing Docker detected — building on it."
elif have docker; then
  warn "Docker is installed but the daemon isn't running. Starting it…"
  case "$OS" in
    Darwin) open -a Docker || true ;;
    Linux)  sudo systemctl start docker 2>/dev/null || true ;;
  esac
  wait_for_docker
else
  case "$OS" in
    Linux)  install_docker_linux ;;
    Darwin) install_docker_mac ;;
    *) err "Unsupported OS: $OS"; exit 1 ;;
  esac
  wait_for_docker
fi

# ── 2. Ensure Docker Compose v2 ──────────────────────────────────────────────
if ! compose_ok; then
  err "Docker Compose v2 not found. Docker Desktop bundles it; on Linux install the 'docker-compose-plugin' package."
  exit 1
fi

# Use sudo for docker only if the current user can't reach the daemon yet
# (happens right after a fresh Linux install, before re-login).
DK="docker"
daemon_up || DK="sudo docker"

# ── 3. Detect the LAN IP and enable WebRTC ───────────────────────────────────
# Written to .env so go2rtc advertises a reachable WebRTC candidate — without it
# the player falls back to MSE, which fails to decode some cameras (e.g. UniFi).
IP="$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null) | awk '{print $1}')"
if [ -n "${IP:-}" ]; then
  if [ -f .env ]; then grep -v '^HOST_IP=' .env > .env.tmp 2>/dev/null || true; mv .env.tmp .env 2>/dev/null || true; fi
  printf 'HOST_IP=%s\n' "$IP" >> .env
  info "Detected LAN IP $IP (WebRTC enabled via .env)."
else
  warn "Couldn't detect a LAN IP; WebRTC candidate not set. Video still works via MSE."
fi

# ── 4. Build and start Argus ─────────────────────────────────────────────────
info "Building and starting Argus…"
$DK compose up -d --build

echo
info "✅ Argus is running."
info "   Video wall :  http://localhost:8080"
info "   Add cameras:  http://localhost:8080/config.html"
[ -n "${IP:-}" ] && info "   On the LAN  :  http://$IP:8080"
info "   Stop it     :  docker compose down     (from this folder)"
