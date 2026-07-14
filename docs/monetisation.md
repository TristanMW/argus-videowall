# Argus monetisation — runbook

**Model:** 4 cameras free forever · **$5 per additional camera per month**,
volume-priced: 1–4 extras $5 each · 5–9 extras $4 each ($20 for 5) · 10+
extras $3 each ($30 for 10) · PayPal subscription (Volume pricing plan). Accounts + entitlements live in Firebase (Auth +
Firestore); license keys are Ed25519-signed on the admin's Mac and verified
**offline** on each customer's box — video and camera config never touch the
cloud.

## Architecture

```mermaid
flowchart LR
  subgraph Portal [argus-videowall.web.app — Firebase]
    L[landing index.html]
    ACC[account.html<br/>Auth: Google + email]
    ADM[admin.html<br/>tristan@alasia.co.za only]
    FS[(Firestore<br/>licenses/uid)]
  end
  subgraph Admin [Your Mac]
    SYNC[tools/license-sync.js<br/>service account + private signing key]
  end
  subgraph Box [Customer's Argus box]
    SRV[server.js + licensing.js<br/>offline Ed25519 verify]
  end
  U[Customer] -->|sign in, request cameras| ACC
  ACC <-->|own doc only| FS
  ADM <-->|all docs: paid/bonus/active| FS
  SYNC <-->|reads entitlements, writes keys| FS
  U -->|pastes key| SRV
  P[PayPal] -.->|subscription notice| ADM
```

## The flow, end to end

1. Customer signs in at **/account.html** (Google or email/password), enters
   how many extra cameras they want, subscribes via PayPal (button pending —
   see below), and saves the request (`requestedCams`, `subscriptionId`).
2. You get PayPal's notification email; open **/admin.html**, find the row,
   set `paid` = the verified quantity, tick **active**, Save.
   **Manual free tier:** set `bonus` cameras for anyone you want to comp —
   no payment involved.
3. Run `node tools/license-sync.js` (or let cron/launchd run it weekly).
   It signs a key for every entitled account and writes it to their doc.
   Paid keys roll 40 days ahead and auto-renew while `active`; bonus-only
   keys last 10 years. Cancellations: untick **active** — the key ages out
   within ~40 days.
4. The key appears on the customer's account page; they paste it into
   **Add cameras → License → Activate** on their box. Done.

## Firestore doc (licenses/{uid})

| Field | Writer | Meaning |
|---|---|---|
| `email`, `requestedCams`, `subscriptionId`, `updatedAt` | customer | their request |
| `paidCams`, `bonusCams`, `active`, `until` (optional override) | admin page | entitlement |
| `key`, `keyCams`, `keyUntil`, `keyIssuedAt` | license-sync | the issued key |

Security rules (`firestore.rules`, deployed — replaced test mode): users
read/write only their own request fields; entitlements and keys are
admin/service-account only; admin = verified `tristan@alasia.co.za`.

## Secrets (never in the repo)

- **Signing key:** `~/Documents/Wiltech/argus-license-keys/argus-license-private.pem`
  — BACK THIS UP; losing it means re-keying every customer.
- **Service account:** the `argus-videowall-firebase-adminsdk-…json` file
  (Downloads by default; move somewhere stable and pass `--key-file` or set
  `GOOGLE_APPLICATION_CREDENTIALS`).

## Manual key issuing (no Firestore needed)

`node tools/license-sign.js --email x@y.com --extra 4 [--months 3]` still
works for one-off/offline customers.

## PayPal (still to do — needs your account)

Create a **Volume pricing** plan (dashboard wizard: Pay & Get Paid →
Subscriptions → Create plan → *Volume pricing*), monthly cycle, ranges:

| Extra cameras | Price per camera | Examples |
|---|---|---|
| 1–4 | $5.00 | 1 = $5 · 4 = $20 |
| 5–9 | $4.00 | 5 = **$20** |
| 10–999 | $3.00 | 10 = **$30** |

(Note the intended quirk: 9 extras = $36 > 10 extras = $30 — the account page
should nudge users to round up.)

Or via API — same plan, `pricing_model: VOLUME`:

```bash
TOKEN=$(curl -s -u "CLIENT_ID:SECRET" https://api-m.paypal.com/v1/oauth2/token \
  -d grant_type=client_credentials | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
PRODUCT=$(curl -s -X POST https://api-m.paypal.com/v1/catalogs/products \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Argus additional camera","type":"SERVICE"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -X POST https://api-m.paypal.com/v1/billing/plans \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
    "product_id":"'$PRODUCT'","name":"Argus extra cameras (volume, monthly)",
    "billing_cycles":[{"frequency":{"interval_unit":"MONTH","interval_count":1},
      "tenure_type":"REGULAR","sequence":1,"total_cycles":0,
      "pricing_scheme":{"pricing_model":"VOLUME","tiers":[
        {"starting_quantity":"1","ending_quantity":"4","price":{"value":"5","currency_code":"USD"}},
        {"starting_quantity":"5","ending_quantity":"9","price":{"value":"4","currency_code":"USD"}},
        {"starting_quantity":"10","price":{"value":"3","currency_code":"USD"}}]}}],
    "payment_preferences":{"auto_bill_outstanding":true},
    "quantity_supported":true}'
```

```html
<script src="https://www.paypal.com/sdk/js?client-id=CLIENT_ID&vault=true&intent=subscription"></script>
<script>
  paypal.Buttons({
    createSubscription: (d, a) => a.subscription.create({ plan_id: "P-XXXX", quantity: String(qty) }),
    onApprove: (data) => saveRequest(qty, data.subscriptionID),  // account.html wires this
  }).render("#paypal-btn");
</script>
```

## Roadmap

- **Webhook automation:** PayPal `BILLING.SUBSCRIPTION.ACTIVATED/CANCELLED` →
  Cloud Function/Worker sets `paidCams`/`active` automatically; license-sync
  on a schedule does the rest. Zero-touch subscriptions.
- **Single-file installs:** port the backend to Go (embed `web/` via
  `embed.FS`, auto-download go2rtc) → one `argus.exe` / `argus-macos` /
  `argus-linux` binary, no Node prerequisite. Side effect: source no longer
  ships to customers. Needs a code-signing cert for Windows/macOS to avoid
  SmartScreen/Gatekeeper friction.
- Licensing is now **source-available** (see LICENSE, EULA.md) — have a
  lawyer review before public launch.
