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
  const transcode = el("input", { type: "checkbox", checked: cam.transcode });

  // "Test" opens go2rtc's own player for this stream — only meaningful once the
  // camera has been saved (so the stream id exists in the engine).
  const test = el("button", { type: "button", class: "row-btn", title: "Open this stream in go2rtc" }, "Test ▶");
  test.disabled = !cam.id;
  test.addEventListener("click", () => {
    if (cam.id) window.open(`${ARGUS.go2rtcBase()}/stream.html?src=${encodeURIComponent(cam.id)}&mode=webrtc,mse`, "_blank");
  });

  const remove = el("button", { type: "button", class: "row-btn danger", title: "Remove" }, "✕");
  remove.addEventListener("click", () => { tr.remove(); updateAddLimit(); });

  const tr = el("tr", {}, [
    el("td", {}, name),
    el("td", {}, url),
    el("td", { class: "center" }, transcode),
    el("td", { class: "center row-actions" }, [test, remove]),
  ]);
  tr._get = () => ({
    id: cam.id, // preserved so the backend keeps a stable stream id
    name: name.value.trim(),
    url: url.value.trim(),
    transcode: transcode.checked,
  });
  rowsEl.append(tr);
  updateAddLimit();
  return tr;
}

// ── Plan limit: hard-lock the Add camera button at the subscription cap ──────
const ACCOUNT_URL = "https://argus-videowall.web.app/account.html";
let camLimit = Infinity; // refreshed from GET /api/license

function updateAddLimit() {
  const btn = document.getElementById("add-row");
  const noteEl = document.getElementById("limit-note");
  const atCap = Number.isFinite(camLimit) && rowsEl.children.length >= camLimit;
  btn.disabled = atCap;
  btn.title = atCap ? "Your plan's camera limit is reached" : "";
  noteEl.hidden = !atCap;
  if (atCap) {
    noteEl.innerHTML =
      `Plan limit reached (${camLimit} cameras) — ` +
      `<a href="${ACCOUNT_URL}" target="_blank" rel="noopener">increase your subscription</a> to add more.`;
  }
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
    if (res.status === 402 && data.error === "license_limit") {
      banner(
        "warn",
        `Your plan covers <b>${data.limit}</b> camera(s) and this list has <b>${data.requested}</b>. ` +
          `Extra cameras are <b>$5/camera/month</b> (5 for $20/mo, 10 for $30/mo) — subscribe at ` +
          `<a href="https://argus-videowall.web.app/#pricing" target="_blank" rel="noopener">argus-videowall.web.app</a>, ` +
          `then paste your license key below. Or remove ${data.requested - data.limit} camera(s) and save again.`
      );
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Re-render with backend-assigned ids so Test buttons light up.
    render(data.cameras);
    loadLicense(); // refresh the "using X of Y" line

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

// ── License ──────────────────────────────────────────────────────────────────
// 4 cameras are free; a subscription key raises the limit ($5/camera/month,
// volume-priced: 5 extra for $20, 10 extra for $30).
// Keys verify offline on the box — no cloud involved.
const licStatusEl = document.getElementById("license-status");
const licKeyEl = document.getElementById("license-key");
const licNoteEl = document.getElementById("license-note");

// Mirrors the account page: shows the plan and how much of it is used here.
function renderLicense(lic) {
  camLimit = lic.limit || lic.free || 4;
  updateAddLimit();
  const used = rowsEl.children.length;
  const usage = `You're using <b>${used}</b> of <b>${camLimit}</b> camera slot(s) on this box.`;
  const buy = `<a href="${ACCOUNT_URL}" target="_blank" rel="noopener">manage your subscription</a>`;
  const linked = lic.linked
    ? `<br>🔗 Linked to <b>${escapeHtml(lic.linkedEmail || "your account")}</b> — the license updates automatically. <a href="#" id="lic-unlink">Unlink</a>`
    : "";
  if (lic.licensed) {
    licStatusEl.innerHTML =
      `✅ Licensed to <b>${escapeHtml(lic.email || "you")}</b> — <b>${lic.cams}</b> cameras until <b>${escapeHtml(lic.until)}</b>. ${usage} ${buy}.${linked}`;
  } else if (lic.expired) {
    licStatusEl.innerHTML =
      `⚠ Your license expired on <b>${escapeHtml(lic.until)}</b> — back to the ${lic.free} free cameras. ${usage} ` +
      `Renew, then sign in below to re-sync (${buy}).${linked}`;
  } else {
    licStatusEl.innerHTML =
      `<b>${lic.free}</b> cameras are included free, forever. ${usage} Need more? ${buy}.${linked}` +
      (lic.error ? `<br>⚠ ${escapeHtml(lic.error)}` : "");
  }
  const unlink = document.getElementById("lic-unlink");
  if (unlink) unlink.addEventListener("click", async (e) => {
    e.preventDefault();
    const res = await fetch(`${ARGUS.backendBase()}/api/license/link`, { method: "DELETE" });
    if (res.ok) renderLicense(await res.json());
  });
}

async function loadLicense() {
  try {
    const res = await fetch(`${ARGUS.backendBase()}/api/license`, { cache: "no-store" });
    if (res.ok) renderLicense(await res.json());
  } catch { /* backend gone — the gate handles that */ }
}

// ── Sign in & link: the box follows the user's Argus account ─────────────────
// Email/password via the Firebase Auth REST API (works from any LAN origin —
// no authorized-domain requirement, unlike the popup flows). The box stores
// the refresh token and re-syncs the license from the account at boot and
// every 6 hours, so upgrades/downgrades propagate on their own. Only the
// license travels; no camera data leaves the box.
const FIREBASE_API_KEY = "AIzaSyDwnINHwoFL9of-FrOOPN2KKr0K0hO0J-s";

document.getElementById("lic-signin").addEventListener("click", async () => {
  const email = document.getElementById("lic-email").value.trim();
  const pass = document.getElementById("lic-pass").value;
  const noteEl = document.getElementById("lic-signin-note");
  if (!email || !pass) { noteEl.textContent = "Enter your email and password."; return; }
  noteEl.textContent = "Signing in…";
  try {
    const authRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass, returnSecureToken: true }) }
    );
    const authData = await authRes.json();
    if (!authRes.ok) {
      const code = (authData.error && authData.error.message) || "";
      throw new Error(/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(code)
        ? "Wrong email or password. (Google sign-ins: set a password via “Forgot password” on the account page.)"
        : `Sign-in failed: ${code || authRes.status}`);
    }
    noteEl.textContent = "Linking this box to your account…";
    const linkRes = await fetch(`${ARGUS.backendBase()}/api/license/link`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: authData.refreshToken, email }),
    });
    const status = await linkRes.json();
    if (!linkRes.ok) throw new Error(status.error || `HTTP ${linkRes.status}`);
    noteEl.textContent = "";
    document.getElementById("lic-pass").value = "";
    renderLicense(status);
    if (status.syncError) {
      banner("warn", `Linked, but the first sync had a problem: ${escapeHtml(status.syncError)}`);
    } else if (status.licensed) {
      banner("ok", `Linked & synced — this box is licensed for ${status.cams} cameras until ${escapeHtml(status.until)}. It now updates automatically.`);
    } else {
      banner("ok", `Linked. Your account is on the free tier (${status.free} cameras) — the box updates automatically when you subscribe.`);
    }
  } catch (err) {
    noteEl.textContent = err.message;
  }
});

document.getElementById("license-apply").addEventListener("click", async () => {
  const key = licKeyEl.value.trim();
  if (!key) { licNoteEl.textContent = "Paste a key first."; return; }
  licNoteEl.textContent = "Checking…";
  try {
    const res = await fetch(`${ARGUS.backendBase()}/api/license`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    licNoteEl.textContent = "";
    licKeyEl.value = "";
    renderLicense(data);
    banner("ok", `License activated — up to ${data.cams} cameras until ${escapeHtml(data.until)}.`);
  } catch (err) {
    licNoteEl.textContent = err.message;
  }
});

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
  document.getElementById("account-gate").hidden = true;
  openGate();
}

function showEditor(list) {
  connected = true;
  gateEl.hidden = true;
  document.getElementById("account-gate").hidden = true;
  editorEl.hidden = false;
  connEl.hidden = false;
  connEl.innerHTML = `<span class="dot live"></span> Connected to <code>${escapeHtml(ARGUS.backendBase())}</code> — use <strong>⚙ Backend</strong> to change.`;
  render(list);
  loadLicense();
}

// ── Account gate: box must be linked to an Argus account before editing ──────
const accountGateEl = document.getElementById("account-gate");

function showAccountGate() {
  connected = false;
  editorEl.hidden = true;
  gateEl.hidden = true;
  connEl.hidden = true;
  accountGateEl.hidden = false;
}

async function accountGateAuth() {
  const email = document.getElementById("agate-email").value.trim();
  const pass = document.getElementById("agate-pass").value;
  const noteEl = document.getElementById("agate-note");
  if (!email || !pass) { noteEl.textContent = "Enter your email and password."; return; }
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
    if (!linkRes.ok) throw new Error("Could not link the box.");
    location.reload();
  } catch (err) {
    noteEl.textContent = err.message;
  }
}
document.getElementById("agate-signin").addEventListener("click", accountGateAuth);
document.getElementById("agate-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") accountGateAuth(); });

async function connect() {
  // Served-from-a-box pages always talk to their own box: a stale per-device
  // override must not point the UI (and its sign-in gate) somewhere else.
  if (ARGUS.getBackendOverride()) {
    try {
      const ping = await fetch("/api/ping", { cache: "no-store" });
      if (ping.ok && (await ping.json()).app === "argus") ARGUS.setBackendOverride("");
    } catch { /* hosted copy — override stays */ }
  }
  try {
    const res = await fetch(`${ARGUS.backendBase()}/api/cameras`, { cache: "no-store" });
    if (res.status === 403) { showAccountGate(); return; }
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
