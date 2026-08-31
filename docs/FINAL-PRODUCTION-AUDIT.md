# EazWorld Final Production Audit

**Date:** 2026-08-29 · **Scope:** independent re-audit of the current tree, not a re-read of prior audits
**Method:** static analysis of current source, targeted and full test runs, dependency audits, production
build, and read-only queries against the live Atlas database. **No application code was modified.**

---

## 1. Final Verdict

### NOT PRODUCTION READY

Three findings block deployment, and none is a matter of polish:

1. **The backend does not fail safely without `FRONTEND_URL`** (T119). It returns an empty string and
   carries on. That value is interpolated into the **Paystack `callback_url`** in six places and into
   customer SMS tracking links. T97 fixed this class of bug on the frontend only; the backend half was
   never touched, and `validateEnv.js` does not require the variable. A production deploy missing one
   env var sends customers to a relative URL after paying.
2. **Deployment configuration is not in version control** (T122). `nginx.conf` and
   `ecosystem.config.js` sit in a directory that is not a git repository; there is no `Dockerfile` or
   `docker-compose.yml` in the tree at all. The files defining how the app is served exist only on one
   laptop. You cannot deploy reliably or repeatably from what is committed.
3. **`nginx.conf` is still the unedited template** (T82, previously reported, still true).
   `server_name yourdomain.com`, certificate paths under `/etc/letsencrypt/live/yourdomain.com/`, no
   `client_max_body_size` (T81 — uploads over 1 MB fail), no TLS hardening or HSTS (T95).

The application code is in materially better shape than the deployment story. Payment integrity,
authorization and data-ownership are strong (§5, §7). What is not ready is everything between the
code and a running server.

---

## 2. Executive Summary

The **application** is close. The shop payment path is genuinely well built: prices are read from the
database and never from the request, and fulfilment is a single atomic conditional update that makes
duplicate and replayed webhooks safe by construction. Authorization was materially hardened in this
cycle and is now enforced server-side rather than by hiding buttons.

The **deployment** is not close. Nothing that turns this repository into a running service is
committed, and the one proxy config that exists has never been edited from its template.

One regression was introduced during the fixing cycle and is caught here: backend `main` currently
fails its own test suite (T118).

**Verified fixed:** T83, T84 (part 1), T86, T87, T90, T94, T97 (frontend only), T100, T101, T106, T107,
T110, T112, T113, T114, T116, T117.
**Still open from the previous audit:** T81, T82, T85, T88, T89, T91, T92, T93, T95, T96.
**New this audit:** T118–T124.

---

## 3. Architecture

```text
Customer browser
      │
      ▼
Next.js 14 App Router (frontend-eaz, :3000)
  · JS/JSX, Tailwind, react-query + fetch wrapper (lib/api.js)
  · middleware.js — JWT verify (jose), maintenance gate, role routing
      │  same-origin /api/v1/* → Next rewrite → NEXT_PUBLIC_API_URL
      ▼
Express API (backend-eaz, :5000)
  · helmet + CSP, xss-clean, express-mongo-sanitize, hpp, rate-limit, cors, cookie-parser
  · protect / restrictTo / denyRoles  (JWT in an httpOnly cookie)
  · Zod validation in validation/, controllers in classic MVC
      │
      ├── Mongoose ──► MongoDB Atlas (cluster0…/eazworld)
      │
      └── Services
            · Paystack        payments — card + Mobile Money (GHS, pesewas)
            · Namecheap       domain search / registration
            · WHM             hosting provisioning (cPanel reseller server)
            · Cloudinary      image uploads
            · Resend + react-email  transactional email
            · Anthropic SDK   chat assistant
            · Hubtel          SMS (verification PINs, tracking links)

Background jobs: cPanel cron via scripts/runJob.js — renewals (24 h),
reminders (12 h), scheduled publish (1 h), refund reconcile (2 h).
IN_PROCESS_JOBS=false disables the in-process timers so they cannot double-run.

Serving: Phusion Passenger on a Namecheap cPanel reseller plan (LiteSpeed,
AutoSSL). Deployed by .cpanel.yml through cPanel Git Version Control.
```

**External dependencies that can take the site down:** MongoDB Atlas, Paystack, Resend, Cloudinary,
Namecheap, WHM, Hubtel, Anthropic.

---

## 4. Previous Audit Verification

Each verified against current source, not against the checkbox.

### Fixed — confirmed in code

| Task | Verification |
|---|---|
| **T83** POS role separation | `denyRoles('technician')` on `/scan`, `/customers*`, `/sales*`, `GET /inventory`; `createSale` enforces `CAN_CREATE_SALE = ['superadmin','staff']` internally, so it survives router re-wiring. Reports/suppliers/warranty and stock writes are superadmin+admin. 18 role-guard tests. |
| **T86** public order PII | `getOrderByReference` returns `publicOrderView(order)` — no email, no street, name masked to `Ama O.`, phone to last 3 digits. A test scans the whole serialized body for each PII string. |
| **T87** unbounded `limit` | `utils/pagination.js`; all five endpoints converted. `grep -rnE "\.limit\(Number\(\|\.limit\(parseInt"` over `controllers routes services` returns **nothing**. |
| **T90** webhook amount | `amountMismatch` refuses when no expected amount is verifiable. Live counts confirmed all five order collections empty, so no legacy orders were stranded. |
| **T94** signature timing | `crypto.timingSafeEqual`, length-guarded first (it throws on mismatch, which would have turned a 400 into a 500). |
| **T100** checkout errors | `errorMessage()` in `lib/api.js`, wired into checkout's three handlers. |
| **T101** frontend suite | 54/54 files, 357/357 tests. |
| **T106/T110/T112/T113/T114/T116/T117** | Verified by their tests and, for T114/T117, against live data and the running API. |

### Partially fixed

| Task | What remains |
|---|---|
| **T97** `FRONTEND_URL` | Frontend throws correctly and is verified by build. **The backend does not** — `utils/frontendUrl.js` returns `""`. → **T119 / T123**. The acceptance criteria were written per-repo, which is how this stayed hidden. |
| **T84** guest-order claiming | Part 1 shipped: a phone binds only after an SMS PIN. Part 2 (matching only verified contacts) deliberately deferred by owner decision — numbers claimed before the fix stay claimed. Accepted, recorded. |
| **T98** page metadata | `/repair` and `/track-order` fixed; `/seo` deliberately left (it is a redirect shim, → T103). |
| **T99** Next 16 | Assessed and scheduled, not executed. → **T124**. |

### Still broken — re-confirmed against current code

| Task | Evidence |
|---|---|
| **T81** upload size | `grep -c client_max_body_size nginx.conf` → **0**. Nginx defaults to 1 MB; uploads are capped at 8 MB in multer. |
| **T82** nginx template | `server_name yourdomain.com www.yourdomain.com`, `/etc/letsencrypt/live/yourdomain.com/…`, plus a dead `location /api/v1/domain/webhook` block for a route that does not exist. |
| **T85** `NODE_ENV` | `env_production` in `ecosystem.config.js` only applies with `pm2 start --env production`. Without it: secure/sameSite cookies off (`authController.js:44-45`), stack traces in 500 responses (`errorHandler.js:69`), **and `validateEnv`'s Paystack check skipped**. |
| **T88** `isVerified` | `middleware/auth.js` never reads it. An unverified account holds a valid token. |
| **T91** session invalidation | No `tokenVersion`, `passwordChangedAt`, `jti` or denylist anywhere. A stolen JWT stays valid through logout and password change until expiry. |
| **T93** `$regex` escape | `routes/adminRoutes.js:22` — `filter.to = { $regex: q.trim() }`, unescaped. Admin-only, so ReDoS by a trusted user. |
| **T95** TLS/HSTS | No `ssl_protocols`, no HSTS header in `nginx.conf`. |
| **T96** job double-run | `setInterval` in-process (`server.js:105-141`). Mitigated only by `instances: 1`. |
| **T89** under-fulfilment | No flag or alert path found in `fulfilShopOrder`. |

### Obsolete

None. Every prior task still describes a real concern.

---

## 5. Security Assessment

**Authentication** — JWT in an httpOnly cookie; bcrypt; PIN verification at registration; 2FA present.
`protect` rejects missing/invalid tokens and blocked users. **Gap:** `isVerified` is not checked (T88),
and there is no way to invalidate a live token (T91).

**Authorization** — Now genuinely server-side. `restrictTo` treats superadmin as implicit;
`denyRoles` used for technician exclusions. Sales creation is enforced in the controller as well as the
route. Middleware additionally blocks the three POS management routes before the page renders. Three
layers: sidebar hides, route refuses, API 403s — and the sidebar is explicitly not the guard.

**IDOR** — Checked every customer-owned resource. Order routes taking `:id` are all admin/staff;
customers reach only `/orders/mine` and `/orders/mine/:id`, both scoped by email/phone from `req.user`
and never from a client id. Addresses, notifications and reviews scope by `req.user`. Hosting renewals
verify the parent order's owner matches. The one unscoped `findById` is admin-only. **No IDOR found.**

**Injection** — No `$where`, no `mapReduce`. `express-mongo-sanitize` strips operator keys. One
unescaped `$regex` remains (T93, admin-only). Four `{ ...req.body }` spreads exist but are all
admin/staff-gated behind strict Mongoose schemas — **RECOMMENDATION**, not a hole.

**Secrets** — No hardcoded credentials found. No secret-bearing `NEXT_PUBLIC_` variable. `.env` is
gitignored. Note `MONGO_URL` carries a `<PASSWORD>` placeholder substituted from `DATABASE_PASSWORD`
at `server.js:71-73` — deliberate, and worth knowing before anyone debugs a connection.

**Payments/webhooks** — See §7. Strongest area of the codebase.

---

## 6. User Flow Assessment

Flows were traced through source and the running API. **Live mutating flows were deliberately not
exercised**: the only database reachable from here is production Atlas, and Phase 3/4 as written would
have created users and orders in it. Ownership and role boundaries were instead verified through the
test harness (`mongodb-memory-server`), which is where the 18 role-guard, 9 expense-scope and 7
redaction tests run.

| Flow | State |
|---|---|
| Register → verify → login → dashboard | Complete. PIN goes to email **or** phone, never both — so a phone on an email-registered account is unproven (this is why T84 needed its own field). |
| Login / logout / bad credentials / reset | Complete. Logout clears the cookie but cannot invalidate the token (T91). |
| Shop browse → cart → checkout → pay → confirm | Complete and verified end to end in code. |
| Shipping quote → order → tracking | Complete; verified live (§10). |
| Expenses, POS sell, jobs, warranty | Complete, correctly role-scoped. |
| Domain search → pay → register | Partially implemented — see §8. |
| Hosting order → provision | Partially implemented — see §9. |

---

## 7. Payment Assessment

Traced the full lifecycle. **This is the strongest part of the system.**

- **Amount cannot be manipulated.** `createOrder` reads `price` from `Product` by `slug`; the request
  supplies only `slug` and `qty`. `sellOnline` and stock are checked per line.
- **Shipping fee cannot be zeroed.** A client-echoed `shippingFee` is *validated* against the stored
  `ShippingQuote` (cart hash bound), refused below tolerance and clamped above it. The comment states
  the rule outright: a crafted body with `shippingFee: 0` must not be honoured.
- **Fulfilment is atomic.** `fulfilShopOrder` is one
  `findOneAndUpdate({ paystackReference, status: 'pending', total: amountPesewas })`. That single
  filter delivers idempotency, replay safety and amount-binding together. It throws rather than
  no-ops on a missing amount or a currency mismatch, and only re-reads to distinguish
  already-fulfilled from amount-rejected.
- **Signature** verified with `crypto.timingSafeEqual` over the raw body; missing or wrong-length
  headers 400 rather than throw.
- **Unverifiable amounts no longer fulfil** (T90), and the reason is recorded in the activity log so
  an operator can see a held charge.

**Gaps:** hosting/domain fulfilment guards duplicates with read-then-check rather than an atomic
update (**T121**, POTENTIAL RISK) — the shop pattern is right there to copy. And **refusing to fulfil
does not refund**: the money is taken and the activity-log entry is the only record that someone must
act on.

---

## 8. Domain Assessment

Search, availability and pricing are implemented against Namecheap, which exposes a pricing endpoint
(`users.getPricing`, cached an hour); `config/domainPricing.js` holds per-TLD USD costs as the
fallback. `.gh` and `.com.gh` are rejected up front as registry-restricted; `.africa` is sellable.
Payment initialization and the webhook branch exist.

**Not verifiable here:** `tests/setup.js` deliberately blanks the API credentials, so every
registration path is exercised against mocks only. **The live round-trip has never been proven**
(tracked as T3). Namecheap does have a sandbox (`NAMECHEAP_SANDBOX=true`), so unlike the previous
supplier this is provable without spending money — but until someone runs it, treat domain
registration as untested in production terms.

---

## 9. Hosting Assessment

Models, checkout, payment and the provisioning queue exist. WHM provisioning is implemented, with an
explicit manual-queue fallback when WHM is unconfigured (T64). Renewal logic verifies that a renewal's
parent order belongs to the same user — a real ownership check, correctly placed.

**Incomplete as a flow:** SSL, suspension and cancellation are present as data/UI concepts rather than
proven end-to-end paths, and the live provisioning round-trip is unverified (T3). Per the audit's own
rule — a model and a screen are not a feature — hosting should be treated as **partially implemented**.

---

## 10. Shipping Assessment

Verified against the running API, not just the source. After this cycle's fixes the live endpoint
returns exactly the three intended options:

```
courier speeds: standard, next_day, express
all methods   : in_house_delivery, courier_dispatch_standard,
                courier_dispatch_next_day, courier_dispatch_express
```

Region → city → neighborhood → zone resolution works; pickup locations resolve for regional cities;
quotes are stored and re-validated at checkout against a cart hash. Two defects found and fixed during
the cycle: the methods endpoint had two divergent code paths (T116), and `same_day` duplicated
Express's promise at a *cheaper* multiplier (T117).

**Caveat:** two shipping suites (`distanceZones`, `shippingEndpoints`) still pass or fail on the wall
clock (T115) — they assert Express is offered without pinning the cutoff hour, so they will fail again
after 17:00.

---

## 11. Frontend Assessment

Build clean, lint clean, 357/357 tests. Metadata, canonicals, sitemap and robots all derive from
`SITE_URL` and emit the production domain; no `localhost` appears anywhere in prerendered output.
The marketplace was collapsed from two tabs that listed the same collection twice into one filtered
list. The orders list no longer mutates — updates moved to the detail page that already owned them.

**Known gaps:** 84 call sites still show raw `err.message` instead of the `errorMessage()` helper
(T102); `/seo` is a client-side redirect shim advertised in the sitemap (T103); seven pages render a
doubled `| EazWorld` suffix (T104).

---

## 12. Backend Assessment

Classic MVC, consistently applied. Controllers are `async (req,res,next)` with `try/catch → next(err)`.
Security middleware is wired in `app.js`. Zod validation exists in `validation/` but is not applied
uniformly — several controllers still parse manually.

**Concerns:** background jobs run on `setInterval` in-process and are safe only because PM2 is pinned
to one instance (T96); no transactions around multi-document money writes beyond the atomic
`findOneAndUpdate` in the shop path; error responses include stack traces whenever `NODE_ENV` is not
`production` (T85).

---

## 13. Database Assessment

Read-only checks against live Atlas. Indexes are present and deliberate — compound `category+isActive`,
channel indexes for `sellOnline`/`sellInStore`/`useInRepairs`, and a **partial unique** index on `sku`
scoped to non-empty values. Money is stored as integer pesewas throughout, as the project requires.

The parts/products merge is complete: nothing requires `models/Part` any more, ids were preserved so
historical `ref: 'Part'` pointers still resolve, and the old collection was left intact for rollback.

Live counts: `hostingorders`, `domainorders`, `serviceorders`, `partorders`, `repairorders` are **all
empty** — which is what made T90's default-inversion safe.

---

## 14. Environment Assessment

`validateEnv.js` fails fast in production on `MONGO_URL`, `JWT_SECRET` (min 32 chars) and
`PAYSTACK_SECRET`. The webhook fails closed without its secret.

**Two problems:**
1. **`FRONTEND_URL` is not validated at all** and degrades to `""` (T119). It should sit alongside the
   three that already `process.exit(1)`.
2. **Every one of those guards is gated on `NODE_ENV === 'production'`** (T85), which PM2 supplies only
   when started with `--env production`. Forget the flag and the environment validation, the secure
   cookie flags and the stack-trace suppression all switch off together — silently.

No secrets are hardcoded; no secret-bearing `NEXT_PUBLIC_` variable exists.

---

## 15. Dependency Assessment

| | Result |
|---|---|
| `backend-eaz` `npm audit` | **0 vulnerabilities** |
| `backend-eaz` `npm audit --omit=dev` | **0 vulnerabilities** |
| `frontend-eaz` `npm audit --omit=dev` | **2 high** |

Both high findings are PostCSS, reaching the app through `next@14.2.35`; the advertised fix is
`next@16.3.3`, a major upgrade. PostCSS itself is build-time, so those two are not a live request path.
The `next` advisories bundled into the same upgrade **are** runtime, and the image-optimizer ones stay
reachable while `remotePatterns` is `hostname: "**"`. Narrowing that wildcard reduces the reachable
surface without the framework upgrade — a smaller, faster mitigation than T99.

---

## 16. Performance Assessment

Pagination is now clamped everywhere (T87) and `getAdminProducts` no longer loads the whole catalogue
unpaginated (T107) — with a stable `{ createdAt, _id }` sort, since sorting on a non-unique field made
skip-paging repeat and drop rows.

Remaining, all minor: the product edit page still fetches up to 200 documents to render one form
(T109); `getProducts` uses `lean()` inconsistently across controllers; the 512 MB heap leaves little
headroom, which is exactly why the clamps mattered.

---

## 17. Deployment Assessment

**This is where the project is weakest.**

| Requirement | State |
|---|---|
| Dockerfile | **Absent from the repo.** Reported to exist outside it. |
| docker-compose | **Absent.** |
| Nginx config | Present but **untracked** and still a template (T82/T81/T95). |
| PM2 config | Present but **untracked**; `NODE_ENV` only with `--env production` (T85). |
| Health check | `GET /api/health` exists (unversioned). |
| Graceful shutdown | Not found. |
| Logging | `morgan` to stdout; no aggregation or rotation. |
| Backups | No policy or script found. |
| Monitoring | None found. |
| CORS | Configured in `app.js`, origin-driven. |
| Webhook reachability | Depends on the Nginx block that is still templated. |

`render.yaml`, `deploy/nginx.conf` and `deploy/ecosystem.config.js` have since been deleted along with
`amplify.yml` — the target is a Namecheap cPanel reseller plan, where there is no root, no Nginx and
no PM2. See `docs/HOSTING.md`.

---

## 18. Test Results

Exact figures from this audit.

```text
Frontend tests:     PASS   54/54 files, 357/357 tests
Frontend lint:      PASS   0 errors, 0 warnings
Frontend build:     PASS   next build exit 0 (isolated worktree)
Frontend type check: N/A   JavaScript project, no TypeScript
Backend tests:      FAIL   78/82 suites, 988/1009 tests — 21 failures
Backend lint:       PASS   0 errors (warnings only, pre-existing)
Backend build:      N/A    no build step (CommonJS)
Dependency audit:   FAIL   frontend 2 high; backend 0
```

**The 21 backend failures split in two:**

- **4 in `webhook.test.js` — a real regression** introduced by T90 and caught here (**T118**). The unit
  test still asserts the old boolean contract, and one case asserts the *pre-fix* behaviour that T90
  deliberately inverted.
- **17 across `productReviews`, `salesScoping`, `technicianHostingDomainAccess` — harness instability**
  (**T120**), not assertions: `Instance failed to start within 10000ms` from mongodb-memory-server,
  then Mongoose buffering timeouts. All three pass in isolation. Suite times of 2058 s, 900 s and 605 s
  against a 4407 s total identify this as the cause of the two "hangs" seen today and of T108.

---

## 19. Remaining Issues

### Critical
- **T119** — backend `FRONTEND_URL` degrades to `""`; reaches Paystack `callback_url` and customer SMS links
- **T122** — no deployment configuration in version control; no Dockerfile anywhere in the tree
- **T82** — `nginx.conf` is an unedited template (`yourdomain.com`, wrong certificate paths)

### High
- **T118** — backend `main` fails its own suite (regression from T90)
- **T85** — `NODE_ENV` not guaranteed; three security controls plus env validation switch off together
- **T81** — no `client_max_body_size`; uploads over 1 MB fail behind Nginx
- **T91** — no session invalidation on logout or password change
- **T88** — `protect` does not check `isVerified`
- **T120** — full backend suite cannot be trusted to pass or terminate

### Medium
- **T121** — non-atomic duplicate-webhook guard on hosting/domain
- **T95** — no TLS hardening or HSTS
- **T96** — background jobs double-run if ever scaled beyond one instance
- **T89** — paid orders can silently under-fulfil
- **T124/T99** — 2 high frontend advisories; image-optimizer surface open via `remotePatterns: "**"`
- **T115** — two shipping suites depend on the wall clock
- **T3** — Namecheap and WHM live round-trips never verified

### Low
- **T93** unescaped `$regex` (admin-only) · **T102** 84 raw `err.message` sites · **T103** `/seo` redirect shim
- **T104** doubled title suffix · **T105** `roles.md` vs routes on ~11 rows · **T109** edit page fetches 200 docs
- **T111** unreachable staff-scoping code · **T92** missing authorization/pagination tests
- Four admin-gated `{ ...req.body }` spreads — RECOMMENDATION only

---

## 20. Production Blockers

**Must be fixed before deployment:**

1. **T119** — make the backend fail fast without `FRONTEND_URL`, as the frontend already does. Without
   it a single missing variable silently breaks payment callbacks and customer tracking links.
2. **T122** — commit `nginx.conf`, `ecosystem.config.js` and the Dockerfile to a repository. You cannot
   deploy repeatably from a config that exists on one laptop.
3. **T82 + T81 + T95** — write the real `nginx.conf`: correct `server_name` and certificate paths,
   `client_max_body_size` at or above the 8 MB multer limit, TLS hardening and HSTS. Delete the dead
   `/api/v1/domain/webhook` block.
4. **T85** — guarantee `NODE_ENV=production` at the process level, not only via `pm2 --env production`.
   Everything else on this list is undermined if it is missing.
5. **T118** — get `main` green. Shipping from a branch whose suite fails means the next real regression
   is invisible.

**Strongly recommended before taking real money:**
- **T91** and **T88** — a stolen token cannot currently be revoked, and an unverified account is fully
  authenticated.
- Decide explicitly on **T124** — accept the advisories, or narrow `remotePatterns`.

---

## 21. Deployment Checklist

- [ ] Production environment variables set and verified — `MONGO_URL` + `DATABASE_PASSWORD`, `JWT_SECRET` (≥32 chars), `PAYSTACK_SECRET`, **`FRONTEND_URL`**, `NEXT_PUBLIC_API_URL`, `RESEND_API_KEY`, `CLOUDINARY_*`, `NAMECHEAP_*`, `HUBTEL_*`
- [ ] `NODE_ENV=production` guaranteed at process level (not only `pm2 --env production`)
- [ ] Database reachable from the VPS; Atlas IP allowlist includes it
- [ ] Backups configured and a restore actually tested
- [ ] VPS provisioned, firewalled, SSH hardened
- [ ] Dockerfile committed to a repository and building reproducibly
- [ ] docker-compose (or equivalent orchestration) committed
- [ ] Nginx: real `server_name`, `client_max_body_size ≥ 8m`, TLS hardening, HSTS, dead webhook block removed
- [ ] SSL certificates issued for the real domain; renewal automated
- [ ] DNS A records point at the VPS; `www` vs apex decided and redirected consistently
- [ ] CORS origins match the production domain
- [ ] Paystack webhook URL registered and reachable from the internet; signature verified end to end
- [ ] Monitoring and alerting in place
- [ ] Log aggregation and rotation
- [ ] Health check wired to the process manager (`GET /api/health`)
- [ ] Graceful shutdown on SIGTERM
- [ ] Final smoke tests: register → verify → login → order → pay → webhook → confirmation → tracking
- [ ] Confirm no `localhost` appears in any production-emitted URL (canonicals, sitemap, callbacks, SMS)
