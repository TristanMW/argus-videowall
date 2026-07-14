# Argus monetisation — runbook

**Model:** 2 cameras free forever · **$2 per additional camera per month**,
paid by PayPal subscription. Enforced by offline-verified license keys — no
cloud dependency, keeps the "your video never leaves your box" promise.

## How it works

```mermaid
sequenceDiagram
  participant C as Customer
  participant P as PayPal
  participant T as You (Wiltech)
  participant A as Customer's Argus box
  C->>P: Subscribe ($2 × N cameras / month)
  P-->>T: Subscription notification (email / webhook)
  T->>T: node tools/license-sign.js --email c@x.com --extra N
  T-->>C: Email the ARGUS.… key
  C->>A: Paste key in config page → Activate
  A->>A: Verify Ed25519 signature offline; limit = 2 + N
```

- `licensing.js` — verification module (embedded public key). 2 free cameras
  (`FREE_CAMERAS`); a valid, unexpired key raises the limit to its `cams`.
- Enforcement: `PUT /api/cameras` returns **402 `license_limit`** when the list
  exceeds the limit; on boot, only the first `limit` saved cameras are
  registered with the engine (nothing is deleted).
- `GET/PUT/DELETE /api/license` — status / activate / remove. Config page has
  the UI (status line + paste-key field).
- `tools/license-sign.js` — signs keys with the **private key**, which lives
  ONLY at `~/Documents/Wiltech/argus-license-keys/argus-license-private.pem`
  (never in the repo; back it up — losing it means reissuing every customer
  from a new keypair).

## Issuing keys

```bash
# 4 paid cameras (customer wall of 6), valid 1 month + 5 days grace:
node tools/license-sign.js --email jane@example.com --extra 4

# quarterly key (fewer re-issues):
node tools/license-sign.js --email jane@example.com --extra 4 --months 3
```

Email the printed `ARGUS.…` line to the customer; they paste it in
**Add cameras → License → Activate**. Expiry behaviour: saving new cameras
over the limit is blocked and, after reboot, cameras beyond the limit stop
streaming — the list itself is never deleted, so renewing restores everything.

**Key-length policy (pick one):**
- `--months 1` — tight enforcement, but you re-issue every month per customer.
- `--months 3`/`12` — less toil; a cancelled subscriber keeps access until the
  key runs out (acceptable churn at $2/camera).
- Long-term fix: webhook automation (below) makes monthly keys effortless.

## PayPal setup (one-time)

1. PayPal **Business** account.
2. Create the product + plan (quantity-enabled so one plan covers any camera
   count). In the [developer dashboard](https://developer.paypal.com) get a
   client ID + secret, then:
   ```bash
   TOKEN=$(curl -s -u "CLIENT_ID:SECRET" https://api-m.paypal.com/v1/oauth2/token \
     -d grant_type=client_credentials | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
   PRODUCT=$(curl -s -X POST https://api-m.paypal.com/v1/catalogs/products \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"Argus additional camera","type":"SERVICE"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
   curl -s -X POST https://api-m.paypal.com/v1/billing/plans \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
       "product_id":"'$PRODUCT'","name":"Argus camera ($2/mo each)",
       "billing_cycles":[{"frequency":{"interval_unit":"MONTH","interval_count":1},
         "tenure_type":"REGULAR","sequence":1,"total_cycles":0,
         "pricing_scheme":{"fixed_price":{"value":"2","currency_code":"USD"}}}],
       "payment_preferences":{"auto_bill_outstanding":true},
       "quantity_supported":true}'
   ```
   Note the returned plan id (`P-…`).
3. On the landing page pricing card, replace the mailto button with the PayPal
   JS SDK subscribe button (quantity = number of *paid* cameras):
   ```html
   <script src="https://www.paypal.com/sdk/js?client-id=CLIENT_ID&vault=true&intent=subscription"></script>
   <div id="paypal-btn"></div>
   <script>
     paypal.Buttons({
       createSubscription: (d, actions) =>
         actions.subscription.create({ plan_id: "P-XXXX", quantity: String(qty) }),
       onApprove: (data) => location.href = "thanks.html?sub=" + data.subscriptionID,
     }).render("#paypal-btn");
   </script>
   ```
4. Subscription notifications arrive by email (or configure a webhook for
   `BILLING.SUBSCRIPTION.ACTIVATED` / `.CANCELLED`). On each: issue/renew the
   key with `license-sign.js` and email it.

## Roadmap to full automation (when volume justifies it)

A tiny cloud function (Cloudflare Worker free tier, or Firebase Functions on
Blaze) that: receives PayPal webhooks → verifies them → signs a key with the
private key (stored as a secret) → emails it. Later, Argus itself could
optionally poll a `renew?sub=I-XXXX` endpoint to fetch fresh keys
automatically — opt-in, so the offline promise holds for those who care.

## ⚠ Licensing decision still open

The repo ships with an **MIT** `LICENSE`, which explicitly permits removing
the camera limit and redistributing. Before public launch, switch new releases
to a source-available license (e.g. FSL, BUSL, or a custom "free for personal
use / 2 cameras" grant) and update the landing page + README accordingly.
