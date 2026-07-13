# Argus Video Wall

A browser-based, **view-only** video wall for RTSP/RTSPS cameras — including
devices SmartPSS and similar apps refuse to add (Fanvil intercoms, UniFi Protect,
etc.). Low latency, audio, a **resizable custom layout**, and installable as an
app (PWA). **No recording.**

**Everything runs on your own box.** RTSP reading, stream rendering, camera
config, and the UI are all served locally by Docker. The frontend bundles no
third-party scripts and makes no calls to the internet — **your video and camera
details never leave your network.** Secure remote viewing is optional, via
Tailscale (a private encrypted mesh), never public port-forwarding.

```
 RTSP/RTSPS cameras ──▶ go2rtc (local)  ──WebRTC/MSE──▶  your browser (video wall)
                            ▲
        Argus backend (local, Node) ── owns the camera list, serves the UI,
                                        configures go2rtc live
```

Built on [go2rtc](https://github.com/AlexxIT/go2rtc) for RTSP → WebRTC/MSE.

---

## Contents
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install) — [Windows](#windows) · [macOS](#macos) · [Linux](#linux)
- [First use — add your cameras](#first-use--add-your-cameras)
- [Using the video wall](#using-the-video-wall)
- [Finding your RTSP URLs](#finding-your-rtsp-urls)
- [Viewing from other devices (important: HTTP vs HTTPS)](#viewing-from-other-devices)
- [Install as an app (PWA)](#install-as-an-app-pwa)
- [Remote access (Tailscale)](#remote-access-tailscale)
- [Managing & updating](#managing--updating)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## Features

- **Live video wall** with layout presets (1, 2×2, 2×3, 3×3, 4×4) and a
  **custom resizable layout** — drag tile edges and the neighbours reflow in
  real time. Layouts are saved per box in your browser.
- **Manage cameras from the browser** — add / edit / delete RTSP URLs and apply
  them to the streaming engine **live, with no restart**.
- **Camera sidebar** with search; click a camera to drop it on the wall.
- **Global sound toggle**, per-tile & whole-wall **fullscreen**, **kiosk mode**
  (`?kiosk=1`) for wall-mounted displays, and keyboard shortcuts
  (`1–4` presets, `E` edit, `F` fullscreen, `S` sound, `[` sidebar).
- **Installable PWA** (network-first: a refresh always gets the latest).
- **Auto network discovery** — a device that didn't load the UI from the box can
  find it with **🔍 Detect on network** (mDNS `argus.local`).
- **Handles awkward cameras**: auto-fixes UniFi's `?enableSrtp`, auto-enables
  WebRTC, and an optional per-camera **Transcode** for streams that won't decode.
- **View-only** — no recording; the only stored data is your camera list.

---

## Requirements

- A machine to run it on: **Windows 10/11, macOS, or Linux**. A spare mini-PC,
  NAS, or Raspberry Pi 4+ is ideal — it can stay on 24/7.
- **Docker** — the installer sets it up if you don't have it.
- Your cameras' **RTSP URLs** (see [below](#finding-your-rtsp-urls)).

The installer **detects an existing Docker install and builds on it**; it only
installs Docker if it's missing.

---

## Install

Get the project:

```bash
git clone https://github.com/TristanMW/argus-videowall.git
cd argus-videowall
```

Then follow your platform.

### Windows

1. Open **PowerShell** in the `argus-videowall` folder (Shift-right-click →
   *Open PowerShell window here*).
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   If Docker is missing it installs **Docker Desktop** via `winget` (you may be
   prompted to **sign out or reboot** for the WSL2 backend, then re-run).
3. Open **http://localhost:8080**.

> No `winget`? Install Docker Desktop from
> <https://www.docker.com/products/docker-desktop/>, start it, then re-run.

### macOS

```bash
./install.sh
```
Installs **Docker Desktop** via [Homebrew](https://brew.sh) if needed, then
builds and starts Argus. Open **http://localhost:8080**.

### Linux

```bash
./install.sh
```
Installs **Docker Engine** via [get.docker.com](https://get.docker.com) if needed
and adds you to the `docker` group (log out/in, then re-run). Open
**http://localhost:8080** (or `http://<box-ip>:8080` from another LAN device).

> **Ubuntu note:** don't use **snap** Docker — it can't reliably stop containers
> (`cannot stop container: permission denied`). Use the apt Docker from
> get.docker.com. If you're already on snap Docker: `sudo snap remove docker`
> (back up first if you run other containers) then the get.docker.com install.

### Already have Docker? (any OS)

```bash
docker compose up -d --build
```

The installer also writes your LAN IP to `.env` (`HOST_IP=…`) so go2rtc can
advertise a reachable **WebRTC** candidate. If you run `docker compose` by hand,
set it yourself (`HOST_IP=<box-lan-ip> docker compose up -d --build`) to get
WebRTC instead of the higher-latency MSE fallback.

---

## First use — add your cameras

1. Open the **Cameras** page: **http://localhost:8080/config.html**.
2. Click **＋ Add camera** and fill in:
   - **Name** — a label for the tile (e.g. *Front Gate*).
   - **RTSP URL** — see [below](#finding-your-rtsp-urls).
   - **Transcode** — leave off. Only tick it for a camera that won't play (it
     re-encodes to clean H.264 in go2rtc; costs CPU; doesn't work for encrypted
     `rtsps` sources — see UniFi note).
3. Click **💾 Save & apply** — changes go live immediately.
4. Open the **Video wall** (**http://localhost:8080**).

Cameras persist in a Docker volume across restarts. Use a row's **Test ▶** to
open just that stream and confirm the URL is good.

---

## Using the video wall

- **Presets**: the `1 / 2×2 / 2×3 / 3×3 / 4×4` buttons in the top bar (or keys
  `1`–`4`).
- **Custom layout**: click **Edit layout**, then **drag any tile edge** — the
  other tiles resize live to show the result. Use the **✕** on a tile to remove
  it. Click **Done** to lock it. Your layout is remembered per box.
- **Add / arrange cameras**: open the **☰** sidebar and click a camera to place
  it. (Toggle the sidebar with `[`.)
- **Sound**: the 🔈 button toggles audio for the whole wall (`S`). Off by default.
- **Fullscreen**: the ⛶ button (or `F`) — the sidebar hides so the wall fills the
  screen.
- **Kiosk mode**: open `…:8080/?kiosk=1` for a chromeless, wall-mounted display.

---

## Finding your RTSP URLs

- **Dahua:**
  ```
  rtsp://<user>:<pass>@<ip>:554/cam/realmonitor?channel=1&subtype=0   # main
  rtsp://<user>:<pass>@<ip>:554/cam/realmonitor?channel=1&subtype=1   # sub (lighter)
  ```
  Use the `subtype=1` sub-stream for wall tiles — much lighter at scale.
- **Fanvil intercoms:** commonly `rtsp://<user>:<pass>@<ip>:554/live/av0`, but
  the path **varies by model/firmware** — confirm in the device web UI under
  *Intercom → RTSP*.
- **UniFi Protect:** the copy button gives a URL ending in `?enableSrtp`, e.g.
  `rtsps://<console-ip>:7441/<token>?enableSrtp`. **Paste it as-is** — Argus
  automatically strips `?enableSrtp`, which go2rtc mis-decodes (missing PPS → no
  video). The working form is:
  ```
  rtsps://<console-ip>:7441/<token>
  ```
  Enable a lower-resolution stream in Protect for wall tiles. (The old
  `rtsp://…:7447/<token>` port is disabled on current UniFi OS.)
- **Test any URL first** in VLC (*Media → Open Network Stream*) or with
  `ffprobe "<url>"`. You can also check a stream at the engine dashboard,
  **http://localhost:1984**.

---

## Viewing from other devices

How you reach Argus matters, because of one browser rule: **an HTTPS page cannot
load plain-HTTP video** ("mixed content"). Pick the path that fits:

| From | Open this | Notes |
|------|-----------|-------|
| The box itself | `http://localhost:8080` | Everything local. |
| Another device on the LAN | `http://<box-ip>:8080` | Plain HTTP — video loads fine. Use **🔍 Detect on network** or `http://argus.local:8080` if mDNS works. |
| A hosted (HTTPS) copy of the UI, or anywhere remote | your box's **Tailscale HTTPS** URL | Required — an HTTPS page can't reach a plain-HTTP box (video is blocked / the page shows "Not secure"). See below. |

**In short:** on the LAN, use the box's own `http://…:8080` page. To use an
HTTPS-hosted UI or watch remotely, give the box HTTPS with **Tailscale**.

---

## Install as an app (PWA)

In Chrome/Edge, open the wall and use **Install app** (address-bar icon), or
**Add to Home Screen** on mobile. It opens in its own window; the app shell works
offline (live video still needs the box). The service worker is **network-first**,
so a refresh always loads the latest version.

> PWA install needs a *secure context*: `http://localhost` on the same machine,
> or an HTTPS address (Tailscale). Over a plain `http://<LAN-IP>` it runs but
> won't install.

---

## Remote access (Tailscale)

To watch away from home — or to use an HTTPS-hosted copy of the UI — without
exposing anything to the public internet, use [Tailscale](https://tailscale.com)
(a private, WireGuard-encrypted mesh):

1. Install Tailscale on the box and on the devices you'll watch from; sign in.
2. Enable HTTPS for your tailnet (Tailscale admin → DNS → *Enable HTTPS*).
3. On the box, run:
   ```bash
   ./tailscale-serve.sh
   ```
   This publishes the **UI on `https://<box>.<tailnet>.ts.net`** and **go2rtc on
   `:8443`**, both with valid auto-renewed certs, reachable only by your devices.
4. If you use a separately-hosted UI, open its **⚙ Backend** panel and set the
   backend to that `https://<box>.<tailnet>.ts.net` address.

Everything is then HTTPS end-to-end — the padlock is restored and video plays on
the LAN and remotely.

---

## Managing & updating

Run from the `argus-videowall` folder:

| Task | Command |
|------|---------|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Logs | `docker compose logs -f` |
| **Update to latest** | `./update.sh` |
| Restart the engine only | `docker compose restart go2rtc` |

**`./update.sh`** pulls the latest code, updates images, and rebuilds the
containers **without touching your saved cameras** — they live in the `argus-data`
volume, which is preserved (it never runs `down -v`). Your wall layout lives in
the browser and is also untouched. If the Docker daemon refuses to stop a
container (snap-Docker/AppArmor), the script force-removes and, failing that,
tells you exactly how to recover.

---

## Troubleshooting

- **A UniFi tile won't play / decode errors:** make sure the URL has **no**
  `?enableSrtp` (Argus strips it automatically on save). If you added it before
  this behaviour existed, re-save the camera.
- **Video works but latency is ~1s / console shows `video/mp4` (MSE):** WebRTC
  isn't connecting. Check the backend advertised a candidate —
  `docker logs argus-web | grep -i webrtc` should show
  `enabled WebRTC candidate <ip>:8555`. Ensure `HOST_IP` is set (installer does
  this) and that port **8555** (tcp+udp) is reachable (`ufw allow 8555`).
- **A hosted (HTTPS) page shows "Not secure" and/or no video:** that's mixed
  content — an HTTPS page can't load your HTTP box. Use `http://<box-ip>:8080`
  on the LAN, or set up **Tailscale** for HTTPS. (It's not the network scanner.)
- **Tile stays "Connecting…":** the RTSP URL/credentials are likely wrong. Test
  at <http://localhost:1984> or in VLC.
- **Config page can't reach the backend:** confirm the containers are up
  (`docker compose ps`); on another device use **🔍 Detect on network** or set
  the box address under **⚙ Backend**.
- **`cannot stop container: permission denied` (Ubuntu):** you're on **snap**
  Docker. `sudo snap restart docker` unblocks it now; switch to apt Docker
  (get.docker.com) to fix it for good.
- **`argus.local` doesn't resolve:** mDNS needs host networking to reach the LAN
  (Linux; see `docker-compose.yml`). On Docker Desktop use the box IP or a
  Tailscale name.
- **Choppy with many cameras:** use each camera's **sub-stream**; full-res is
  heavy at scale.
- **Port already in use:** something else holds `8080`/`1984` — edit the `ports:`
  in `docker-compose.yml`.

---

## Security notes

- All processing and the UI are served locally; the frontend makes **no external
  calls** and **no video or metadata leaves your network**.
- No login on the wall by design — it's a private-network appliance. For remote
  access use **Tailscale** (and its ACLs), not port-forwarding. Don't expose
  `8080`/`1984`/`8555` to the public internet.
- View-only: Argus does **not** record, and stores nothing but your camera list.

---

See [`docs/app_details.md`](docs/app_details.md) for architecture and design
decisions.
