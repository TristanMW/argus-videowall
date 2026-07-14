// ─────────────────────────────────────────────────────────────────────────────
// Argus video wall — orchestration. Fetches cameras from the backend, drives the
// BSP wall engine (wall.js), and wires the toolbar + camera sidebar. Audio is
// part of the stream; a single global sound toggle mutes/unmutes the whole wall
// (there are no per-tile audio buttons). View-only, nothing recorded.
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const wallEl = $("wall");
const camListEl = $("cam-list");
const camCountEl = $("cam-count");
const searchEl = $("cam-search");
const hintEl = $("sidebar-hint");
const toastEl = $("toast");

let cameras = [];
let byId = new Map();
let soundOn = false;
let wall = null;

const nameFor = (id) => (byId.get(id)?.name) || id;
const videoUrl = (id) => `${ARGUS.go2rtcBase()}/stream.html?src=${encodeURIComponent(id)}&mode=webrtc,mse`;
const audioUrl = (id) => `${ARGUS.go2rtcBase()}/webrtc.html?src=${encodeURIComponent(id)}&media=video+audio`;
const urlFor = (id) => (soundOn ? audioUrl(id) : videoUrl(id));

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.hidden = true), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Camera sidebar ────────────────────────────────────────────────────────────
function renderSidebar() {
  const onWall = new Set(wall ? wall.currentCameraIds() : []);
  const q = searchEl.value.trim().toLowerCase();
  camListEl.innerHTML = "";
  const shown = cameras.filter((c) => !q || (c.name || c.id).toLowerCase().includes(q));

  for (const cam of shown) {
    const item = document.createElement("button");
    item.className = "nav-item" +
      (onWall.has(cam.id) ? " nav-item--active" : "") +
      (cam.disabled ? " nav-item--disabled" : "");
    item.innerHTML = `
      <svg class="nav-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 7h3l2-2h4l2 2h5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>
        <circle cx="11" cy="12" r="3.2"/>
      </svg>
      <span class="nav-item__name">${escapeHtml(cam.name || cam.id)}</span>
      <span class="nav-item__tag">${cam.disabled ? "over limit" : onWall.has(cam.id) ? "on wall" : "add"}</span>`;
    item.title = cam.disabled
      ? `${cam.name} is beyond your plan's camera limit`
      : onWall.has(cam.id) ? `${cam.name} is on the wall` : `Add ${cam.name} to the wall`;
    item.addEventListener("click", () => {
      if (cam.disabled) {
        toast("Over your plan's camera limit — increase your subscription on the account page");
        return;
      }
      wall.addCamera(cam.id);
      toast(`Added ${cam.name || cam.id}`);
    });
    camListEl.appendChild(item);
  }
  camCountEl.textContent = String(cameras.length);
  hintEl.textContent = cameras.length
    ? "Click a camera to place it · drag tile edges in Edit layout"
    : "";
}

// ── Toolbar wiring ────────────────────────────────────────────────────────────
function initToolbar() {
  $("presets").querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      wall.applyPreset(b.dataset.preset);
      setActivePreset(b.dataset.preset);
    })
  );

  const editBtn = $("edit-toggle");
  editBtn.addEventListener("click", () => {
    const next = wall.getMode() === "edit" ? "view" : "edit";
    wall.setMode(next);
    editBtn.setAttribute("aria-pressed", String(next === "edit"));
    editBtn.textContent = next === "edit" ? "Done" : "Edit layout";
    document.body.classList.toggle("editing", next === "edit");
  });

  const soundBtn = $("sound-toggle");
  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundBtn.textContent = soundOn ? "🔊" : "🔈";
    wall.refreshStreams();
    toast(soundOn ? "Sound on" : "Sound muted");
  });

  // The camera list can be minimised (☰ in the toolbar, « on the panel, or
  // the [ key) and the choice is remembered per browser.
  const sideBtn = $("sidebar-toggle");
  const setSidebarCollapsed = (collapsed) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    sideBtn.setAttribute("aria-pressed", String(!collapsed));
    sideBtn.title = collapsed ? "Show camera list ([)" : "Hide camera list ([)";
    try { localStorage.setItem("argus.sidebar.collapsed", collapsed ? "1" : "0"); } catch {}
  };
  sideBtn.addEventListener("click", () =>
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed")));
  $("sidebar-collapse").addEventListener("click", () => setSidebarCollapsed(true));
  try {
    if (localStorage.getItem("argus.sidebar.collapsed") === "1") setSidebarCollapsed(true);
  } catch {}

  $("fs-toggle").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  // In fullscreen, hide the camera sidebar so the wall uses the whole screen.
  document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("is-fullscreen", !!document.fullscreenElement);
  });

  // Keyboard: 1/2/3/4/5 presets, E edit, F fullscreen, [ sidebar, S sound.
  document.addEventListener("keydown", (e) => {
    if (/input|textarea/i.test(e.target.tagName)) return;
    const presetKeys = { "1": "1", "2": "4", "3": "9", "4": "16" };
    if (presetKeys[e.key]) { wall.applyPreset(presetKeys[e.key]); setActivePreset(presetKeys[e.key]); }
    else if (e.key.toLowerCase() === "e") $("edit-toggle").click();
    else if (e.key.toLowerCase() === "f") $("fs-toggle").click();
    else if (e.key.toLowerCase() === "s") $("sound-toggle").click();
    else if (e.key === "[") $("sidebar-toggle").click();
  });

  searchEl.addEventListener("input", renderSidebar);
}

function setActivePreset(name) {
  $("presets").querySelectorAll("[data-preset]").forEach((b) =>
    b.classList.toggle("seg__btn--active", b.dataset.preset === name));
}

// This HTTPS page can't load the box's plain-HTTP video (browser "mixed
// content"). Tell the user how to fix it instead of failing silently.
function warnIfMixedContent() {
  if (location.protocol !== "https:") return;
  if (!ARGUS.go2rtcBase().startsWith("http://")) return;
  const host = new URL(ARGUS.backendBase()).hostname;
  const bar = document.createElement("div");
  bar.className = "mixed-warn";
  bar.innerHTML = `⚠ This secure (HTTPS) page can't load video from your box over plain HTTP — browsers block it.
    On your LAN, open the box directly at <a href="http://${escapeHtml(host)}:8080">http://${escapeHtml(host)}:8080</a>.
    For remote access, give the box HTTPS with Tailscale, then set that URL under <b>⚙ Backend</b>.
    <button class="mixed-x" title="Dismiss">✕</button>`;
  bar.querySelector(".mixed-x").addEventListener("click", () => bar.remove());
  document.body.insertBefore(bar, document.body.firstChild);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function tickClock() {
  const d = new Date();
  $("clock").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function start() {
  wall = window.Wall.create({
    container: wallEl,
    urlFor,
    nameFor,
    storageKey: `argus.layout.${ARGUS.backendBase()}`,
    onChange: renderSidebar,
  });
  initToolbar();
  tickClock();
  setInterval(tickClock, 1000);

  // Kiosk mode: ?kiosk=1 hides all chrome for a wall-mounted display.
  if (new URLSearchParams(location.search).get("kiosk") === "1") {
    document.body.classList.add("kiosk");
  }

  warnIfMixedContent();

  fetch(`${ARGUS.backendBase()}/api/cameras`)
    .then((r) => {
      if (r.status === 403) { showGate(); return null; }
      return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`));
    })
    .then((list) => {
      if (list === null) return;
      cameras = Array.isArray(list) ? list : [];
      byId = new Map(cameras.map((c) => [c.id, c]));
      wall.setCameras(cameras);
      renderSidebar();
      if (!cameras.length) toast("No cameras yet — add them in ⚙ settings");
    })
    .catch((err) => {
      wallEl.innerHTML = `<div class="wall-empty">Couldn't reach the backend (${escapeHtml(err.message)}).<br>
        Open <a href="config.html">⚙ settings</a> to connect.</div>`;
    });
}

// ── Account gate: the box must be linked to an Argus account first ───────────
// Sign-in uses the Firebase Auth REST API (works on any LAN origin) and hands
// the refresh token to the backend, which links the box and follows the
// account's license from then on.
const FIREBASE_API_KEY = "AIzaSyDwnINHwoFL9of-FrOOPN2KKr0K0hO0J-s";

function showGate() {
  $("signin-gate").hidden = false;
}

async function gateAuth() {
  const email = $("gate-email").value.trim();
  const pass = $("gate-pass").value;
  const noteEl = $("gate-note");
  const btn = $("gate-signin");
  if (!email || !pass) { noteEl.textContent = "Enter your email and password."; return; }
  btn.disabled = true;
  noteEl.textContent = "Signing in…";
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      const code = (data.error && data.error.message) || "";
      throw new Error(/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(code)
        ? "Wrong email or password. (Signed up with Google? Use “Forgot password” on the account page to set one.)"
        : `Sign-in failed: ${code || res.status}`);
    }
    noteEl.textContent = "Linking this box…";
    const linkRes = await fetch(`${ARGUS.backendBase()}/api/license/link`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: data.refreshToken, email }),
    });
    if (!linkRes.ok) throw new Error("Could not link the box — is the backend reachable?");
    noteEl.textContent = "Done — loading your wall…";
    location.reload();
  } catch (err) {
    noteEl.textContent = err.message;
    btn.disabled = false;
  }
}
$("gate-signin").addEventListener("click", gateAuth);
$("gate-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") gateAuth(); });

async function boot() {
  let lic = null;
  try {
    lic = await (await fetch(`${ARGUS.backendBase()}/api/license`, { cache: "no-store" })).json();
  } catch { /* backend unreachable — start() shows its own error */ }
  if (lic && lic.requireAccount && !lic.linked) { showGate(); return; }
  start();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
