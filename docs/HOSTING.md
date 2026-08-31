# Domain & hosting — eazworld.co on Spaceship

**Scope.** This document covers **EazWorld's own domain and where its site and API run**. It is not
about the hosting *product* EazWorld sells to customers — that is a separate system
(`services/whm.js`, `config/hostingPlans.js`, `utils/provisionHosting.js`) and is
untouched by this migration.

---

## The plan

| | |
|---|---|
| Provider | Spaceship — **Essential** (shared cPanel) |
| Price | **$19.88/yr** first year, renews at **$28.88/yr** |
| Storage | 20 GB NVMe SSD |
| CPU | 1 core |
| Hosted domains | up to **5** domains/subdomains |
| Panel | cPanel |
| Web server | LiteSpeed |
| TLS | FreeSSL via Let's Encrypt (cPanel AutoSSL) |
| Security | Imunify360 |

### Domain budget (5 of 5 — full)

| Slot | Host | Serves |
|---|---|---|
| 1 | `eazworld.co` | Next.js frontend |
| 2 | `www.eazworld.co` | redirect → apex |
| 3 | `api.eazworld.co` | Express API |
| 4 | *(spare)* | staging / preview |
| 5 | *(spare)* | mail or future subdomain |

Adding a fourth real hostname leaves no room for staging. See **Limits** below.

---

## The domain — eazworld.co

`eazworld.co` is registered at **Spaceship**, the same account as the hosting above.
That is a change of record-keeping only: the domain *product* EazWorld sells to
customers already ran on Spaceship (T130, 2026-08-31, replacing Namecheap) and is
not affected by this migration.

| Setting | Value |
|---|---|
| Registrar | Spaceship |
| Managed at | Spaceship → Domain Manager → `eazworld.co` |
| Auto-renew | **must be ON** — the site and every customer email address depend on it |
| WHOIS privacy | on (free with Spaceship) |
| Transfer lock | on, except during a deliberate transfer |
| DNS | see below |

Renewal is a separate charge from the $19.88/$28.88 hosting — the plan price does
**not** include the domain.

> **Two different Spaceship accounts, one bill.** The API credentials in
> `SPACESHIP_API_KEY` / `SPACESHIP_API_SECRET` are for *reselling domains to
> customers*. They are not used to manage `eazworld.co` itself, and nothing in the
> codebase reads or needs the hosting account's credentials — deployment is a
> cPanel Git push, not an API call.

## DNS

Spaceship issues nameservers **per account** — they are not a fixed published pair.
Take the real values from the cPanel welcome email, or from Domain Manager → your
domain → *Connect to hosting*.

```
NS1 = <from cPanel welcome email>      # e.g. nsX.spaceship.net
NS2 = <from cPanel welcome email>
```

If `eazworld.co` must keep its DNS elsewhere, use the record path instead of the
nameserver path — both are offered in Domain Manager, and the TXT record is
**required** for the connection to work at all:

```
TXT   @                <verification value from Domain Manager>
A     @                <shared server IP from cPanel → "Shared IP Address">
CNAME www              eazworld.co
A     api              <same shared server IP>
```

Propagation takes up to 48 hours. Do not hardcode the shared IP anywhere in the
codebase — it is a shared-hosting IP and Spaceship can change it.

> **Do not confuse these with `NAMESERVER_1` / `NAMESERVER_2`.** Those are the
> *vanity* nameservers EazWorld hands to hosting **customers**
> (`services/spaceship.js`, `utils/hostingEmail.js`). They are unrelated to where
> eazworld.co itself is hosted.

---

## Running the apps

A shared plan has **no root**, so there is no Nginx and no PM2. Both apps run under
**Phusion Passenger**, registered in cPanel → **Setup Node.js App**.

| | Backend API | Frontend |
|---|---|---|
| Application root | `~/api.eazworld.co` | `~/eazworld.co` |
| Application URL | `api.eazworld.co` | `eazworld.co` |
| Startup file | `server.js` | `node_modules/.bin/next` (`start`) |
| Node version | 20.x | 20.x |
| Mode | Production | Production |

Environment variables are entered in that same cPanel screen, **not** committed.
`.env` stays on the server only. See `.env.example` for the full list.

Set `NODE_OPTIONS=--max-old-space-size=512` there — `server.js` logs the effective
heap on boot and warns if the flag did not take.

TLS is issued and renewed automatically by cPanel AutoSSL (Let's Encrypt). There is
no certbot and no renewal cron to maintain.

---

## Deploying

cPanel → **Git Version Control** → clone each repo, then *Update from Remote* →
*Deploy HEAD Commit*. Each repo's `.cpanel.yml` defines what that does.

The backend deploy copies source, runs `npm ci --omit=dev`, and touches
`tmp/restart.txt`, which is how Passenger restarts on shared hosting.

**Build the frontend locally and commit the artifact, or build over SSH.** `next build`
on one shared core is slow and can trip the provider's process limits; see
`frontend-eaz/.cpanel.yml`.

Credentials for SSH/Git are per-account — never commit them:

```
SSH host   ssh.<your-server>.spaceship.host    # from cPanel → SSH Access
SSH user   <cpanel-username>
SSH key    ~/.ssh/id_ed25519                   # upload the public half in cPanel
```

---

## Limits — what Essential does NOT do

Flagged so the upgrade decision is explicit.

1. **No root, no Nginx.** The previous `deploy/nginx.conf` did TLS hardening
   (TLSv1.2+, explicit cipher suite, OCSP stapling, session tickets off — T95),
   `client_max_body_size 6m` (T81), and immutable caching on `/_next/static/`.
   On LiteSpeed shared hosting none of that is settable. Mitigations already in
   place: `helmet` sets HSTS/CSP for the API (`app.js:80`), and `next.config.mjs`
   sets the full header set for the frontend. **Not** mitigated: the cipher/OCSP
   policy and the 6 MB body cap — upload limits now fall to LiteSpeed's default,
   so an oversized upload may be rejected by the server before the app can
   return its own error.

2. **No PM2.** No clustering, no `pm2 reload` zero-downtime restarts, no process
   list. Passenger restarts are a brief cold start.

3. **1 core, shared.** Two Node apps (Next.js SSR + Express) on one shared core.
   The backend is already tuned to a 512 MB heap; the frontend is not.

4. **20 GB, shared with everything** — including backups and mail.

5. **5 hostnames.** Two spare after production. No room for both a staging and a
   preview environment.

6. **No cron-level guarantees.** The in-process jobs (`reminderJob`,
   `refundReconcileJob`, `renewalJob`) still run in-process and are unaffected,
   but Passenger idles the app out when there is no traffic — a long-idle app
   will not fire timers until the next request wakes it. This is a behaviour
   change from PM2, which kept the process alive permanently.

7. **Not viable for the hosting resale product.** Essential is a single cPanel
   account with no WHM. `services/whm.js` needs WHM root/reseller endpoints on
   port 2087 (`createacct`, `create_user_session`, `listpkgs`). Customer
   provisioning cannot run here and will continue to route to the manual queue
   (`utils/provisionHosting.js:37`). That product needs a VPS or reseller plan.

**Item 6 and item 7 are the two worth a decision.**
