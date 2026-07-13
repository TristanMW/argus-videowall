# Argus Video Wall

A browser-based, **view-only** video wall for RTSP cameras — including devices
SmartPSS and similar apps refuse to add, like a Fanvil intercom. Low latency,
audio, optional two-way talk, installable as an app (PWA). **No recording.**

**Everything runs on your box.** RTSP reading, stream rendering, camera config,
and the UI are all served locally by Docker. The frontend bundles no third-party
scripts and makes no calls to the internet — **video and camera details never
leave your network.** Optional secure remote viewing is via Tailscale (a private
encrypted mesh), never public exposure.

```
 RTSP cameras ──▶ go2rtc (local) ──▶ your browser (video wall)
                     ▲
        Argus backend (local) ── manages cameras, serves the UI
```

---

## Contents
- [Requirements](#requirements)
- [Install](#install) — [Windows](#windows) · [macOS](#macos) · [Linux](#linux)
- [First use — add your cameras](#first-use--add-your-cameras)
- [Finding your RTSP URLs](#finding-your-rtsp-urls)
- [Install as an app (PWA)](#install-as-an-app-pwa)
- [Remote access (optional, Tailscale)](#remote-access-optional-tailscale)
- [Managing Argus](#managing-argus)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## Requirements

- A machine to run it on: **Windows 10/11, macOS, or Linux** (a spare mini-PC,
  NAS, or Raspberry Pi 4+ works great and can stay on 24/7).
- **Docker** — the installer sets this up for you if you don't have it.
- Your cameras' **RTSP URLs** (see [below](#finding-your-rtsp-urls)).

The installer **detects an existing Docker install and builds on it**; only if
Docker is missing does it install it.

---

## Install

First, get the project:

```bash
git clone https://github.com/TristanMW/argus-videowall.git
cd argus-videowall
```

Then follow your platform below.

### Windows

1. Open **PowerShell** in the `argus-videowall` folder (Shift-right-click →
   *Open PowerShell window here*).
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   - If Docker is already installed, it just builds and starts Argus.
   - If not, it installs **Docker Desktop** via `winget`. You may be prompted to
     **sign out or reboot** (Docker needs the WSL2 backend). After that, re-run
     the same command.
3. When it finishes, open **http://localhost:8080**.

> No `winget`? Install Docker Desktop manually from
> <https://www.docker.com/products/docker-desktop/>, start it, then re-run the
> script.

### macOS

1. Open **Terminal** in the `argus-videowall` folder.
2. Run:
   ```bash
   ./install.sh
   ```
   - If Docker is already running, it just builds and starts Argus.
   - If not, it installs **Docker Desktop** via [Homebrew](https://brew.sh)
     (`brew install --cask docker`) and starts it. If you don't have Homebrew,
     install Docker Desktop from
     <https://www.docker.com/products/docker-desktop/> and re-run.
3. When it finishes, open **http://localhost:8080**.

### Linux

1. In a terminal, from the `argus-videowall` folder:
   ```bash
   ./install.sh
   ```
   - If Docker is already installed, it builds and starts Argus.
   - If not, it installs **Docker Engine** via the official
     [get.docker.com](https://get.docker.com) script (uses `sudo`) and adds you
     to the `docker` group. Log out/in (or run `newgrp docker`) afterwards, then
     re-run.
2. When it finishes, open **http://localhost:8080** (or `http://<box-ip>:8080`
   from another device).

### Already have Docker? (any OS)

Skip the scripts entirely:

```bash
docker compose up -d --build
```

---

## First use — add your cameras

1. Open the **Cameras** page: **http://localhost:8080/config.html**.
2. Click **➕ Add camera** and fill in:
   - **Name** — a label for the tile (e.g. *Front Gate*).
   - **RTSP URL** — see [below](#finding-your-rtsp-urls).
   - **Listen** — tick to enable the 🔊 audio button on that tile.
   - **Talk** — tick for a 🎙 push-to-talk button (two-way intercoms like Fanvil).
3. Click **💾 Save & apply**. Changes go live immediately — no restart.
4. Open the **Video wall** (**http://localhost:8080**). Use the layout selector
   for 1–16 tiles; hover a tile for listen / talk / fullscreen.

Cameras are stored on the box (in a Docker volume) and persist across restarts.
Use the per-row **Test ▶** button to open a single stream and confirm it works.

---

## Finding your RTSP URLs

- **Dahua cameras:**
  ```
  rtsp://<user>:<pass>@<ip>:554/cam/realmonitor?channel=1&subtype=0   # main stream
  rtsp://<user>:<pass>@<ip>:554/cam/realmonitor?channel=1&subtype=1   # sub stream
  ```
  Use `subtype=1` (lower-res sub-stream) for a multi-camera wall — much lighter.
- **Fanvil intercoms:** commonly
  ```
  rtsp://<user>:<pass>@<ip>:554/live/av0
  ```
  but the path **varies by model/firmware** — confirm in the device web UI under
  *Intercom → RTSP*, or its datasheet.
- **UniFi Protect:** the UI shows an encrypted URL like
  `rtsps://<console-ip>:7441/<token>?enableSrtp`. Prefer the **unencrypted**
  form — same token, port **7447**, no `?enableSrtp` — which is far more
  compatible with go2rtc:
  ```
  rtsp://<console-ip>:7447/<token>
  ```
  Enable a lower-resolution stream in Protect for wall tiles. Note: UniFi
  streams often fail the MSE fallback in-browser, so WebRTC (see below) matters.
- **Test first:** paste the URL into VLC (*Media → Open Network Stream*) or run
  `ffprobe "<url>"` before adding it, so you know the URL itself is good.
- The streaming engine has its own dashboard at **http://localhost:1984** for
  checking an individual stream.

---

## Install as an app (PWA)

Argus is a Progressive Web App. In Chrome/Edge, open the wall and use **Install
app** (address-bar icon), or **Add to Home Screen** on mobile. It then opens in
its own window and works offline as a shell (live video still needs the box).

> PWA install requires a *secure context*: `http://localhost` on the same
> machine, or an HTTPS address (see Tailscale below). Over a plain
> `http://<LAN-IP>` the app runs but won't install.

---

## Remote access (optional, Tailscale)

To view your cameras securely when away — without exposing anything to the public
internet — use [Tailscale](https://tailscale.com) (a private, encrypted mesh):

1. Install Tailscale on the box and on your phone/laptop; sign in on each.
2. On the box, enable HTTPS for your tailnet (Tailscale admin → DNS), then run:
   ```bash
   ./tailscale-serve.sh
   ```
   This publishes the UI at `https://<box>.<tailnet>.ts.net` and go2rtc at
   `:8443`, with valid certs — reachable only by your own devices.

---

## Managing Argus

Run these from the `argus-videowall` folder:

| Task | Command |
|------|---------|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| View logs | `docker compose logs -f` |
| **Update to latest** | `./update.sh` |
| Restart just the engine | `docker compose restart go2rtc` |

`./update.sh` pulls the latest code, tears down and rebuilds the containers, and
updates images — **without touching your saved cameras** (they live in the
`argus-data` volume, which is preserved). Your wall layout is stored in the
browser and is likewise unaffected. If a Firebase hosting config is present on
the machine, it also redeploys the hosted UI.

---

## Troubleshooting

- **A tile stays black / "Connecting…":** the RTSP URL or credentials are likely
  wrong. Test it at <http://localhost:1984> or in VLC. On the Cameras page, a
  save with a bad URL shows a warning.
- **Config page says it can't reach the backend:** make sure the containers are
  up (`docker compose ps`). On a different device, use **🔍 Detect on network**
  or enter the box address manually.
- **`argus.local` doesn't resolve:** mDNS needs host networking to reach the LAN
  (Linux hosts — see `docker-compose.yml`); on Docker Desktop for Windows/Mac it
  may not, so use the box's IP or a Tailscale name instead.
- **Choppy video with many cameras:** use each camera's **sub-stream**
  (`subtype=1` on Dahua) — full-res streams are heavy at scale.
- **Port already in use:** something else is on `8080`/`1984`. Edit the `ports:`
  in `docker-compose.yml`.

---

## Security notes

- All processing and the UI are served locally; the app makes **no external
  calls** and **no video or metadata leaves your network**.
- There's no login on the wall by design — it's a private-network appliance.
  If you need remote access, use **Tailscale** (and its ACLs) rather than
  port-forwarding. Don't expose ports `8080`/`1984` to the public internet.
- View-only: Argus does **not** record and stores nothing but your camera list.

---

Built on [go2rtc](https://github.com/AlexxIT/go2rtc) for RTSP → WebRTC/MSE
streaming. See [`docs/app_details.md`](docs/app_details.md) for architecture and
design decisions.
