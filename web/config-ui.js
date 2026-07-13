// ─────────────────────────────────────────────────────────────────────────────
// Camera config page. The camera editor is gated behind a live backend
// connection — without the box there is nothing to edit and no camera can be
// created client-side. Reads/writes the camera list via the Argus backend
// (GET/PUT /api/cameras); saving applies changes to go2rtc live.
// ─────────────────────────────────────────────────────────────────────────────

const rowsEl = document.getElementById("cam-rows");
const bannerEl = document.getElementById("banner");

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "checked") node.checked = !!v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

function addRow(cam = {}) {
  const name = el("input", { type: "text", class: "in name", placeholder: "Front door", value: cam.name || "" });
  const url = el("input", { type: "text", class: "in url", placeholder: "rtsp://user:pass@192.168.1.108:554/…", value: cam.url || "" });

  // "Test" opens go2rtc's own player for this stream — only meaningful once the
  // camera has been saved (so the stream id exists in the engine).
  const test = el("button", { type: "button", class: "row-btn", title: "Open this stream in go2rtc" }, "Test ▶");
  test.disabled = !cam.id;
  test.addEventListener("click", () => {
    if (cam.id) window.open(`${ARGUS.go2rtcBase()}/stream.html?src=${encodeURIComponent(cam.id)}&mode=webrtc,mse`, "_blank");
  });

  const remove = el("button", { type: "button", class: "row-btn danger", title: "Remove" }, "✕");
  remove.addEventListener("click", () => tr.remove());

  const tr = el("tr", {}, [
    el("td", {}, name),
    el("td", {}, url),
    el("td", { class: "center row-actions" }, [test, remove]),
  ]);
  tr._get = () => ({
    id: cam.id, // preserved so the backend keeps a stable stream id
    name: name.value.trim(),
    url: url.value.trim(),
  });
  rowsEl.append(tr);
  return tr;
}

function collect() {
  return [...rowsEl.children].map((tr) => tr._get()).filter((c) => c.url);
}

function banner(kind, html) {
  bannerEl.className = `banner ${kind}`;
  bannerEl.innerHTML = html;
  bannerEl.hidden = false;
}

async function save() {
  const list = collect();
  banner("info", "Saving and applying…");
  try {
    const res = await fetch(`${ARGUS.backendBase()}/api/cameras`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Re-render with backend-assigned ids so Test buttons light up.
    render(data.cameras);

    if (data.warnings && data.warnings.length) {
      banner(
        "warn",
        `Saved, but the engine reported issues:<ul>${data.warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join("")}</ul>Check the RTSP URL/credentials. <a href="index.html">Open video wall</a>`
      );
    } else {
      banner("ok", `Saved &amp; applied ${data.cameras.length} camera(s). <a href="index.html">Open video wall ▶</a>`);
    }
  } catch (err) {
    banner("warn", `Could not save: ${escapeHtml(err.message)}`);
  }
}

function render(list) {
  rowsEl.innerHTML = "";
  (list && list.length ? list : [{}]).forEach(addRow);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

document.getElementById("add-row").addEventListener("click", () => addRow());
document.getElementById("save").addEventListener("click", save);

// ── Backend connection: manual entry + network detection ─────────────────────
const backendInput = document.getElementById("backend-url");
const backendNote = document.getElementById("backend-note");
const detectResults = document.getElementById("detect-results");
const HISTORY_KEY = "argus.backends";

const loadHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
};
const remember = (url) => {
  const h = [url, ...loadHistory().filter((u) => u !== url)].slice(0, 8);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
};

function useBackend(url) {
  const v = url.trim().replace(/\/+$/, "");
  if (v && !/^https?:\/\//.test(v)) {
    backendNote.textContent = "Must start with http:// or https://";
    return;
  }
  if (v) remember(v);
  ARGUS.setBackendOverride(v);
  backendNote.textContent = "Saved — reloading…";
  setTimeout(() => location.reload(), 500);
}

backendInput.value = ARGUS.getBackendOverride();
document.getElementById("save-backend").addEventListener("click", () => useBackend(backendInput.value));

// Ping one candidate; resolve to its info if it's an Argus box, else null.
async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`${url}/api/ping`, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const info = await res.json();
    return info && info.app === "argus" ? { url, info } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The set of addresses worth probing. A browser can't scan the whole subnet
// (blocked for privacy), so we check the likely local names + anything we've
// used before. All local; mixed-content rules may skip http targets on an
// https page — those simply don't respond.
function candidates() {
  const set = new Set([
    location.origin,
    "http://argus.local:8080",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    ...loadHistory(),
  ]);
  return [...set].map((u) => u.replace(/\/+$/, "")).filter(Boolean);
}

async function detect() {
  detectResults.innerHTML = "";
  backendNote.textContent = "Scanning…";
  const found = (await Promise.all(candidates().map(probe))).filter(Boolean);
  backendNote.textContent = "";

  if (!found.length) {
    detectResults.innerHTML =
      '<div class="detect-empty">No Argus box answered. Make sure Docker is running, then enter its address above.</div>';
    return;
  }
  // Auto-select if there's exactly one, otherwise let the user choose.
  if (found.length === 1) return useBackend(found[0].url);

  found.forEach((f) => {
    const row = document.createElement("div");
    row.className = "detect-hit";
    row.innerHTML = `<span><span class="dot live"></span><code>${escapeHtml(f.url)}</code>
      <small>${f.info.cameras} camera(s)</small></span>`;
    const use = document.createElement("button");
    use.className = "row-btn";
    use.textContent = "Use";
    use.addEventListener("click", () => useBackend(f.url));
    row.append(use);
    detectResults.append(row);
  });
}

document.getElementById("detect").addEventListener("click", detect);

// ── Connection gate ──────────────────────────────────────────────────────────
// The camera editor is only shown when a backend is actually reachable. Without
// the box there is nothing to edit — cameras cannot be created client-side.
const gateEl = document.getElementById("gate");
const editorEl = document.getElementById("editor");
const connEl = document.getElementById("conn-status");
const gateTitle = document.getElementById("gate-title");
const gateClose = document.getElementById("gate-close");
const toggleBackendBtn = document.getElementById("toggle-backend");
let connected = false;

// Open the backend panel. When already connected it's a "change" action (with a
// Close button to return); when not, it's the first-connect gate.
function openGate() {
  backendInput.value = ARGUS.getBackendOverride() || ARGUS.backendBase();
  gateTitle.textContent = connected ? "Backend connection" : "Connect to your Argus box";
  gateClose.hidden = !connected;
  gateEl.hidden = false;
}
function closeGate() { if (connected) gateEl.hidden = true; }

toggleBackendBtn.addEventListener("click", () => (gateEl.hidden ? openGate() : closeGate()));
gateClose.addEventListener("click", closeGate);

function showGate() {
  connected = false;
  editorEl.hidden = true;
  connEl.hidden = true;
  openGate();
}

function showEditor(list) {
  connected = true;
  gateEl.hidden = true;
  editorEl.hidden = false;
  connEl.hidden = false;
  connEl.innerHTML = `<span class="dot live"></span> Connected to <code>${escapeHtml(ARGUS.backendBase())}</code> — use <strong>⚙ Backend</strong> to change.`;
  render(list);
}

async function connect() {
  try {
    const res = await fetch(`${ARGUS.backendBase()}/api/cameras`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    showEditor(Array.isArray(list) ? list : []);
  } catch {
    showGate();
    detect(); // help the user find the box straight away
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
connect();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
