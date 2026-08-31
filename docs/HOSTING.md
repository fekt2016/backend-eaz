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
3. **Create the WHM packages** before selling a plan.
4. **Passenger may run more than one process.** `services/shipping/shippingCache.js` and
   the in-memory rate limits assume a single instance; pin the process count to 1 in
   cPanel → Setup Node.js App. The jobs no longer care — cron runs once regardless — but
   the cache and rate limits still do.
5. **Lost with Nginx:** the TLS cipher/OCSP policy (T95) and `client_max_body_size 6m`
   (T81). HSTS and CSP still come from helmet and `next.config.mjs`, but upload size now
   falls to the server default.

**Item 4 is the one that can still bite silently.**
