// ─────────────────────────────────────────────────────────────────────────────
// Argus backend — a tiny zero-dependency Node server that:
//   • serves the web UI (video wall + config page)
//   • owns the camera list, persisted to /data/cameras.json (Docker volume)
//   • applies changes live to go2rtc via its stream API (no restart needed)
//
// No external packages: only Node built-ins + the global fetch (Node 18+).
// ─────────────────────────────────────────────────────────────────────────────
const http = require("http");
const fsp = require("fs/promises");
const fs = require("fs");
const path = require("path");

const VERSION = "1.0.0";
const PORT = Number(process.env.PORT || 8080);
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, "web");
const DATA_FILE = process.env.DATA_FILE || "/data/cameras.json";
const GO2RTC_URL = (process.env.GO2RTC_URL || "http://go2rtc:1984").replace(/\/+$/, "");
// Origin allowed to call the API cross-origin (e.g. a Firebase-hosted UI).
// Default "*": fine on a private Tailscale network with no credentials in play.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

// Seeded on first run so the user has editable examples, not a blank screen.
const SEED = [
  { id: "dahua_front", name: "Dahua — Front", url: "rtsp://admin:CHANGE_ME@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1", audio: true, talk: false },
  { id: "fanvil_intercom", name: "Fanvil Intercom", url: "rtsp://admin:CHANGE_ME@192.168.1.109:554/live/av0", audio: true, talk: true },
];

// ── Camera store ─────────────────────────────────────────────────────────────
const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "camera";

// UniFi Protect's copy-paste URL ends with `?enableSrtp`, but go2rtc
// mis-depacketizes that SRTP stream (missing PPS → the video won't decode).
// The same stream plays cleanly without it, so strip it automatically.
function cleanUrl(u) {
  return u
    .replace(/\?enableSrtp(&|$)/i, (_m, tail) => (tail === "&" ? "?" : ""))
    .replace(/&enableSrtp(&|$)/i, (_m, tail) => (tail === "&" ? "&" : ""));
}

// Force a clean, unique, valid list regardless of what the client sent.
function normalize(list) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c.url !== "string" || !c.url.trim()) continue;
    let id = slugify(c.id || c.name);
    let base = id, n = 2;
    while (seen.has(id)) id = `${base}_${n++}`;
    seen.add(id);
    out.push({
      id,
      name: String(c.name || id).slice(0, 80),
      url: cleanUrl(c.url.trim()),
      transcode: !!c.transcode,
    });
  }
  return out;
}

async function loadCameras() {
  try {
    const arr = JSON.parse(await fsp.readFile(DATA_FILE, "utf8"));
    if (Array.isArray(arr)) return normalize(arr);
  } catch {
    /* missing or corrupt → fall through to seed */
  }
  const seeded = normalize(SEED);
  await saveCameras(seeded).catch(() => {});
  return seeded;
}

async function saveCameras(list) {
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fsp.writeFile(DATA_FILE, JSON.stringify(list, null, 2));
}

// ── go2rtc sync ──────────────────────────────────────────────────────────────
async function go2rtc(pathq, method = "GET") {
  return fetch(GO2RTC_URL + pathq, { method });
}

async function listGo2rtcStreams() {
  try {
    const res = await go2rtc("/api/streams");
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

// Push our camera list into go2rtc: add/update each, delete any it has that we
// no longer want. go2rtc applies these immediately — this IS the "reload".
//
// We judge success by whether the stream actually ends up registered in go2rtc,
// not by the PUT status code: go2rtc creates the stream live but can return 400
// from its (secondary) config-persist step, which we don't rely on.
async function syncGo2rtc(list) {
  const enc = encodeURIComponent;
  const keep = new Set();

  for (const c of list) {
    keep.add(c.id);
    if (c.transcode) {
      // Force an ffmpeg re-encode to clean H.264/AAC read straight from the
      // camera URL — fixes streams that fail the browser MSE decoder (UniFi
      // especially) and plays over WebRTC and MSE, LAN or remote.
      const src = `ffmpeg:${c.url}#video=h264#audio=aac`;
      await go2rtc(`/api/streams?name=${enc(c.id)}&src=${enc(src)}`, "PUT").catch(() => {});
    } else {
      await go2rtc(`/api/streams?name=${enc(c.id)}&src=${enc(c.url)}`, "PUT").catch(() => {});
    }
  }

  const current = await listGo2rtcStreams();
  for (const name of Object.keys(current)) {
    if (!keep.has(name)) {
      await go2rtc(`/api/streams?src=${enc(name)}`, "DELETE").catch(() => {});
    }
  }

  // Real failures = cameras whose playable stream never registered.
  return list.filter((c) => !(c.id in current)).map((c) => `${c.id}: not registered by the engine`);
}

// The host's LAN IP that the *browser* can reach go2rtc's WebRTC media on.
// In Docker (bridge) the container can't see it, so it's supplied via HOST_IP
// (written by the installer). When not containerised, our own LAN IP is correct.
function hostIp() {
  if (process.env.HOST_IP && process.env.HOST_IP.trim()) return process.env.HOST_IP.trim();
  try { fs.accessSync("/.dockerenv"); return ""; } catch {}
  try { return require("./mdns").localIPv4() || ""; } catch { return ""; }
}

// Enable WebRTC by telling go2rtc which address to advertise as an ICE
// candidate. Without this, WebRTC can't connect through Docker and the player
// falls back to MSE — which fails to decode some cameras (e.g. UniFi) on Macs.
// Returns true if go2rtc was restarted (caller should wait for it again).
async function ensureWebrtcCandidate() {
  const ip = hostIp();
  if (!ip) return false;
  const cand = `${ip}:8555`;
  try {
    const res = await go2rtc("/api/config");
    const cfg = res.ok ? await res.text() : "";
    if (cfg.includes(cand)) return false; // already advertised
    await fetch(`${GO2RTC_URL}/api/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/yaml" },
      body: `webrtc:\n  candidates:\n    - ${cand}\n`,
    });
    await fetch(`${GO2RTC_URL}/api/restart`, { method: "POST" }).catch(() => {});
    console.log(`[argus] enabled WebRTC candidate ${cand}; restarting go2rtc`);
    return true;
  } catch {
    return false;
  }
}

function go2rtcUp() {
  return go2rtc("/api/streams").then((r) => r.ok).catch(() => false);
}
async function waitForGo2rtc(tries = 15) {
  for (let i = 0; i < tries; i++) {
    if (await go2rtcUp()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// On boot go2rtc may not be up yet — wait, enable WebRTC, then sync cameras.
async function initialSync() {
  const list = await loadCameras();
  if (!(await waitForGo2rtc())) {
    console.warn("[argus] go2rtc not reachable at boot; will sync on next save");
    return;
  }
  if (await ensureWebrtcCandidate()) await waitForGo2rtc();
  const errors = await syncGo2rtc(list);
  console.log(`[argus] synced ${list.length} camera(s) to go2rtc` + (errors.length ? ` (${errors.length} warning(s))` : ""));
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
};

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) reject(new Error("body too large"));
      else data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.join(WEB_DIR, rel);
  // Prevent path traversal outside WEB_DIR.
  if (!full.startsWith(path.resolve(WEB_DIR))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const buf = await fsp.readFile(full);
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}

// ── Router ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");

  // CORS — lets a separately-hosted frontend (Firebase) reach this backend.
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.writeHead(204).end();
    return;
  }

  try {
    if (pathname === "/api/cameras" && req.method === "GET") {
      return json(res, 200, await loadCameras());
    }

    if (pathname === "/api/cameras" && req.method === "PUT") {
      let parsed;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "invalid JSON" });
      }
      const list = normalize(parsed);
      await saveCameras(list);
      const errors = await syncGo2rtc(list);
      return json(res, 200, { ok: errors.length === 0, cameras: list, warnings: errors });
    }

    // Lightweight identity endpoint used by the config page's "Detect backend"
    // probe to recognise an Argus box on the local network.
    if (pathname === "/api/ping" && req.method === "GET") {
      const cams = await loadCameras().catch(() => []);
      return json(res, 200, { app: "argus", version: VERSION, cameras: cams.length });
    }

    if (pathname === "/api/health" && req.method === "GET") {
      const go2rtcUp = await go2rtc("/api/streams").then((r) => r.ok).catch(() => false);
      return json(res, 200, { go2rtc: go2rtcUp });
    }

    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405).end("method not allowed");
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.on("error", (e) => {
  console.error(`[argus] server error on :${PORT}:`, e.message);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`[argus] web UI on :${PORT}, go2rtc at ${GO2RTC_URL}`);
  initialSync();
  // Advertise argus.local on the LAN so devices can find the box with no IP.
  // Best-effort: needs multicast reach (host networking); harmless if it can't.
  if (process.env.MDNS_DISABLE !== "1") {
    try {
      require("./mdns").startMdns(process.env.MDNS_NAME || "argus.local");
    } catch (e) {
      console.warn("[argus] mDNS not started:", e.message);
    }
  }
});
