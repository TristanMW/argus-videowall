// ─────────────────────────────────────────────────────────────────────────────
// Runtime settings. Argus is served from the local box (Docker), so normally the
// frontend and backend share an origin and this needs no configuration. If the
// UI is opened on a device that didn't load it from the box, a backend address
// can be set (via the config page's Detect / manual entry) and is stored here.
// Everything stays on the local network — no external hosting is used.
//
// go2rtc's browser-facing URL is derived from the backend's host:
//   • https backend  → https://<host>:8443   (Tailscale serve for go2rtc)
//   • http  backend  → http://<host>:1984    (plain local/dev)
// Override the ports here if your deployment differs.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  const KEY = "argus.backend";
  const GO2RTC_HTTPS_PORT = 8443;
  const GO2RTC_HTTP_PORT = 1984;

  const store = {
    get() {
      try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
    },
    set(v) {
      try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {}
    },
  };

  // Where /api lives. Defaults to this page's origin (served-from-box case).
  function backendBase() {
    return (store.get() || location.origin).replace(/\/+$/, "");
  }

  // Where the browser reaches go2rtc's player pages / streams.
  function go2rtcBase() {
    const u = new URL(backendBase());
    return u.protocol === "https:"
      ? `https://${u.hostname}:${GO2RTC_HTTPS_PORT}`
      : `http://${u.hostname}:${GO2RTC_HTTP_PORT}`;
  }

  window.ARGUS = {
    backendBase,
    go2rtcBase,
    getBackendOverride: store.get,
    setBackendOverride: store.set,
  };
})();
