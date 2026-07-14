#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Issue an Argus license key. Run this when a PayPal subscription is created
// or renews, then email the printed key to the customer.
//
//   node tools/license-sign.js --email jane@example.com --extra 4
//   node tools/license-sign.js --email jane@example.com --cams 6 --months 1
//
//   --email   customer email (stamped into the key, shown in their UI)
//   --extra   PAID cameras, i.e. the PayPal subscription quantity
//             (total = 4 free + extra), or:
//   --cams    TOTAL cameras allowed (overrides --extra)
//   --months  validity in months from today (default 1) — issue 12 for annual
//   --until   explicit last valid day, YYYY-MM-DD (overrides --months)
//   --key     path to the private key
//             (default ~/Documents/Wiltech/argus-license-keys/argus-license-private.pem)
//
// A 5-day grace period is added on top of --months so a customer whose renewal
// lags by a few days never sees the wall degrade.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const FREE_CAMERAS = 4;
const GRACE_DAYS = 5;

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}

if (!args.email || (!args.extra && !args.cams)) {
  console.error("usage: node tools/license-sign.js --email <email> --extra <paid cameras> [--months 1] [--until YYYY-MM-DD] [--key <pem>]");
  process.exit(1);
}

const cams = args.cams ? parseInt(args.cams, 10) : FREE_CAMERAS + parseInt(args.extra, 10);
if (!Number.isInteger(cams) || cams <= FREE_CAMERAS) {
  console.error(`--extra/--cams must allow more than the ${FREE_CAMERAS} free cameras`);
  process.exit(1);
}

let until = args.until;
if (!until) {
  const d = new Date();
  d.setMonth(d.getMonth() + (args.months ? parseInt(args.months, 10) : 1));
  d.setDate(d.getDate() + GRACE_DAYS);
  until = d.toISOString().slice(0, 10);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
  console.error(`--until must be YYYY-MM-DD (got: ${until})`);
  process.exit(1);
}

const keyPath = args.key || path.join(os.homedir(), "Documents/Wiltech/argus-license-keys/argus-license-private.pem");
let privateKey;
try {
  privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
} catch (e) {
  console.error(`could not load private key at ${keyPath}: ${e.message}`);
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const payload = b64url(JSON.stringify({ v: 1, email: args.email, cams, until }));
const sig = b64url(crypto.sign(null, Buffer.from(payload, "utf8"), privateKey));
const key = `ARGUS.${payload}.${sig}`;

// Self-check against the shipped verifier so a bad keypair can't slip out.
const verified = require(path.join(__dirname, "..", "licensing.js")).verifyKey(key);

console.log(`\nLicense for ${verified.email}`);
console.log(`  cameras : ${verified.cams} total (${FREE_CAMERAS} free + ${verified.cams - FREE_CAMERAS} paid)`);
console.log(`  valid to: ${verified.until}\n`);
console.log(key + "\n");
