// ─────────────────────────────────────────────────────────────────────────────
// Video-wall app. Cameras come from the Argus backend (GET /api/cameras). Each
// tile is an <iframe> pointing at go2rtc's own WebRTC player, so go2rtc handles
// codec negotiation, audio and reconnection. Nothing is recorded — this is
// view + listen (and, for the intercom, talk) only.
// ─────────────────────────────────────────────────────────────────────────────

const wall = document.getElementById("wall");
const statusEl = document.getElementById("status");
const gridSelect = document.getElementById("grid-select");

const GRID_KEY = "argus.grid";
let cameras = [];

// Resolved by settings.js — works served-from-box or Firebase-hosted.
const base = () => ARGUS.go2rtcBase();

// go2rtc player URLs. stream.html = lowest-latency video; webrtc.html supports
// audio and (with +microphone) two-way talk.
const videoOnlyUrl = (src) =>
  `${base()}/stream.html?src=${encodeURIComponent(src)}&mode=webrtc,mse`;
const audioUrl = (src) =>
  `${base()}/webrtc.html?src=${encodeURIComponent(src)}&media=video+audio`;
const talkUrl = (src) =>
  `${base()}/webrtc.html?src=${encodeURIComponent(src)}&media=video+audio+microphone`;

// Map a "how many tiles" choice to a column count that stays roughly square.
function colsFor(grid) {
  return { 1: 1, 4: 2, 6: 3, 9: 3, 16: 4 }[grid] || Math.ceil(Math.sqrt(grid));
}

function createTile(cam) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.dataset.audio = "off"; // off → video only; on → listening; talk → mic live

  const frame = document.createElement("iframe");
  frame.className = "player";
  frame.allow = "autoplay; microphone; fullscreen";
  frame.setAttribute("allowfullscreen", "");
  frame.src = videoOnlyUrl(cam.id);

  const msg = document.createElement("div");
  msg.className = "msg";
  msg.textContent = "Connecting…";
  frame.addEventListener("load", () => (msg.style.display = "none"));

  const btns = [];
  if (cam.audio) btns.push(`<button class="tile-btn audio-btn" title="Listen">🔊</button>`);
  if (cam.talk) btns.push(`<button class="tile-btn talk-btn" title="Push to talk (two-way)">🎙</button>`);
  btns.push(`<button class="tile-btn fs-btn" title="Fullscreen this camera">⛶</button>`);

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <span class="label"><span class="dot"></span>${escapeHtml(cam.name || cam.id)}</span>
    <span class="tile-btns">${btns.join("")}</span>`;

  tile.append(frame, msg, overlay);

  // Switching audio state means reloading the iframe with a different media set,
  // because go2rtc negotiates tracks at connect time.
  function setMode(mode) {
    tile.dataset.audio = mode;
    msg.style.display = "";
    msg.textContent = "Connecting…";
    frame.src =
      mode === "talk" ? talkUrl(cam.id)
      : mode === "on" ? audioUrl(cam.id)
      : videoOnlyUrl(cam.id);
    overlay.querySelector(".audio-btn")?.classList.toggle("active", mode === "on");
    overlay.querySelector(".talk-btn")?.classList.toggle("active", mode === "talk");
  }

  overlay.querySelector(".audio-btn")?.addEventListener("click", () =>
    setMode(tile.dataset.audio === "on" ? "off" : "on")
  );
  overlay.querySelector(".talk-btn")?.addEventListener("click", () =>
    setMode(tile.dataset.audio === "talk" ? "off" : "talk")
  );
  overlay.querySelector(".fs-btn").addEventListener("click", () => {
    if (tile.requestFullscreen) tile.requestFullscreen().catch(() => {});
  });

  tile._muteAudio = () => {
    if (tile.dataset.audio !== "off") setMode("off");
  };

  return tile;
}

function buildWall(grid) {
  wall.innerHTML = "";
  wall.style.setProperty("--cols", colsFor(grid));
  localStorage.setItem(GRID_KEY, String(grid));

  if (!cameras.length) {
    wall.innerHTML =
      '<div class="empty">No cameras yet — <a href="config.html">add one in the Cameras page</a>.</div>';
    statusEl.textContent = "";
    return;
  }

  const shown = cameras.slice(0, grid);
  shown.forEach((cam) => wall.appendChild(createTile(cam)));
  statusEl.textContent = `${shown.length} / ${cameras.length} cameras`;
}

function muteAll() {
  wall.querySelectorAll(".tile").forEach((t) => t._muteAudio && t._muteAudio());
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ── Wire up toolbar ──────────────────────────────────────────────────────────
gridSelect.value = localStorage.getItem(GRID_KEY) || "4";
gridSelect.addEventListener("change", () => buildWall(Number(gridSelect.value)));
document.getElementById("mute-all").addEventListener("click", muteAll);
document.getElementById("fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

// ── Boot ─────────────────────────────────────────────────────────────────────
statusEl.textContent = "Loading cameras…";
fetch(`${ARGUS.backendBase()}/api/cameras`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((list) => {
    cameras = Array.isArray(list) ? list : [];
    buildWall(Number(gridSelect.value));
  })
  .catch((err) => {
    statusEl.textContent = "";
    wall.innerHTML = `<div class="empty">Couldn't reach the backend (${escapeHtml(
      err.message
    )}).<br>If the UI is hosted separately, set the backend URL on the
      <a href="config.html">Cameras page</a>.</div>`;
  });

// Register the PWA service worker (no-op outside a secure context).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
