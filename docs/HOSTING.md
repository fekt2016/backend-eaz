# Domain & hosting — Namecheap

**Scope.** This document covers **EazWorld's own domain and where its site and API run**,
*and* the reseller server that customer hosting accounts are provisioned onto. Both moved
to Namecheap on 2026-08-31.

---

## Why a reseller plan, not shared hosting

EazWorld does two different things with hosting, and only one of them fits a shared plan:

1. Run `eazworld.co` — the Next.js site and the Express API.
2. **Sell** hosting to customers, provisioning a cPanel account per order.

(2) needs **WHM** — `services/whm.js` calls `createacct`, `create_user_session` and
`listpkgs` on port 2087, authenticating as a reseller. Shared hosting gives one cPanel
account and no WHM at all, so on a shared plan every paid order falls through to the
manual queue (`utils/provisionHosting.js:37`) forever.

A **cPanel reseller plan** gives WHM plus the ability to host our own site in one of its
accounts, which is why it is the plan of record. `services/whm.js` is already written for
exactly this: on a reseller account `WHM_USER` is your reseller username, **not** `root`,
and packages are prefixed with it.

> If the account is ever moved to a **VPS with root** instead, the deployment section
> below stops applying — a VPS would go back to Nginx + PM2, and those configs would need
> restoring from git history (they were deleted on this branch).

---

## The domain — eazworld.co

| Setting | Value |
|---|---|
| Registrar | Namecheap |
| Managed at | Namecheap → Domain List → `eazworld.co` |
| Auto-renew | **must be ON** — the site and every customer email address depend on it |
| WHOIS privacy | on (free forever with Namecheap) |
| Transfer lock | on, except during a deliberate transfer |

Renewal is billed separately from hosting.

---

## DNS

Namecheap publishes the nameservers for its own hosting, so unlike a per-account pair
these are fixed:

```
NS1 = dns1.registrar-servers.com
NS2 = dns2.registrar-servers.com
```

Set them under Domain List → `eazworld.co` → Nameservers → **Custom DNS**. Propagation
takes up to 48 hours.

Records, once the domain points at the reseller server:

```
A     @                <server IP from cPanel → "Shared IP Address">
CNAME www              eazworld.co
A     api              <same server IP>
```

Do not hardcode that IP anywhere in the codebase — read it from cPanel when you need it.

> **These are not `NAMESERVER_1` / `NAMESERVER_2`.** Those env vars are the *vanity*
> nameservers EazWorld hands to hosting **customers** (`services/namecheap.js`,
> `utils/hostingEmail.js`), and they point at the reseller server, not at
> `registrar-servers.com`. Two different things that both look like "our nameservers".

---

## Running our own apps

Both apps run under **Phusion Passenger**, registered in cPanel → **Setup Node.js App**
inside the reseller account's own cPanel.

| | Backend API | Frontend |
|---|---|---|
| Application root | `~/api.eazworld.co` | `~/eazworld.co` |
| Application URL | `api.eazworld.co` | `eazworld.co` |
| Startup file | `server.js` | `node_modules/.bin/next` (`start`) |
| Node version | 20.x | 20.x |
| Mode | Production | Production |

Environment variables are entered in that same cPanel screen, **not** committed. `.env`
stays on the server only; see `.env.example` for the full list. Set
`NODE_OPTIONS=--max-old-space-size=512` on the API — `server.js` logs the effective heap
on boot and warns if the flag did not take.

> ⚠️ **Cron needs a real `.env` file as well.** Variables set in *Setup Node.js App* are
> injected by Passenger into the **web process only** — a crontab entry inherits none of
> them. So the same values must also exist as `~/api.eazworld.co/.env`, or every job dies
> on a missing `MONGO_URL`. `scripts/runJob.js` calls `validateEnv()` before connecting so
> this fails loudly on the first run rather than quietly at 2am. Keep the two in step:
> changing a value in the cPanel UI does **not** change the file.

TLS is issued and renewed by cPanel AutoSSL (Let's Encrypt). No certbot, no renewal cron.

---

## Deploying

cPanel → **Git Version Control** → clone each repo, then *Update from Remote* → *Deploy
HEAD Commit*. Each repo's `.cpanel.yml` defines what that does: copy source, install
dependencies, and `touch tmp/restart.txt`, which is how Passenger restarts.

Build the frontend **over SSH, in place** — not locally. `.next/` is gitignored, so a local
build never reaches the server's checkout; only an in-place build does:

```bash
ssh <cpanel-user>@<server>.web-hosting.com
cd ~/repositories/frontend-eaz && npm ci && npm run build
```

Then deploy. Building during the deploy hook itself is avoided because a failure mid-way
would leave a half-copied `.next` on the live site.

Credentials are per-account and must never be committed:

```
SSH host   <server>.web-hosting.com        # from cPanel → SSH Access
SSH user   <cpanel-username>
SSH key    ~/.ssh/id_ed25519               # upload the public half in cPanel
```

---

## The registrar API (customer domain sales)

`services/namecheap.js` is the sole registrar integration. Credentials come from
Namecheap → Profile → Tools → **API Access**:

```
NAMECHEAP_API_USER=<your namecheap username>
NAMECHEAP_API_KEY=<from API Access>
NAMECHEAP_CLIENT_IP=<must be whitelisted in API Access or every call is refused>
NAMECHEAP_SANDBOX=false
```

Two things this buys back over the previous registrar:

- **A sandbox.** `NAMECHEAP_SANDBOX=true` points at `api.sandbox.namecheap.com`, so
  registration can be exercised without spending money. Registration had never once been
  tested end to end before this.
- **A pricing endpoint.** `users.getPricing` gives live wholesale cost, cached for an
  hour. `config/domainPricing.js` drops to being the fallback for when that call fails.

**`config/domainPricing.js` still holds costs verified against the *previous* registrar
(2026-08-25).** They are an upper bound, not a fact, until someone re-verifies them
against a Namecheap invoice. Live pricing covers the common case, so this matters only
when Namecheap's pricing call is unavailable.

`.africa` is on sale again — the previous registrar could not sell it. `.gh` / `.com.gh`
remain unsellable: they are registry-restricted by ghNIC, not registrar-limited.

---

## Customer hosting provisioning

Unchanged in behaviour, now pointed at the Namecheap reseller server:

```
WHM_HOST=https://<your-server>.web-hosting.com:2087
WHM_USER=<reseller username, NOT root>
WHM_TOKEN=<WHM → Development → Manage API Tokens>
WHM_PACKAGE_PREFIX=<defaults to WHM_USER>
```

Packages must exist in WHM as `<prefix>_eazworld_<planType>_<tier>` — create them before
the first order, or `createacct` fails on a paid order.

Only `shared` and `wordpress` plans auto-provision. `vps` / `cloud` / `email` orders are
marked `skipped` and handled through the manual queue at
`GET /api/v1/hosting/orders/awaiting-provisioning`.

### The seven packages to create

The catalogue is sized to the **Nebula** reseller plan. Create exactly these, and keep the
quotas at or under the figures shown — they are chosen so the whole catalogue fits:

| WHM package | Disk | Mailboxes | Addon domains | Databases |
|---|---|---|---|---|
| `<prefix>_eazworld_shared_deluxe` | 1 GB | 1 | 0 | 2 |
| `<prefix>_eazworld_shared_professional` | 3 GB | 3 | 0 | 5 |
| `<prefix>_eazworld_shared_enterprise` | 6 GB | 5 | 2 | 10 |
| `<prefix>_eazworld_shared_ultimate` | 10 GB | 10 | 9 | 20 |
| `<prefix>_eazworld_wordpress_starter` | 2 GB | 1 | 0 | 2 |
| `<prefix>_eazworld_wordpress_business` | 5 GB | 3 | 0 | 5 |
| `<prefix>_eazworld_wordpress_agency` | 8 GB | 5 | 2 | 10 |

### Why these numbers — Nebula's limits are PLAN-WIDE

| | Nebula | Galaxy Expert | Universe Pro |
|---|---|---|---|
| cPanel accounts | **25** (cannot be raised) | 100 | 150 |
| Disk | **30 GB** | 90 GB | 150 GB |
| Mailboxes | **30 total** | Unlimited | Unlimited |
| Physical memory | **4 GB** | 8 GB | 12 GB |
| Email rate | 50 msg/hour per domain | 200/hour | 200/hour |

Every figure is a total for the whole plan, shared by all customers **and by
`eazworld.co` itself** — not a per-account allowance. Reading them as per-account is how
the catalogue once advertised a 50 GB shared tier on a 30 GB plan, and an `ultimate` tier
promising unlimited storage and unlimited mailboxes.

Budget: **6 GB / 5 mailboxes / 2 accounts** reserved for the site and API, leaving
**24 GB / 25 mailboxes / 23 accounts** to sell. Capacity then runs to 23 `deluxe`
customers (accounts bind first), 8 `professional`, 4 `enterprise` or 2 `ultimate`.
Nebula costs ~$17.88/mo, so break-even is 6 `deluxe`, 3 `professional` or 2 `enterprise`.

**Do not advertise per-account RAM on a shared tier.** Nebula has 4 GB in total; a
"1GB RAM" line on a $3 plan is the same category error as the 50 GB tier was.

### What is sellable — `PLAN_AVAILABILITY`

A reseller plan creates cPanel accounts and nothing else, so
`config/hostingPlans.js` marks each plan type with an availability, and that one
table drives both the storefront button and the `createOrder` guard:

| Availability | Types | Behaviour |
|---|---|---|
| `instant` | `shared`, `wordpress` | Bought online, auto-provisioned |
| `enquiry` | `vps` | Listed with indicative "from" prices; the card links to `/contact?subject=…`. `createOrder` returns 400 |
| `unavailable` | `cloud`, `email` | Not returned by `GET /hosting/plans` at all; `createOrder` returns 400 |

It ships on each plan object as `plan.availability`, alongside the prices, so the
storefront cannot hold an opinion the API disagrees with — the same drift that
once let the frontend advertise GH₵9/mo against a GH₵62/mo charge.

Resolved 2026-08-31. Previously `vps` took payment upfront against a
"built to order" banner and landed in the manual queue — but there is no VPS
supplier behind that queue, so it was money taken for a server nobody could
source. `cloud` and `email` had no storefront link yet were still accepted by the
endpoint. Selling either again means finding a supplier and pricing it as resold
third-party infrastructure first.

**Staff are unaffected:** `staffCreateHostingAccount` still accepts any plan type,
for an order that has genuinely been sourced.

### One catalogue, not two

`config/hostingPlans.js` is the single source of truth. The storefront reads it over
`GET /api/v1/hosting/plans` (`hooks/queries/useHosting` → `lib/hostingPlans.js`).

It used to keep its own copy in `src/data/hostingHostingData.js`; T66/T67 repriced the
backend on 2026-08-26 and that copy was missed, so the page advertised GH₵9/mo where
checkout charged GH₵62/mo — about sevenfold on every shared tier. Do not reintroduce a
price list in the frontend.

---

## Background jobs — cron, not setInterval

Four jobs used to run on `setInterval` inside `server.js`. Passenger idles an app out when
there is no traffic, and an idled app fires no timers — so a quiet night meant renewal
reminders never sent, scheduled posts never published, and refunds never reconciled, with
nothing in the logs to say so.

They are now driven by **cPanel cron**, through `scripts/runJob.js`. Set
`IN_PROCESS_JOBS=false` in the API's cPanel environment so the old timers stay off:
running both would double every reminder email and every reconciliation.

cPanel → **Cron Jobs**. `~/api.eazworld.co` is the app root from the table above:

```cron
# Hosting renewals: reminders, suspensions, terminations — daily, 02:15
15 2 * * *   cd ~/api.eazworld.co && /usr/local/bin/node scripts/runJob.js renewals

# Uncollected device reminders — twice daily, 08:30 and 20:30
30 8,20 * * * cd ~/api.eazworld.co && /usr/local/bin/node scripts/runJob.js reminders

# Scheduled blog publishing — hourly, on the hour
0 * * * *    cd ~/api.eazworld.co && /usr/local/bin/node scripts/runJob.js publish

# Refund reconciliation — every 2 hours. Refunds settle over DAYS (a live MTN GHA
# mobile-money refund reported ~9 days out), so a tighter schedule polls for nothing.
0 */2 * * *  cd ~/api.eazworld.co && /usr/local/bin/node scripts/runJob.js refunds
```

Confirm the Node path with `which node` over SSH — cPanel's Node.js selector installs
per-version, so it is often under `~/nodevenv/...` rather than `/usr/local/bin`.

Set **MAILTO** at the top of the crontab. Each run exits non-zero on failure, which is the
only way anyone finds out — the in-process versions swallowed every error with
`.catch(() => {})`.

Run one by hand to check wiring:

```bash
cd ~/api.eazworld.co && npm run job:publish
```

Locally, nothing changes: `IN_PROCESS_JOBS` defaults to on, so `npm run dev` still
schedules all four in process.

---

## Open items

1. **Re-verify domain costs** against a Namecheap invoice and update
   `config/domainPricing.js` (see above). Until then the fallback prices may be wrong.
2. **Prove a registration end to end** in the sandbox, then once with a cheap real
   domain. This has never been verified against any registrar.
3. **Create the WHM packages** before selling a plan. `npm run check:whm` reports
   which are missing — it deploys with the app (`.cpanel.yml` copies `scripts/`, and
   its deps are production ones), so run it on the server where the real credentials
   live.
4. **Passenger may run more than one process** — pin the process count to 1 in
   cPanel → Setup Node.js App. There is no process-count setting anywhere in this
   repo; it exists only in that UI, so nothing in the codebase can assert or enforce
   it. The jobs no longer care — cron runs once regardless — but five pieces of
   module-scoped state do:

   | State | Where | Effect with N processes |
   |---|---|---|
   | **Rate limiters** (11) | `app.js:151`, `express-rate-limit` default MemoryStore | every limit becomes **N×** its intended value |
   | Shipping cache | `services/shipping/shippingCache.js:18` | stale reads up to the 5-min TTL on instances that did not serve the admin write |
   | Location taxonomy cache | `controllers/locationController.js:14` | ditto, 60 s — an instance that did not serve the write keeps offering a city we stopped delivering to |
   | Pickup cache | `controllers/pickupController.js:10` | ditto, 60 s — a retired bus station stays bookable |
   | Namecheap price cache | `services/namecheap.js` | N× the paid pricing API calls per hour |

   > The first sweep (2026-08-31) listed only three, because it grepped for
   > module-level `Map`/`Set`. The location and pickup caches are plain
   > `{ ts, data }` objects and were missed; they surfaced during T80p on
   > 2026-09-01. **Grep for module-scoped `let`/`const` object state too, not
   > just collections.**

   **The rate limiters are the sharper edge, not the cache.** Two matter: the login
   limiter (10 attempts/15 min) is the brute-force guard, and `/api/v1/domain`
   (30/15 min) is what stops `/check-bulk` — unauthenticated, 50 domains a call —
   burning through the Namecheap key quota. Scaling out later needs Redis for the
   limiters as well as the cache, not just the cache.

5. **Lost with Nginx:** the TLS cipher/OCSP policy (T95) and `client_max_body_size 6m`
   (T81). HSTS and CSP still come from helmet and `next.config.mjs`.

   **The body-size half is a footnote, not a gap** (verified 2026-08-31). The app
   enforces its own limits: `express.json`/`urlencoded` at 5mb (`app.js:105`), multer
   at 5MB (`uploadController.js:15`, `accountController.js:23`) and 8MB for POS job
   photos (`posRoutes.js:24`). Every upload route sits behind `protect`, `/api/v1/uploads`
   additionally behind admin/staff, and all are `.single()` or `.fields()` with
   `maxCount: 1` — so the worst case is ~10MB buffered by an authenticated user, which
   a 512MB heap absorbs. The only real change is that rejection now happens in Node
   after buffering rather than at the edge before it. Residual exposure is
   `express.json`'s 5mb on unauthenticated `/api/` routes, bounded by the global
   150/15 min limiter — which is item 4 again.

**Item 4 is the one that can still bite silently.**
