// ─────────────────────────────────────────────────────────────────────────────
// Argus licensing — offline-verified subscription keys.
//
// Model: the first FREE_CAMERAS cameras are free forever. A license key raises
// the limit; keys are issued per subscription ($5/camera/month, volume-priced
// down to $3 — see docs/monetisation.md) by
// tools/license-sign.js and verified here against the embedded Ed25519 public
// key. Verification is fully offline — nothing about the customer's cameras
// ever leaves their box, and an air-gapped LAN works fine.
//
// Key format:  ARGUS.<base64url payload>.<base64url signature>
//   payload = { v: 1, email, cams, until: "YYYY-MM-DD" }
//     cams  = TOTAL cameras allowed (free ones included)
//     until = last valid day (subscription period end + grace)
//
// When a key expires the limit reverts to the free tier: cameras beyond the
// limit stay in the saved list but are not registered with the engine, and
// saving more than the limit is rejected with `license_limit`.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const FREE_CAMERAS = 4;

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEATASYeggGtsah/VphgJk6BCpcv7efyZA5oAieQlqkF70=
-----END PUBLIC KEY-----`;

const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// Parse + cryptographically verify a key string. Returns the payload or throws
// with a human-readable reason (shown verbatim in the config UI).
function verifyKey(keyString) {
  const parts = String(keyString || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== "ARGUS") throw new Error("not an Argus license key");
  const [, payloadB64, sigB64] = parts;
  const ok = crypto.verify(
    null,
    Buffer.from(payloadB64, "utf8"),
    crypto.createPublicKey(PUBLIC_KEY_PEM),
    b64urlDecode(sigB64)
  );
  if (!ok) throw new Error("invalid signature — the key was mistyped or tampered with");
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")); } catch { payload = null; }
  if (!payload || payload.v !== 1 || !Number.isInteger(payload.cams) || !payload.until) {
    throw new Error("malformed license payload");
  }
  return payload;
}

// `until` is inclusive: the key works through the end of that day (UTC).
const isExpired = (payload) => new Date(`${payload.until}T23:59:59Z`).getTime() < Date.now();

function licenseFile(dataFile) {
  return process.env.LICENSE_FILE || path.join(path.dirname(dataFile), "license.key");
}

function readKey(dataFile) {
  try { return fs.readFileSync(licenseFile(dataFile), "utf8").trim(); } catch { return ""; }
}

// Current entitlement. Never throws — a broken/expired key degrades to free.
function getStatus(dataFile) {
  const base = { free: FREE_CAMERAS, limit: FREE_CAMERAS, licensed: false };
  const key = readKey(dataFile);
  if (!key) return base;
  let payload;
  try { payload = verifyKey(key); } catch (e) {
    return { ...base, error: `stored key is invalid: ${e.message}` };
  }
  const expired = isExpired(payload);
  return {
    ...base,
    licensed: !expired,
    expired,
    email: payload.email || "",
    cams: payload.cams,
    until: payload.until,
    limit: expired ? FREE_CAMERAS : Math.max(FREE_CAMERAS, payload.cams),
  };
}

// Validate + persist a new key. Throws with a readable message on any problem.
async function setKey(dataFile, keyString) {
  const payload = verifyKey(keyString);
  if (isExpired(payload)) throw new Error(`this key expired on ${payload.until} — renew the subscription to get a fresh one`);
  await fsp.mkdir(path.dirname(licenseFile(dataFile)), { recursive: true });
  await fsp.writeFile(licenseFile(dataFile), String(keyString).trim() + "\n");
  return getStatus(dataFile);
}

async function clearKey(dataFile) {
  await fsp.rm(licenseFile(dataFile), { force: true });
  return getStatus(dataFile);
}

module.exports = { FREE_CAMERAS, verifyKey, getStatus, setKey, clearKey };
