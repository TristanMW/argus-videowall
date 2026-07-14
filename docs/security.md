# Argus — security posture & production checklist

Last swept: 2026-07-14.

## Findings from the sweep (and status)

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **High** | **Realtime Database was world-readable/writable** (test-mode rules). App doesn't use RTDB, but anyone could read/write it — abuse hosting & billing risk. | **Fixed** — `database.rules.json` denies all; deployed; re-probe returns "Permission denied". |
| 2 | **High** | **Box API had `Access-Control-Allow-Origin: *`.** Any website a user visited could read `GET /api/cameras` (RTSP URLs embed camera passwords) or hit state-changing endpoints from the user's browser on the LAN. | **Fixed** — CORS off by default; only a specific `ALLOW_ORIGIN` env origin is honoured, never `*`. Cross-origin reads get no ACAO; PUT/DELETE preflights 403. |
| 3 | Info | Firestore rules | **Verified secure** — anonymous denied; non-admin can't list, can't self-grant `paidCams`, can't read others' docs. Admin gated on verified `tristan@alasia.co.za`. |
| 4 | Info | Firebase Storage | No public bucket/listing (404). |
| 5 | Info | Git history | Clean — no private keys, service-account JSON, or the PayPal secret ever committed. Repo is private (GitHub 404 anonymously). |
| 6 | Info | Firebase web API key in client code | **Not a leak.** Firebase web keys are public identifiers; security is enforced by Auth + rules (both verified above). |

## Residual risks (accepted / by design)

- **Box API has no per-request auth on the LAN.** Anyone on the local network can change cameras or unlink the box. This matches the "private-network appliance" model; the account gate is licensing, not access control. Mitigate by trusting the LAN / using Tailscale for remote.
- **DNS-rebinding.** A determined web attacker could rebind a domain to the box IP to bypass CORS. Low likelihood for a LAN appliance; a Host-header allowlist could be added if needed.
- **Client-side license enforcement is editable** (see below).

## Production checklist

- [x] RTDB locked, Firestore rules locked & verified, Storage closed.
- [x] Box CORS locked down.
- [ ] **Rotate the PayPal secret** (was shared in chat when creating the plan).
- [ ] Move the service-account JSON out of `~/Downloads` to a stable, backed-up location.
- [ ] Back up the license **signing private key** (`~/Documents/Wiltech/argus-license-keys/`). Losing it = re-key every customer.
- [ ] Do the $5 PayPal live self-test, then refund.
- [ ] Deploy hosting (`firebase deploy --only hosting`) when ready to go public.
- [ ] Have a lawyer glance at `LICENSE` + `EULA.md`.
- [ ] Consider Firebase App Check + Auth rate-limits if abuse appears.

## "Can people steal the code?" — the honest answer

Two different worries, two different answers:

**A. Someone downloads the whole product and reuses it.**
- The GitHub repo is **private** — that door is closed.
- The box ships readable source (`server.js`, `web/`, `licensing.js`) to every
  customer, so a customer *can* read it. The **source-available `LICENSE` +
  `EULA`** make redistribution/reuse a breach — that's your real protection here,
  and it's in place.

**B. Someone edits the box code to defeat the camera limit.**
- This is the unavoidable truth of all client-side software: **a person who
  controls the machine can modify any check on it.** `licensing.js` verifies keys
  offline against an embedded *public* key (the private key never ships, so keys
  can't be *forged*) — but nothing stops a technical user from editing
  `FREE_CAMERAS` or stubbing the check. No amount of local code prevents this.

**What actually helps, in order of value:**
1. **Legal** (done) — source-available license + EULA.
2. **Compile the backend to a single Go binary** — source no longer ships as
   plaintext; tampering now needs decompilation, not a text editor. This is the
   biggest practical lift to the bar and also gives you the single-file
   `argus.exe`/mac/linux installers. Cost: a code-signing cert (~$100–400/yr) to
   avoid SmartScreen/Gatekeeper, and a backend port. **Recommended before public
   launch.**
3. **Account heartbeat (optional).** Boxes already link to accounts and re-sync
   every 6h; you *could* require a valid link within N days to keep operating.
   Ties operation to your cloud without moving video off-box — but it's still
   locally editable and it penalises legitimate offline installs. Present as an
   option, not a default.

**On "not everything should be local":** your instinct is sound, but be precise
about *what* moves. Moving **video/config** to the cloud would break Argus's core
privacy promise — don't. The only thing worth considering server-side is the
**license decision**, which we already did the right way: entitlements live in
Firestore (server-authoritative, admin-controlled) and boxes follow them. The
box still needs a *local* enforcement point, and that point is always editable —
so the honest ceiling is "raise the bar (compile) + rely on the license," not
"make it uncrackable." Uncrackable client-side licensing does not exist.
