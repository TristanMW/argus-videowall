#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Issue Argus license keys for every entitled account in Firestore.
//
//   node tools/license-sync.js [--dry-run]
//
// Reads licenses/* docs (admin edits entitlements at /admin.html), signs a key
// for each account that deserves one, and writes it back to the doc where the
// account page displays it. Zero npm dependencies: talks to Firestore REST
// with a service-account JWT.
//
// Entitlement rules (doc fields set by the admin page):
//   entitled = 4 free + paidCams + bonusCams
//   • paidCams count only while active == true (you verified the PayPal sub)
//   • bonusCams always count (your manual free-tier grants)
// Key expiry:
//   • explicit doc.until wins, else
//   • any paid cameras → rolling 40 days (re-run this tool to renew;
//     run it weekly via cron/launchd and renewals are hands-off), else
//   • bonus-only → 10 years.
// Re-issues when the key is missing, covers the wrong camera count, or is
// within 20 days of expiry. Keys already in the field can't be revoked
// (verification is offline) — they simply age out.
//
// Credentials: --key-file <path>, or GOOGLE_APPLICATION_CREDENTIALS, or the
// default Downloads path of the argus-videowall admin SDK key.
// Signing key: ~/Documents/Wiltech/argus-license-keys/argus-license-private.pem
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT = "argus-videowall";
const FREE_CAMERAS = 4;
const ROLLING_DAYS = 40;   // paid keys: issued this far ahead
const RENEW_WITHIN = 20;   // re-issue when fewer than this many days remain
const BONUS_DAYS = 3650;   // bonus-only grants: effectively permanent

const DRY = process.argv.includes("--dry-run");
const argKey = process.argv.indexOf("--key-file");
const SA_PATH =
  (argKey > -1 && process.argv[argKey + 1]) ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(os.homedir(), "Downloads/argus-videowall-firebase-adminsdk-fbsvc-c93ddb6419.json");
const SIGN_KEY_PATH = path.join(os.homedir(), "Documents/Wiltech/argus-license-keys/argus-license-private.pem");

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── Google OAuth via service-account JWT (no SDK needed) ─────────────────────
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const sig = b64url(crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), sa.private_key));
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${header}.${claims}.${sig}`,
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// ── Firestore REST helpers ───────────────────────────────────────────────────
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const fsVal = (v) =>
  typeof v === "number" ? { integerValue: String(v) } :
  typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) };
const jsVal = (f) =>
  f == null ? undefined :
  "integerValue" in f ? parseInt(f.integerValue, 10) :
  "booleanValue" in f ? f.booleanValue :
  "stringValue" in f ? f.stringValue : undefined;

async function listLicenses(token) {
  const docs = [];
  let pageToken = "";
  do {
    const res = await fetch(`${BASE}/licenses?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list failed: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    for (const d of body.documents || []) {
      const fields = {};
      for (const [k, v] of Object.entries(d.fields || {})) fields[k] = jsVal(v);
      docs.push({ id: d.name.split("/").pop(), ...fields });
    }
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return docs;
}

// Fields in `obj` are written; fields in `deletes` are removed from the doc
// (listed in the update mask but omitted from the body).
async function patchDoc(token, id, obj, deletes = []) {
  const mask = [...Object.keys(obj), ...deletes].map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const fields = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsVal(v)]));
  const res = await fetch(`${BASE}/licenses/${id}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`patch ${id} failed: HTTP ${res.status} ${await res.text()}`);
}

// ── Key signing (same format as tools/license-sign.js) ───────────────────────
function signKey(privateKey, email, cams, until) {
  const payload = b64url(JSON.stringify({ v: 1, email, cams, until }));
  const sig = b64url(crypto.sign(null, Buffer.from(payload, "utf8"), privateKey));
  const key = `ARGUS.${payload}.${sig}`;
  require(path.join(__dirname, "..", "licensing.js")).verifyKey(key); // self-check
  return key;
}

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sa = JSON.parse(fs.readFileSync(SA_PATH, "utf8"));
  const privateKey = crypto.createPrivateKey(fs.readFileSync(SIGN_KEY_PATH, "utf8"));
  const token = await accessToken(sa);
  const docs = await listLicenses(token);
  console.log(`[sync] ${docs.length} account(s)${DRY ? " (dry run)" : ""}`);

  let issued = 0;
  for (const d of docs) {
    const paid = (d.active ? d.paidCams : 0) || 0;
    const bonus = d.bonusCams || 0;
    const entitled = FREE_CAMERAS + paid + bonus;
    const email = d.email || d.id;

    if (entitled <= FREE_CAMERAS) {
      const why = (d.paidCams || 0) > 0 && !d.active ? "paid but not marked active" : "free tier";
      if (d.key) {
        // Downgraded to the free tier: remove the stale key from the doc so the
        // account page and box sign-in stop serving it. NOTE: a copy already
        // activated on a box keeps verifying offline until its keyUntil date —
        // offline keys can't be revoked remotely, they age out.
        console.log(`  ✖ ${email}: ${why} now — clearing issued key (was ${d.keyCams} cams to ${d.keyUntil})`);
        if (!DRY) await patchDoc(token, d.id, {}, ["key", "keyCams", "keyUntil", "keyIssuedAt"]);
        issued++;
      } else {
        console.log(`  – ${email}: no key needed (${why})`);
      }
      continue;
    }

    const until = d.until || plusDays(paid > 0 ? ROLLING_DAYS : BONUS_DAYS);
    const expSoon = d.keyUntil && (new Date(d.keyUntil) - Date.now()) / 86400000 < RENEW_WITHIN;
    const needs = !d.key || d.keyCams !== entitled || expSoon || (d.until && d.keyUntil !== d.until);
    if (!needs) {
      console.log(`  – ${email}: key ok (${d.keyCams} cams to ${d.keyUntil})`);
      continue;
    }

    console.log(`  ✚ ${email}: issuing ${entitled} cams (${paid} paid + ${bonus} bonus) until ${until}`);
    if (!DRY) {
      await patchDoc(token, d.id, {
        key: signKey(privateKey, email, entitled, until),
        keyCams: entitled,
        keyUntil: until,
        keyIssuedAt: new Date().toISOString(),
      });
    }
    issued++;
  }
  console.log(`[sync] done — ${issued} key(s) ${DRY ? "would be " : ""}issued/renewed`);
}

main().catch((e) => { console.error(`[sync] FAILED: ${e.message}`); process.exit(1); });
