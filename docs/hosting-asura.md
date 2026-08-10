# Hosting Provisioning (Asura via cPanel WHM)

## Important: there is no standalone "Asura Hosting API"

Asura Hosting does not publish a provisioning API. Asura is a **cPanel/DirectAdmin
reseller-style host**. The documented way to automate provisioning on Asura is to buy a
**cPanel reseller** plan (which gives you **WHM** access) and drive the **standard cPanel WHM
API**. EazWorld already speaks the WHM API (`services/whm.js`), so "integrating Asura" means
pointing the existing WHM integration at your Asura reseller server — not building a new API client.

- Asura client portal is a WHMCS install; there is no `api.asurahosting.com`.
- "Asura product IDs" are **WHM package names**, not API objects.

## How provisioning works in EazWorld

```
Customer picks a plan → enters/among domain → logs in → pays (Paystack)
  → Paystack webhook (signature + amount verified, idempotent)
  → order marked paid → provisionHostingAccount()
  → WHM createacct on your Asura reseller server (package = <prefix>_eazworld_<planType>_<tier>)
  → AutoSSL triggered → credentials emailed → order status "active"
  → customer manages it from /dashboard/hosting
```

Only `shared` and `wordpress` plan types auto-provision; `vps`/`cloud`/`email` are marked
`skipped` for manual handling (see `utils/provisionHosting.js`).

## Environment variables (`backend-eaz/.env`)

| Var | Required | Description |
|-----|----------|-------------|
| `WHM_HOST` | yes | Your Asura reseller WHM URL, e.g. `https://server:2087` |
| `WHM_USER` | yes | Your **reseller username** (NOT `root` on a reseller account) |
| `WHM_TOKEN` | yes | WHM API token (WHM → "API Tokens") |
| `WHM_PACKAGE_PREFIX` | no | Package-name prefix; defaults to `WHM_USER` |
| `HOSTING_NAMESERVERS` | recommended | Comma-separated nameservers customers point domains at |
| `HOSTING_GRACE_DAYS` | no | Days after expiry before suspension (default 7) |
| `HOSTING_SUSPEND_TO_TERMINATE_DAYS` | no | Days suspended before termination (default 30) |
| `CPANEL_URL` | no | Canonical cPanel URL for credential emails |
| `PAYSTACK_SECRET` | yes | Payments + webhook signature verification |
| `CLOUDINARY_*`, `RESEND_API_KEY` | yes | Uploads / transactional email |

**Never** put WHM credentials in frontend/`NEXT_PUBLIC_*`/browser/logs. They are server-only.

## Getting Asura API credentials

1. Buy an Asura **cPanel Reseller** plan → you receive WHM login details.
2. Log into WHM → **Development → Manage API Tokens** → create a token with account-management
   privileges → set `WHM_HOST`, `WHM_USER` (your reseller username), `WHM_TOKEN`.

## Configuring hosting products and WHM packages

Plans live in `config/hostingPlans.js` (name, tier, price, features). For each auto-provisioned
plan, create a matching **WHM package** on your Asura server named:

```
<WHM_PACKAGE_PREFIX or WHM_USER>_eazworld_<planType>_<tier>
```

e.g. reseller `eazwrld` + `shared/deluxe` → package `eazwrld_eazworld_shared_deluxe`.
Verify names with `whm.listPackages()`. Pricing is set in `config/hostingPlans.js`.

## Provisioning lifecycle (statuses)

`HostingOrder.status`: `pending → paid → active → suspended → terminated` (plus `cancelled`, `failed`).
`provisioningStatus`: `not_started → pending → provisioned | failed | skipped`.

Expiry lifecycle (`utils/renewalJob.js`, daily): active + expired past `HOSTING_GRACE_DAYS`
→ **suspend**; suspended past `HOSTING_SUSPEND_TO_TERMINATE_DAYS` → **terminate**. Renewal payment
re-activates and unsuspends automatically via the webhook.

## API endpoints (`/api/v1/hosting`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/plans` | public | Plan catalog |
| POST | `/orders` | customer | Create pending order + Paystack init |
| GET | `/orders` | customer | List own orders (admin: all) |
| GET | `/orders/:id` | owner/admin | Order detail |
| GET | `/orders/:id/status` | owner/admin | Live WHM account status |
| GET | `/orders/:id/cpanel-login` | owner/admin | cPanel SSO URL (no password) |
| POST | `/orders/:id/password` | owner/admin | Reset cPanel password (returned once) |
| POST | `/orders/:id/renew` | owner | Renewal payment |
| POST | `/orders/:id/suspend` | admin | Suspend account |
| POST | `/orders/:id/unsuspend` | admin | Unsuspend account |
| POST | `/orders/:id/terminate` | admin | Terminate (requires `{ confirm: true }`) |
| PATCH | `/orders/:id` | admin | Set status / re-run provisioning (idempotent) |
| POST | `/api/v1/domain/webhook`* | Paystack | Payment webhook (signature + amount verified) |

\* Webhook is mounted with a raw-body parser for signature verification.

## WHM API functions used (all standard cPanel WHM API v1)

`createacct`, `start_autossl_check_for_one_user`, `create_user_session` (SSO), `suspendacct`,
`unsuspendacct`, `removeacct`, `passwd`, `accountsummary`, `listpkgs`.

## Idempotency & security

- Webhook: HMAC-SHA512 signature verified against the raw body; fulfilment is idempotent on the
  Paystack reference (atomic `pending→paid`); charged amount reconciled per order.
- Provisioning: guarded by `provisioningStatus` + `cpanelUsername` + a recent-attempt window — a
  duplicate webhook, retry, or double-click will not create a second cPanel account.
- Authorization: customer endpoints enforce owner-or-admin (no IDOR); lifecycle endpoints are admin-only.
- Credentials: cPanel passwords are never logged; SSO is preferred over showing passwords; password
  reset returns the new password once to the authorized caller only.

## Testing

`cd backend-eaz && npm test`. WHM/Namecheap/email are mocked (`tests/hosting.test.js`); no real
Asura/WHM calls. Covers provisioning success/failure/skip/idempotency, admin authorization,
non-owner blocking, and terminate confirmation.

## DNS / domains

- `domainMode: 'new'` → domain registered via Namecheap with EazWorld nameservers set automatically.
- `domainMode: 'own' | 'skip'` → show the customer `HOSTING_NAMESERVERS` and instruct them to point
  their domain there. EazWorld does not modify external DNS it doesn't manage.

## Troubleshooting

- **"package does not exist"** on provisioning → `WHM_PACKAGE_PREFIX`/`WHM_USER` doesn't match your
  reseller username, or the WHM package isn't created. Check `whm.listPackages()`.
- **Provisioning stuck `pending`** → re-run via `PATCH /orders/:id { "status": "paid" }` (idempotent).
- **`provisioningStatus: failed`** → see `provisioningError` on the order (admin dashboard).

## Limitations (Asura / WHM)

- No native "products API" — plans are configured in EazWorld and mapped to WHM package names.
- Suspend/unsuspend/terminate/password all rely on your reseller WHM privileges being enabled.
- DirectAdmin reseller accounts would need a separate `services/directadmin` layer (not implemented).
