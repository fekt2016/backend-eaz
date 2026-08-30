# EazWorld Backend — Issue & Fix Tracker

> This is the **backend-eaz** half of the issue tracker. Frontend items live in
> **`frontend-eaz/tasks.md`**. Cross-app tasks are listed in their primary repo and
> cross-referenced.
>
> Sources of truth: **`REVIEWFULL.md`** (full audit 2026-08-29 — 927 backend tests passing, build +
> lint clean; tasks T81-T100 come from it) and the earlier **`AUDIT.md`** (2026-08-18 — 112 backend + 31
> frontend tests passing, build + lint clean). This file turns that audit's findings into
> trackable tasks. Check the box when done and add a PR/commit reference.
>
> **Status key:** `[ ]` open · `[~]` in progress · `[x]` done · `[-]` won't fix / N/A
> **Priority:** **P0** blocking · **P1** important · **P2** improvement
>
> **Convention:** the **user** ticks boxes off (checks with issues); the agent **adds** new
> issues to both `backend-eaz/tasks.md` and `frontend-eaz/tasks.md` when reported.
>
> ⚠️ The older `AUDIT_REPORT.md` in the repo is **stale** (it describes a pre-migration
> Vite/React SPA with no auth). Its "critical" items are already resolved in the current
> code — see the reconciliation note at the bottom. Do **not** re-open those tasks.

---

## P0 — Critical / Blocking

> The app builds and all 927 tests pass; nothing below breaks local development.
> Both P0s are **production deployment** defects — they bite only once the app is
> served through `nginx.conf`. Added from `REVIEWFULL.md` (audit 2026-08-29).

- [ ] **T81 · Nginx rejects every upload over 1 MB** (audit ref EZ-001)
  - **Issue:** `nginx.conf` sets no `client_max_body_size`, so Nginx's 1 MB default applies. The app
    accepts far more: multer `limits.fileSize = 5MB` (`controllers/uploadController.js:15`) and
    `express.json({ limit: '5mb' })` (`app.js:104`).
  - **Impact:** Every product image or job photo between 1 MB and 5 MB — i.e. most phone photos — is
    rejected at the proxy with a 413 the app never sees, so no useful error reaches the user.
  - **Repro:** Deploy behind this `nginx.conf`, sign in as admin/staff, `POST /api/v1/uploads` with a
    2 MB JPEG. Nginx returns 413; the backend logs show no request.
  - **Expected:** Uploads up to the app's 5 MB limit succeed; larger ones are refused **by the app**
    with a readable message.
  - **Fix:** Add `client_max_body_size 6m;` to the `server` block (a little above the app limit so the
    app owns the error message).
  - **Location:** `nginx.conf` (repo root) — no `client_max_body_size` anywhere
  - **Acceptance:**
    - [ ] A 4 MB image upload succeeds end to end in a production-like deploy
    - [ ] A 10 MB upload is refused by the app with a readable error, not a bare proxy 413
    - [ ] Existing upload functionality still works
    - [ ] The proxy limit is documented next to the app limit so the two stay in step

- [ ] **T82 · `nginx.conf` is still an unedited template** (audit ref EZ-002)
  - **Issue:** `server_name yourdomain.com www.yourdomain.com;` (line 2, 8) and
    `ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;` (line 11-12). It also proxies
    `location /api/v1/domain/webhook` (line 33-37) — **a route that does not exist**; the only webhook
    is `POST /api/webhooks/paystack` (`app.js:99`), left over from the retired Namecheap integration.
  - **Impact:** Deployed as-is no server block matches the real host and the TLS cert paths do not
    resolve, so the site does not serve. The stale location block misleads incident triage.
  - **Expected:** `server_name` + cert paths name the real domain; only routes that exist are proxied.
  - **Fix:** Parameterise (or commit) the real domain, point cert paths at the issued certificate,
    delete the dead webhook block, and confirm the Paystack dashboard URL is `/api/webhooks/paystack`.
  - **Location:** `nginx.conf:2,8,11-12,33-37` (repo root)
  - **Acceptance:**
    - [ ] `nginx -t` passes on the production host
    - [ ] HTTPS serves the frontend and `/api/` reaches the backend
    - [ ] Paystack webhook deliveries arrive and verify
    - [ ] No proxy rules remain for routes that do not exist

---

## P1 — Important

- [ ] **T3 · Live E2E verification of external-service flows (the 🟣 items)**
  - **Issue:** 28 features have complete, correct-looking code but were **not** run against
    live third parties in the audit. Logic around them is test-backed; the round-trips are not.
  - **Impact:** Unknown until exercised; these are core revenue/ops paths.
  - **Sub-tasks (run each in sandbox, record result):**
    - [~] T3b · Paystack webhook delivery end-to-end (signature + fulfilment) — **CODE VERIFIED, NEEDS DEPLOY CONFIG**
      - `PAYSTACK_SECRET` (`sk_test_…`) confirmed as the webhook signing secret. `PAYSTACK_WEBHOOK_SECRET` env var is blank —
        the webhook controller reads `PAYSTACK_SECRET` directly (line 100 of `webhookController.js`).
      - **Verified in `tests/webhookE2E.test.js`** (10 tests): valid signature accepted, invalid/missing rejected,
        empty secret rejected, `charge.success` fulfils order (paid + stockDeducted), idempotent on retry,
        amount/currency mismatch rejected, `refund.processed`/`refund.failed` update order status.
      - **To complete live:** configure `POST /api/webhooks/paystack` as the webhook URL in the Paystack dashboard,
        then make a sandbox test payment and confirm the event appears. This is a deployment step, not a code change.
    - [~] T3c · WHM/CyberPanel hosting provisioning + suspend/terminate/renew/cpanel-login — **PARTIALLY BLOCKED** 2026-08-20
      - Credentials are present (`WHM_HOST`/`WHM_USER`/`WHM_TOKEN`) but this dev machine cannot open a
        TCP connection to `WHM_HOST:2087` at all (connect times out / resets after ~8s) — the WHM
        server's firewall only allows specific IPs, and this machine's current egress IP isn't one of
        them. Not a credentials or code issue.
      - **Not attempted:** account creation/suspend/terminate — these mutate a real hosting account on
        a live server and need explicit sign-off regardless of connectivity; out of scope for an
        unattended check even once reachable.
      - **To unblock:** allow-list this machine's current public IP in the WHM server's firewall
        (e.g. ConfigServer/CSF `csf -a <ip>` or equivalent), or run the check from a host that's
        already allow-listed (e.g. the production server itself).
    - [~] T3d · Namecheap domain search + registration + retry — **PARTIALLY BLOCKED** 2026-08-20
  - **Location:** `services/*`, `controllers/*` charge/upload handlers
  - **Source:** AUDIT.md §13, §19, §28, §29 P1 (all 🟣 rows in §4)

- [~] **T83 · A technician can ring up a sale — POS roles are not enforced server-side** (audit ref EZ-003)
  - **Issue:** POS routes sit behind one blanket gate — `protect` then
    `restrictTo('superadmin','admin','staff','technician')` (`routes/posRoutes.js:34-35`) — and several
    add no further check: `/customers` (`:57`), `/sales` (`:76`), `/inventory` (`:83`).
    `createSale` performs no role check internally (`controllers/pos/salesController.js` — only
    `canSeeAllSales` at `:166`, for reads). `roles.md:119-131` marks all three ❌ for technicians and
    `roles.md:180` already flags this exact risk. The frontend hides the Sell page
    (`dashboardNav.js`, `roles: ["superadmin","staff"]`) — **hiding a button is not authorization**.
  - **Impact:** A technician can record sales, move stock and money, read the full customer list and
    read inventory, bypassing the shop's separation of duties.
  - **Repro:** Authenticate as `technician` → `POST /api/v1/pos/sales` with a valid payload → 200 and
    a persisted sale.
  - **Expected:** 403 for roles not on the `roles.md` matrix. **Actual:** the sale is created.
  - **Fix:** Explicit `restrictTo(...)` per route to match `roles.md` (sales: superadmin+staff;
    customer writes: superadmin+admin; inventory read: superadmin+admin+staff). Audit **every** route
    under the blanket gate, not only these three. Note `reportsController` already scopes internally
    (`:175, :272, :522`) — this is an inconsistency, not a blanket absence.
  - **Location:** `routes/posRoutes.js:34-35,57,76,83`; `controllers/pos/salesController.js`
  - **Acceptance:**
    - [ ] Each POS route's allowed roles match `roles.md`  ← technician column matches; ~11 admin/staff rows still diverge, see T105
    - [x] A technician gets 403 on sales, customer writes and inventory reads
    - [x] Staff/admin/superadmin keep their current access  ← unchanged, except admin loses POST /sales by explicit owner decision
    - [x] Negative tests per role (see T92)

  ### Implementation Notes (2026-08-29 — awaiting review)

  - **`routes/posRoutes.js`** — `denyRoles('technician')` (the idiom already used in
    `domainRoutes.js`/`hostingOrderRoutes.js`) on `/scan/:code`, `/customers*`, `/sales*` and
    `GET /inventory`. `denyRoles` rather than a narrower `restrictTo` so no other role's access
    changes. Mounted with `router.use('/sales', …)` and `router.use('/customers', …)` so the
    sub-paths (`/sales/summary`, `/sales/:id`, `/customers/:id`) are covered too.
  - **`controllers/pos/salesController.js`** — `createSale` had **no role check of its own**.
    It now rejects anything outside `CAN_CREATE_SALE = ['superadmin', 'staff']` before touching
    the cart, so the rule survives a future re-wiring of the router.
  - **Product decision, 2026-08-29: admin cannot ring up a sale either.** `roles.md` had
    "Ring up a sale" as ✅ for admin; the owner confirmed it is ❌ — admin runs the shop but does
    not take money at the counter, the same separation already applied to job payments and
    expenses. Admin **keeps sales reads** (`CAN_SEE_ALL_SALES` includes admin), losing only the
    write. `roles.md` line 129 and its "menu hides more than the system enforces" caveat were
    updated to match. The frontend already gated the Sell page to `["superadmin","staff"]`, so
    no frontend change was needed.
  - **`tests/posTechnicianRoleGuard.test.js`** (new, 11 cases): technician 403 on all 7 routes
    it should not reach; no `Sale` document persisted on a rejected attempt; technician keeps
    `/jobs`, `/my-overview`, `/technicians`; staff/admin/superadmin not 403'd on anything they
    had before; admin **and** technician 403 on `POST /sales` with nothing persisted;
    staff/superadmin pass the gate; admin still reads `/sales` and `/sales/summary`.
  - Verified: 11/11 new, plus 64/64 across the six related suites (`posSale`, `reportsAnalytics`,
    `expensesRoleModel`, `technicianHostingDomainAccess`, `updateJobMoneyGuard`, `activityLog`).
    ESLint 0 errors and **0 new warnings** — `salesController.js` sits at the same 36 pre-existing
    warnings as before the change (confirmed by stashing).
  - **Further owner decisions, 2026-08-29 — staff are the counter, admin manages.** Three more
    surfaces moved to superadmin + admin, enforced server-side and mirrored in the sidebar:
    | Surface | Was | Now | Note |
    |---|---|---|---|
    | `GET /reports/analytics` | superadmin+admin+staff | superadmin+admin | shop-wide BI belongs with `/overview` |
    | `GET /suppliers`, `/suppliers/:id` | superadmin+admin+staff | superadmin+admin | restores what `roles.md` always said — a T105 row, now closed |
    | `GET /warranty` | superadmin+staff | superadmin+admin | was wrong **both** ways; admin had been excluded despite `roles.md` marking it ✅ |
    Staff keep `/my-overview` (their own scoped dashboard), sales, jobs and payments.
    `dashboardNav.js` updated to match, and `roles.md` rows 121/134/140 corrected.
  - **Side effect, recorded in `roles.md`:** the supplier dropdown in the add/edit-stock modal
    now returns empty for staff, so staff can still add stock but cannot attach a supplier to it.
    Worth a product decision if staff are expected to do receiving.
  - **Tests:** 16 in the role-guard file (5 new for the management surfaces), and three
    `reportsAnalytics` cases rewritten — two asserted staff *could* read reports, and the
    double-count regression was re-pointed to an admin caller scoped via `staffId` so the
    aggregation coverage survives. 73/73 across the six role-related suites.

  - **Scope limit — acceptance criterion 1 is only partly met, deliberately.** Criteria 1 ("match
    `roles.md`") and 3 ("staff/admin/superadmin keep their current access") **contradict each
    other**: `roles.md` grants staff and admin *less* than the code does on ~11 further rows.
    Applying the matrix literally would have removed working access for staff and admin. The
    technician column now matches `roles.md` exactly — that is the security hole, and it is
    closed. The remaining divergences are a product question, logged as **T105**.

- [~] **T84 · An account can claim another customer's guest orders via an unverified phone** (audit ref EZ-004)
  - **Issue:** Shop orders are guest checkouts with no `user` ref, so they are matched to an account by
    `customer.email` / `customer.phoneDigits` (`controllers/orderController.js:882-899`, `getMyOrders`).
    `updateProfile` (`controllers/authController.js:571-593`) lets any logged-in user set `phone` to any
    value not already held by another **account** — a victim who checked out as a guest has no account,
    so their number is free — with **no OTP re-verification**.
  - **Impact:** Account takeover of order history: full name, delivery address, phone, items and totals
    of another customer's orders. Read-only, but directly personal data.
  - **Repro:** Register + verify your own account → `PATCH /api/v1/auth/me` with the victim's phone →
    `GET /api/v1/orders/mine` returns their orders.
  - **Expected:** A phone binds to an account only after proving control of it — the SMS PIN flow
    already exists (`services/notify.js`). **Actual:** set freely; order linkage follows immediately.
  - **Fix:** OTP to the new number, bind on confirmation, keep the existing uniqueness check. Consider
    `phoneVerifiedAt` and matching guest orders only against verified contact points.
  - **Location:** `controllers/authController.js:571-593`; `controllers/orderController.js:882-899`
  - **Acceptance:**
    - [ ] Changing a phone number requires an OTP for the new number
    - [ ] Order linkage matches only verified email/phone
    - [ ] Existing customers keep access to their own orders after a change
    - [ ] A test covers the claim attempt and expects no orders returned

  ### Implementation Notes (2026-08-29 — part 1 shipped, part 2 deferred by decision)

  - **Part 1 (done):** `PATCH /auth/me` no longer writes a phone number. It parks it on
    `pendingPhone` with a hashed PIN and a 15-minute expiry, texts the PIN to the **new** number,
    and returns `phoneVerificationRequired`. `POST /auth/me/phone/confirm` binds it and stamps
    `phoneVerifiedAt`. The live `phone` is untouched throughout, so an abandoned change cannot
    orphan an account. Clearing a phone needs no PIN. Uniqueness is re-checked at bind time —
    another account can take the number while a PIN is outstanding.
  - **Why `phoneVerifiedAt` and not `isVerified`:** registration sends its PIN to email **or**
    phone, never both (`authController.js:126-131`). An account registered by email therefore has
    a completely unproven phone, so `isVerified` cannot stand in for phone ownership.
  - **Part 2 (deferred, owner decision 2026-08-29):** restricting guest-order matching to verified
    contact points is **not** being done. Acceptance criteria 2 and 3 contradict each other for
    existing accounts: the data cannot distinguish a legitimately owned number from one already
    claimed under the old behaviour, so enforcing #2 would cut real customers off from their own
    order history. Decision: **leave matching as it is** — the vector is closed for every future
    change, and nothing changes for existing customers.
  - **Residual risk, accepted:** any number claimed *before* today stays claimed. Closing that
    needs the re-verification campaign in the deferred options, not a code change.
  - Tests: 10 new in `tests/phoneChangeOtp.test.js` — the claimed number never reaches the
    database, the PIN goes to the new number rather than the account's current one, expiry, wrong
    PIN, no-pending-change, and the bind-time uniqueness race. The T47 uniqueness test was updated:
    it asserted the phone applied immediately, which is the behaviour this replaces.
  - Acceptance: #1 ✅ · #2 deferred by decision · #3 ✅ (unchanged for existing customers) · #4
    ✅ for the claim attempt at the profile layer; the order-linkage half goes with #2.

- [ ] **T85 · `NODE_ENV` is not guaranteed in production — two security controls switch off together** (audit ref EZ-005)
  - **Issue:** `ecosystem.config.js:11-14` defines `NODE_ENV` only under `env_production`, which PM2
    applies **only** with `--env production`. Started any other way it is unset and `PROD` is false.
  - **Impact:** The auth cookie loses `Secure` and drops `sameSite` from `strict` to `lax`
    (`controllers/authController.js:44`), **and** the error handler starts returning `err.stack` to
    clients on every error (`middleware/errorHandler.js:1,70`). Both silently, together.
  - **Repro:** `pm2 start ecosystem.config.js` (no `--env`), trigger any handled error, observe a
    `stack` field in the JSON; inspect the login cookie for a missing `Secure` flag.
  - **Fix:** Put `NODE_ENV: "production"` in the default `env` block too, and have `validateEnv.js`
    refuse to boot (or log loudly) when `NODE_ENV` is unset on a non-local host. Document the command.
  - **Location:** `ecosystem.config.js:11-14` (repo root); `controllers/authController.js:44`;
    `middleware/errorHandler.js:1,70`
  - **Acceptance:**
    - [ ] Starting with or without `--env production` yields `NODE_ENV=production`
    - [ ] No stack traces in production API responses
    - [ ] Auth cookies carry `Secure` and `SameSite=Strict`
    - [ ] Startup fails loudly if the environment is ambiguous

- [x] **T86 · Public order-by-reference endpoint returns full customer PII** (audit ref EZ-007)
  - **Issue:** `GET /api/v1/orders/by-reference/:reference` needs no auth (`routes/orderRoutes.js:33`)
    and returns the **entire order document** (`controllers/orderController.js:670`) — name, phone,
    email, full delivery address, line items, totals. The sibling public endpoint `getOrderTracking`
    deliberately redacts the same fields (`address: null, // live address lookup is admin-only`).
  - **Impact:** Anyone holding a reference — shared confirmation link, forwarded email, browser
    history, referrer header — reads the customer's full personal and delivery details. References are
    `ORD_${Date.now()}_${randomBytes(4)}` (~32 bits + timestamp), so mass enumeration is impractical
    under the 150/15min limiter; the realistic exposure is link leakage. Hence P1, not P0.
  - **Expected:** Only what the confirmation page needs — status, order number, totals, masked contact.
  - **Fix:** Explicit response projection mirroring `getOrderTracking`. Leave the server-side Paystack
    verification behaviour on this route unchanged.
  - **Location:** `routes/orderRoutes.js:33`; `controllers/orderController.js:638-672`
  - **Acceptance:**
    - [ ] Response carries no full address, phone or email
    - [ ] The order-confirmation page still renders
    - [ ] Payment verification on this route still works
    - [x] A test asserts the redaction

  ### Implementation Notes (2026-08-29)

  - Response is now an explicit projection (`publicOrderView`), not the order document: no email
    and no street address at all, name masked to "Ama O.", phone to the last three digits, and
    only the area-level shipping fields `getOrderTracking` already exposes publicly.
  - Order number, status, totals, line items and tracking number are unchanged, so the
    confirmation page still answers "is this mine, and did it go through". Paystack verification
    on this route is untouched.
  - Frontend: the confirmation page keyed off `customer.address`, which no longer arrives, so the
    delivery card would have stopped rendering. It now keys off the shipping fields and links to
    the customer's own orders page — behind login — for the full address.
  - Tests: 7. One scans the whole serialized body for each PII string rather than checking named
    fields, since a projection that misses a nested copy is still a leak.

- [x] **T87 · Unbounded `limit` on list endpoints — heap exhaustion on a 512 MB process** (audit ref EZ-008)
  - **Issue:** `Number(limit)` straight from the query into `.limit()` with no upper bound:
    `controllers/pos/expenseController.js:20`, `pos/inventoryController.js:33`,
    `pos/customerController.js:92`, `pos/jobController.js:264`, `routes/adminRoutes.js:19`.
  - **Impact:** Any authenticated staff/admin session can request `?limit=1000000` and hydrate a whole
    collection into memory, exhausting the heap and taking the API down for everyone.
  - **Repro:** As staff, `GET /api/v1/pos/inventory?limit=1000000`; watch process memory.
  - **Fix:** Apply the clamp `productController.getProducts:23-27` already uses
    (`Math.min(Math.max(parseInt(limit,10) || DEFAULT, 1), MAX)`), ideally via a shared pagination
    helper so new endpoints inherit it.
  - **Location:** the five files above
  - **Acceptance:**
    - [ ] Every list endpoint clamps `page` and `limit`
    - [ ] An oversized `limit` returns the maximum page size — not an error, not the whole collection
    - [ ] Normal values behave exactly as before
    - [x] A test asserts the clamp on at least one endpoint

  ### Implementation Notes (2026-08-29)

  - **`utils/pagination.js`** — one `paginate(query, { defaultLimit, maxLimit })` returning
    `{ page, limit, skip }`, so a new endpoint inherits the bound instead of remembering it. The
    expression matches the one `productController.getProducts` already used, including
    `?limit=-5 → 1` (a negative parses truthy, so it clamps rather than defaulting).
  - **All five converted**, each keeping its previous default so ordinary requests are unchanged:
    expenses 30 · inventory 50 · customers 30 · jobs 20 · admin email logs 50. Max is 100.
  - **Swept the rest rather than trusting the list:** every other `.limit()` fed from a variable
    already clamped — `activityLog`, `notifications`, `orders` (×2), `serviceOrders`, `shipments`,
    `productReviews`, `hostingOrders`, `sales`, `adminNeighborhood`. `grep -rn "\.limit(Number(\|
    \.limit(parseInt"` over `controllers routes services` now returns nothing.
  - **Oversized values clamp, they do not error** — a caller asking for too much gets the maximum
    page, which is what a paginated API should do. Junk (`?limit=abc`) falls back to the default
    rather than producing `NaN`, which Mongoose passes through as *no limit at all* — the very
    bug being fixed.
  - Tests: 9 — six on the helper (defaults, hostile limit, junk, page floor, skip computed from
    clamped values, ordinary values untouched) and three end-to-end on `/pos/inventory`: 120 seeded
    products with `?limit=1000000` returns 100 rows while still reporting `total: 120`.

---

## P2 — Improvements

- [ ] **T88 · `protect` never checks `isVerified`** (audit ref EZ-009)
  - **Issue:** `middleware/auth.js:21-30` checks the token, that the user exists, and `isBlocked` — but
    not `isVerified`. An account that registered and never confirmed its emailed PIN reaches every
    customer endpoint.
  - **Impact:** Unverified accounts transact and read data; it also makes **T84** cheaper to execute,
    since the attacker needs no working email.
  - **Fix:** Check in `protect` with an explicit allow-list for `verify-pin` / `resend-pin`. Confirm no
    staff-created accounts depend on the current behaviour before enabling.
  - **Location:** `middleware/auth.js:21-30`
  - **Acceptance:**
    - [ ] Unverified users are refused with a distinguishable error
    - [ ] Verification/resend endpoints stay reachable
    - [ ] Internally created staff/admin accounts are unaffected
    - [ ] Tests cover verified and unverified access

- [ ] **T89 · Paid orders can silently under-fulfil** (audit ref EZ-010)
  - **Issue:** `utils/fulfilShopOrder.js` decrements stock per line under an atomic guard; when the
    guard fails (insufficient stock) it **logs and continues** by design. The order is already `paid`
    and nothing records that a line went unfulfilled.
  - **Impact:** The customer is charged for an item that cannot ship. No flag, no notification, the
    order looks normal in the dashboard — it surfaces only as a complaint.
  - **Repro:** Drive stock to 0 between checkout and webhook delivery, then deliver `charge.success`.
  - **Fix:** Record failed lines on the order (e.g. `fulfilmentIssues[]`), notify staff via the existing
    `notifyRoles` path, surface it on the order detail page. **Do not make it throw** — the payment has
    landed and must not be undone.
  - **Location:** `utils/fulfilShopOrder.js` (stock-decrement loop, ~:131 onward)
  - **Acceptance:**
    - [ ] Under-fulfilled lines are persisted on the order
    - [ ] Staff receive a notification
    - [ ] The dashboard shows the shortfall
    - [ ] Fulfilment still succeeds and stays idempotent
    - [ ] A test covers the insufficient-stock path

- [x] **T90 · Webhook accepts any amount when no expected amount is known** (audit ref EZ-011)
  - **Issue:** `amountMismatch()` returns `false` — "no mismatch" — whenever `expectedPesewas` is not a
    finite number > 0 (`controllers/webhookController.js:86-90`). A deliberate escape hatch for legacy
    orders written before the `*Pesewas` fields existed.
  - **Impact:** Any hosting/domain order whose expected amount is unset or zero is fulfilled for **any**
    charged amount, including 1 pesewa. The shop path is unaffected — `fulfilShopOrder` throws instead.
  - **Fix:** Read-only count first to see whether any live order still lacks the field. If none, invert
    the default to reject; if some exist, backfill then invert. Route unvalidatable charges to a manual
    review queue rather than dropping them.
  - **Location:** `controllers/webhookController.js:86-90`
  - **Acceptance:**
    - [ ] A charge with no verifiable expected amount does not auto-fulfil
    - [ ] Legacy orders are backfilled or explicitly handled
    - [ ] Operators can see charges held for review
    - [x] `tests/webhookE2E.test.js` still passes; a case covers the missing-amount path

  ### Implementation Notes (2026-08-29)

  - **Counted first, as the task asked.** Against the live database: `hostingorders`,
    `domainorders`, `serviceorders`, `partorders` and `repairorders` are **all empty (0 documents)**.
    The escape hatch protected nothing, so no backfill was needed and the default is simply inverted.
  - `amountMismatch()` now returns a **reason string or null** instead of a boolean:
    `amount_unverifiable`, `amount_mismatch`, `currency_mismatch`. An unverifiable expected amount
    refuses the charge where it previously fulfilled it — for any amount, including 1 pesewa.
  - **The operator surface is the existing activity log**, not a new queue: the six call sites
    already wrote a `PAYMENT_FAILED` entry with `status: 'failure'`, visible at
    `/dashboard/activity-logs`. They now log the real reason, and the console line and description
    say it too — they previously read "amount mismatch" whatever the cause, which would have made a
    held charge look like a wrong one. The 400 body carries `reason` as well.
  - **Money is still taken.** Refusing to fulfil does not refund; that is what the log entry is
    for. Paystack retries on a 400, so a held charge stays visible rather than disappearing.
  - Tests: 5 — unverifiable refused with the order left `pending`, the activity-log entry recorded
    with its reason, a genuine mismatch still distinguished, a non-GHS charge for the right amount
    rejected, and a correctly priced charge passing the gate.

- [ ] **T91 · No session invalidation on logout or password change** (audit ref EZ-012)
  - **Issue:** Logout clears the cookie (`controllers/authController.js:333`) and nothing else. No token
    version, deny-list, or `passwordChangedAt` comparison in `protect`, so a JWT stays valid until it
    expires regardless of what the user does.
  - **Impact:** A stolen token survives both logout **and** a password change — the two actions a user
    takes precisely when they believe they are cutting off an intruder.
  - **Repro:** Capture the cookie, log out (or change the password), reuse the captured token. It works.
  - **Fix:** Cheapest correct option — store `passwordChangedAt` (or a `tokenVersion` int) on the user,
    put the claim in the JWT, compare in `protect`. A deny-list is only needed for immediate
    single-session logout.
  - **Location:** `controllers/authController.js:333`, `changePassword` (~:598); `middleware/auth.js:21-30`
  - **Acceptance:**
    - [ ] Tokens issued before a password change are rejected
    - [ ] Logout invalidates the token server-side
    - [ ] Normal sessions are unaffected
    - [ ] Tests cover reuse after logout and after a password change

- [ ] **T92 · Missing authorization + pagination tests** (audit ref EZ-015)
  - **Issue:** 927 tests pass, but none assert the controls behind T83, T84, T86, T87 or T88.
    `tests/posSale.test.js` and `salesScoping.test.js` cover mechanics, not authorization; `grep -rn
    "technician" tests/` finds no case asserting a technician is refused a sale.
  - **Impact:** Those fixes can regress silently, and the suite's green status implies more
    authorization coverage than exists. This coverage gap is why the defects survived.
  - **Fix:** Add — technician refused on POS sales/customers/inventory; phone-change claim returns no
    foreign orders; `by-reference` carries no address/phone/email; unverified user refused by `protect`;
    oversized `limit` clamped.
  - **Location:** `tests/` (new cases)
  - **Acceptance:**
    - [ ] One negative test per control above
    - [ ] Each fails against today's code and passes after the corresponding fix
    - [ ] Full suite still passes
    - [ ] Tests name the role/actor explicitly so intent is readable

- [ ] **T93 · Unescaped user input into `$regex` (admin email-log search)** (audit ref EZ-016)
  - **Issue:** `filter.to = { $regex: q.trim(), $options: 'i' }` (`routes/adminRoutes.js:17`) passes the
    query string straight into a regular expression. `escapeRegex` already exists (`utils/regex.js`) and
    is used correctly at `controllers/productController.js:49`.
  - **Impact:** A catastrophic-backtracking pattern stalls the event loop. Admin-authenticated, so
    self-inflicted rather than an outsider attack — hence low priority, but a one-line fix.
  - **Repro:** As admin, `GET /api/v1/admin/email-logs?q=(a%2B)%2B%24` against a large collection.
  - **Fix:** `escapeRegex(q.trim())`.
  - **Location:** `routes/adminRoutes.js:17`
  - **Acceptance:**
    - [ ] Search input is escaped
    - [ ] Literal regex characters return literal matches
    - [ ] Existing email-log search still works

- [x] **T94 · Webhook signature compared with `!==` rather than a constant-time check** (audit ref EZ-017)
  - **Issue:** `controllers/webhookController.js:104-113` compares the computed HMAC with `!==`, which
    short-circuits on the first differing byte.
  - **Impact:** Theoretical timing side channel. Exploiting it remotely against SHA-512 HMAC over the
    internet is close to impractical — this is hygiene, listed for completeness, not an active hole.
  - **Fix:** `crypto.timingSafeEqual` on Buffers, guarding unequal lengths first (it throws otherwise)
    and keeping the current rejection for a missing header.
  - **Location:** `controllers/webhookController.js:104-113`
  - **Acceptance:**
    - [ ] Comparison is constant-time
    - [ ] Missing/malformed signatures still rejected with 400
    - [x] `tests/webhookE2E.test.js` passes unchanged

  ### Implementation Notes (2026-08-29)

  - `signatureMatches()` uses `crypto.timingSafeEqual` on UTF-8 buffers. It guards length first —
    `timingSafeEqual` throws on unequal lengths, so a short header would have produced a 500
    instead of a 400. The length of a hex SHA-512 digest is public, so that guard leaks nothing.
  - A missing or non-string header returns false rather than reaching the comparison.
  - Tests: 5 — missing header, wrong signature of the correct length (so it reaches
    `timingSafeEqual` rather than the length guard), wrong length, a signature differing only in
    the final byte, and a correctly signed body passing the gate.

- [ ] **T95 · No TLS hardening or HSTS at the proxy** (audit ref EZ-019)
  - **Issue:** The TLS server block sets only certificate paths — no `ssl_protocols`, no cipher config,
    no `Strict-Transport-Security`, no OCSP stapling. Helmet sets application headers, but HSTS belongs
    at the edge that terminates TLS.
  - **Impact:** Falls back to distribution defaults, which may permit older protocol versions; without
    HSTS the first plaintext request of each visit is downgrade-attackable.
  - **Fix:** `ssl_protocols TLSv1.2 TLSv1.3;`, a modern cipher list, and
    `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`. Introduce
    HSTS with a **short** max-age first and extend only once HTTPS is stable on every subdomain.
  - **Location:** `nginx.conf:7-12` (repo root)
  - **Acceptance:**
    - [ ] TLS 1.2+ only
    - [ ] HSTS present on HTTPS responses
    - [ ] `nginx -t` passes and the site still serves
    - [ ] No mixed-content or subdomain breakage

- [ ] **T96 · Background jobs would double-run if the API is ever scaled out** (audit ref EZ-020)
  - **Issue:** Renewal, reminder, scheduled-publish and refund-reconcile run via in-process
    `setInterval` (`server.js:105-141`). Correct at `instances: 1` (`ecosystem.config.js:8`) and wrong
    the moment the API scales — nothing elects a leader.
  - **Impact:** In cluster mode every instance runs every job: duplicate renewal charges, duplicate
    reminder emails, duplicate publishes. It appears only after a scaling change, when least expected.
  - **Fix:** Either document `instances: 1` as a hard constraint with a comment in
    `ecosystem.config.js`, or add a lock (a Mongo doc with a TTL and an atomic claim).
  - **Location:** `server.js:105-141`; `ecosystem.config.js:8` (repo root)
  - **Acceptance:**
    - [ ] Jobs run once per interval with >1 instance, or the single-instance constraint is documented
          and enforced
    - [ ] No duplicate renewal charges or reminder emails
    - [ ] Job behaviour unchanged at one instance

---

## Missing Features (new work — ⚪ in the audit)

Not defects; product features that don't exist yet. Scope separately before building.

- [ ] **T80 · E2 Shipping Expansion: Region/City/Neighborhood + Bus-Station Pickup + Distance Pricing**
  - **Scope:** Full expansion of T78 shipping system per `docs/shipping-expansion-plan.md`
  - **Business Rules:**
    - Warehouse: Nima, Greater Accra (configurable)
    - Greater Accra: home delivery (distance + weight formula)
    - Outside Greater Accra: bus-station pickup (region + weight formula)
    - Same-day cutoff: 12 PM, Mon-Sat only
    - Backend is final authority for all shipping fees
  - **Sub-tasks (execute in order):**
    - [x] T80a · Database: `src/seedLocations.js` — seed all 16 Ghana regions, cities, Accra/Tema neighborhoods
    - [x] T80b · Database: `src/seedShipping.js` — add Nima warehouse (PickupLocation), regional zones with `inAccraCore: false`, `pickupMode: 'bus_station'`, E2 pricing fields
    - [x] T80c · Model: `models/Order.js` — add `pickupLocationId`, `pickupLocationName`, `readyForPickupAt`, `pickedUpAt`
    - [x] T80d · Calculator: `services/shipping/shippingCalculator.js` — add same-day 12 PM cutoff, Mon-Sat delivery check, Sunday handling
    - [x] T80e · Controller: `controllers/shippingController.js` — extend `buildCartHash` to include `region` + `pickupLocationId`
    - [x] T80f · Controller: `controllers/orderController.js` — accept `region`/`pickupLocationId`, store on Order, validate fulfillment gating
    - [x] T80g · API: Create `controllers/adminLocationController.js` + `routes/adminLocationRoutes.js` — Location CRUD
    - [x] T80h · API: Create `controllers/adminPickupController.js` + `routes/adminPickupRoutes.js` — PickupLocation CRUD
    - [x] T80i · API: Mount new admin routes in `app.js`
    - [x] T80j · Frontend: `src/app/checkout/page.jsx` — replace hardcoded city enum with region→city→neighborhood cascade from `/api/v1/locations`; add pickup location selector for `bus_station_pickup`; send `region`/`pickupLocationId` to quote
    - [x] T80k · Frontend: `src/app/track/order/[trackingNumber]/page.jsx` — show pickup panel when `shippingMethod === 'bus_station_pickup'`
    - [x] T80l · Frontend: `src/app/order-confirmation/[reference]/page.jsx` — show pickup info when applicable
    - [x] T80m · Frontend: `src/hooks/queries/useShippingAdmin.js` — add `useLocations`, `usePickups` hooks + queryKeys
    - [ ] T80n · Tests: `tests/shippingCalculator.test.js` — same-day cutoff, Mon-Sat, distance formula, regional formula, fulfillment gating
    - [ ] T80o · Tests: `tests/shippingCheckout.test.js` — quote→order with `region`/`pickupLocationId`, cartHash includes new params
    - [ ] T80p · Tests: `tests/locationEndpoints.test.js` — region/city/neighborhood + pickup CRUD + gating
    - [ ] T80q · Tests: `tests/shippingPickupFulfilment.test.js` — ready-for-pickup → delivered flow
    - [ ] T80r · Docs: Update `docs/shipping.md` with E2 architecture
  - **Verification:** All shipping tests pass (`npx jest tests/shipping* tests/locationEndpoints*`), frontend lint/build clean, manual checkout test for Greater Accra delivery + regional pickup

---

## Final production re-audit (2026-08-29) — new findings

- [x] **T128 · APPLIED 2026-08-29 — deleted confirmed-dead backend code**
  - > **To run this task, say: "apply T128".** Nothing here is done yet. Everything below has been
    > verified as unused; the work is only the deletion, in the order given, with tests in between.
    > Roughly 110 lines and 2 packages. Reversible — it is all in git history.
  - **What gets deleted, in one sentence each:**
    1. Two email packages (`@react-email/*`) that no code imports — email is built by hand instead.
    2. `services/cyberpanel.js` — the old hosting-panel tool, replaced by WHM, wired to nothing.
    3. The three `CYBERPANEL_*` secrets, which only that file read.
    4. Two lines in the docs that wrongly say react-email is in use.
  - **What is deliberately NOT deleted:** `services/namecheap.js`. It looks unused but it is the
    fallback if Spaceship fails, and Spaceship has never been tested with a real purchase. See T130.
  - **Full evidence:** `docs/DEAD-CODE-REPORT.md`. Audit branch `chore/dead-code-audit`.
  - **Fix — do these, in this order, each as its own commit with lint + tests between:**
    - [x] **1. Drop `@react-email/components` and `@react-email/render`** from `package.json`
      (both **prod**), then `npm install`. Zero code references: all transactional email is
      hand-written HTML template literals through Resend (`utils/email.js` uses `html:` strings),
      and the backend contains no `.jsx`/`.tsx` files at all.
    - [x] **2. Delete `services/cyberpanel.js`** (103 lines). `grep -rln cyberpanel` matches only the
      file itself. `utils/provisionHosting.js` requires `services/whm` alone, and when
      `whm.hasConfig()` is false it routes to the manual queue — there is no CyberPanel fallback.
    - [~] **3. Retire the `CYBERPANEL_HOST` / `CYBERPANEL_PASS` / `CYBERPANEL_USER` secrets**
      wherever they are set, once step 2 lands. They are read by nothing else.
    - [x] **4. Correct the docs.** `docs/monorepo-CLAUDE.md` and `docs/all-features.md` both state
      react-email is in use. They are wrong and will mislead the next reader.
  - **Do NOT delete in this task:** `services/namecheap.js` (491 lines) or `xml2js`. See T130.
  - **Acceptance:**
    - [x] `npm audit` 0 vulnerabilities; eslint 0 errors; targeted suites pass after each batch
    - [x] `grep -rli "react-email"` returns only the lockfile and dated audit documents
    - [x] `grep -rln cyberpanel` returns nothing outside dated audit documents
    - [x] No behaviour change: email modules load, 51/51 email + notification tests, 44/44 hosting
    - [~] Step 3 is the only part left: `CYBERPANEL_*` is not in the local `.env`, so nothing could
          be removed here — retire it from any deployment environment that still sets it.
  - **Applied in three commits on `chore/dead-code-phase-b`.** Note `docs/code_review.md:316` had
    already flagged the two react-email packages as unused on **2026-07-16** — six weeks before this.

- [ ] **T130 · Decide the fate of `services/namecheap.js` — blocked on T3** (dead-code audit 2026-08-29)
  - **Issue:** `services/namecheap.js` (491 lines) is orphaned — nothing requires it — and `xml2js`
    is a prod dependency required by that file alone. It looks like an obvious deletion.
  - **Why it is NOT being deleted:** its own header states it is retained as the rollback path off
    Spaceship, and **T3 records that the Spaceship live registration round-trip has never been
    verified**. Spaceship has no sandbox, so every real registration spends money and the rollback
    still carries value. Deleting it now would remove the only fallback for an unproven integration.
  - **Also recorded in that header:** its price table sells `.com` below cost and lists TLDs that
    cannot be sold. If the rollback is ever taken, it must be repriced first — do not simply re-wire it.
  - **Fix:** revisit once T3 closes successfully. Then delete the file and drop `xml2js` together.
  - **Acceptance:**
    - [ ] T3 closed with a verified live Spaceship registration
    - [ ] `services/namecheap.js` deleted and `xml2js` removed from `package.json`
    - [ ] Comments in `config/domainPricing.js`, `utils/domainHelper.js` and `services/spaceship.js`
          that reference the retired file updated so they do not point at something gone

- [x] **T131 · APPLIED 2026-08-30 — all 16 `scripts/*.js` registered and documented** (dead-code audit 2026-08-29)
  - **Issue:** `scripts/` holds 16 files; only 9 are registered in `package.json`. Unregistered:
    `mergeCashierToStaff`, `mergeCustomerDuplicates`, `normalizePhones`, `resanitizePostContent`,
    `seedRoleAccounts`, `setUserAdmin`, `verifyUser`.
  - **Why this is not "dead code":** they are one-off ops and migration scripts run manually as
    `node scripts/x.js`. Absence from `package.json` is a discoverability gap, not death. Note
    `normalizePhones.js` is **not** a duplicate of `normalizeUserPhones.js` — the first targets the
    `poscustomers` collection, the second targets `users`.
  - **Fix:** give each a named npm script (the `migrate:` / `check:` convention is already there), or
    move genuinely spent one-offs into `scripts/archive/` with a dated note. Deleting them loses
    re-runnable recovery tooling.
  - **Acceptance:**
    - [x] Every file in `scripts/` is either registered in `package.json` or archived with a reason
    - [x] Each retained script's header states whether it is idempotent

  ### Implementation Notes (2026-08-30 — commit `871ddb7`)

  Nothing archived — all seven are re-runnable ops tooling, so all seven were registered,
  following the existing `migrate:`/`check:`/`seed:` convention. 16/16 now reachable by name:

  | npm script | file |
  |---|---|
  | `migrate:cashier-to-staff` | `mergeCashierToStaff.js` |
  | `migrate:merge-customers` | `mergeCustomerDuplicates.js` |
  | `migrate:pos-customer-phones` | `normalizePhones.js` |
  | `migrate:resanitize-posts` | `resanitizePostContent.js` |
  | `seed:role-accounts` | `seedRoleAccounts.js` |
  | `user:set-role` | `setUserAdmin.js` — args after `--` |
  | `user:verify` | `verifyUser.js` — args after `--` |

  Two headers needed more than a usage line:

  - **`normalizePhones.js` had no header at all.** It now carries the point the audit flagged —
    it is *not* a duplicate of `normalizeUserPhones.js` (`poscustomers` vs `users`). Without
    that line, the next person tidying up deletes it.
  - **`mergeCustomerDuplicates.js` is idempotent on re-run but destructive on the first**: it
    deletes newer duplicate `PosCustomer`s after re-pointing their `RepairJob`s. Header now says
    so and says to back up first.

  **`seedRoleAccounts.js` needed a guard, not just a name.** It writes five hard-coded,
  publicly-known passwords, creates each account **pre-verified**, prints the credentials to
  stdout, and targets whatever `MONGO_URL` points at. Giving that a one-word npm command lowers
  the bar to running it against production, so it now refuses when `NODE_ENV=production` unless
  `SEED_ROLE_ACCOUNTS_FORCE=1`. Verified it exits 1 **before** opening a database connection.
  (Scope note: the guard is slightly beyond "register or retire" — added because this task makes
  the script easier to run, and it seemed wrong to do that without it.)

  Verified: all 16 pass `node --check`, `app.js` loads, eslint 0 errors.

- [x] **T132 · APPLIED 2026-08-30 — `.env.example` now covers all 59 variables** (dead-code audit 2026-08-29)
  - **Issue:** backend code reads 58 distinct `process.env.*` names; 16 appear in no `.env` and in no
    example file: `ANTHROPIC_API_KEY`, `COOKIE_SECRET`, `CYBERPANEL_HOST/PASS/USER`,
    `HOSTING_GRACE_DAYS`, `HOSTING_NAMESERVERS`, `HOSTING_SUSPEND_TO_TERMINATE_DAYS`, `LOG_LEVEL`,
    `MONGO_URI`, `NODE_OPTIONS`, `REFUND_RECONCILE_AFTER_MINUTES`, `WAREHOUSE_ADDRESS/LAT/LNG`,
    `WHM_PACKAGE_PREFIX`.
  - **Impact:** most have code-side defaults, so absence is deliberate — but nobody deploying can
    tell which are optional without reading the source. This matters for the VPS deploy.
  - **Fix:** add a `.env.example` listing all 58 with required/optional and a one-line purpose. The
    `CYBERPANEL_*` three should disappear with T128 rather than be documented.
  - **Acceptance:**
    - [x] `.env.example` exists and covers every variable the code reads
    - [x] Required vs optional is stated for each, matching `utils/validateEnv.js`

  ### Implementation Notes (2026-08-30 — commit `8db9ab6`)

  Re-counted from source rather than trusting the task: the backend reads **59** distinct
  `process.env` names (58 plus the new `SEED_ROLE_ACCOUNTS_FORCE` from T131). All 59 documented,
  tiered to match `utils/validateEnv.js` exactly:

  - **REQUIRED** (validateEnv `process.exit(1)`s): `MONGO_URL`, `DATABASE_PASSWORD` *when the URL
    contains `<PASSWORD>`*, `JWT_SECRET` with its 32-character floor, and `PAYSTACK_SECRET`
    *in production only* — it merely warns in development.
  - **RECOMMENDED** (validateEnv warns): the six in its `recommendedVars` array.
  - **OPTIONAL**: each annotated with the actual `[default: …]` read out of the code.

  Cross-references embedded in the file so a deployer meets them at the point of use: `T119`
  (`FRONTEND_URL` degrades to `""` rather than failing fast), `T85` (`NODE_ENV` must really be
  set or the Secure cookie *and* stack-trace suppression both switch off), `T96` (in-process jobs
  double-run if scaled out), and the note that `tests/setup.js` blanks the Spaceship keys on
  purpose because Spaceship has no sandbox.

  - The four `NAMECHEAP_*` names are documented as **retired-but-still-read**, tied to the
    `services/namecheap.js` rollback path held under **T130**, so they are not mistaken for live
    config. They are deleted together when T130 closes.
  - `CYBERPANEL_*` is **absent**, which is what this task asked for — T128 deleted the only file
    that read it, so there was nothing left to document.

  Verified both directions mechanically: every one of the 59 names appears in the file, and no
  name in the file is unread by the code. Also confirmed no real value leaked out of the local
  `.env` — the only keys sharing a value are non-secret defaults documented as defaults (`PORT`,
  `NODE_ENV`, `HOST`, `JWT_EXPIRES_IN`, `WHM_USER`). `app.js` loads, eslint 0 errors, 66/66
  email + notification + hosting tests pass.


- [ ] **T125 · Guest-checkout customer fields have no length cap and no email-format validation** (input-sanitisation sweep 2026-08-29) — **CONFIRMED**
  - **Issue:** `Order.customer` (`models/Order.js:197-203`) declares `name`, `phone`, `phoneDigits`,
    `email` and `address` as `String` with `trim` and, for two of them, `required` — but **no
    `maxlength` on any field and no email format validator**. `createOrder` applies `.trim()`,
    `normalizePhone()` and a lowercase on email (`controllers/orderController.js:453-457`) and
    nothing else — no `sanitizeName`/`sanitizeText`, though both exist in `utils/sanitize.js`.
  - **Impact:** two concrete consequences, neither of them XSS (see below).
    1. **Unbounded storage.** A guest can submit a `customer.address` limited only by
       `express.json({ limit: '5mb' })` and it is stored verbatim. On a 512 MB heap, a handful of
       such orders in one list query is a memory problem, and `getOrders` renders them to admins.
    2. **Malformed email accepted.** `"not-an-email"` passes. Order confirmations and invoices are
       sent through Resend, so a bad address becomes a silent delivery failure on a paid order.
  - **Explicitly NOT an XSS hole.** `app.js:90` runs `xss-clean` globally and it traverses nested
    objects — verified directly: `{ customer: { name: '<script>alert(1)</script>Ama' } }` comes out
    as `&lt;script>alert(1)&lt;/script>Ama`. Stored XSS is mitigated at the edge.
  - **Repro:** `POST /api/v1/orders` with a 100 000-character `customer.address` and
    `customer.email: "nope"`; both persist.
  - **Fix:** add `maxlength` to the `Order.customer` subdocument and a format check on `email`
    (`validation/` already has Zod schemas — `orderSchema` would be the consistent home), or call the
    existing `sanitizeName`/`sanitizeText`/`sanitizeEmail` helpers in `createOrder`.
  - **Location:** `models/Order.js:197-203`; `controllers/orderController.js:453-457`

- [ ] **T126 · Input validation is inconsistent: 5 Zod `validate()` uses across ~119 write endpoints** (input-sanitisation sweep 2026-08-29) — **CONFIRMED**
  - **Issue:** counted every `router.post|patch|put|delete` against every `validate(` in `routes/`:
    **~119 write endpoints, 5 uses of the Zod middleware** — 2 in `addressRoutes.js`, 2 in
    `shippingRoutes.js`, 1 in `authRoutes.js`. Ten controllers read `req.body` with **zero** calls to
    any sanitiser or parser: `adminLocationController`, `adminNeighborhoodController`,
    `adminPickupController`, `adminShippingController`, `cartController`, `deliveryZoneController`,
    `orderController`, `productController`, `shippingController`, `webhookController`.
  - **Impact:** varies sharply by endpoint, so this is a consistency finding rather than one hole.
    Most of the ten are admin/staff-gated behind strict Mongoose schemas, which drop unknown keys —
    low risk. The customer-reachable ones are `orderController` (see T125), `cartController` and
    `shippingController`. `webhookController` is signature-verified, so its body is trusted by design.
    The real cost is that **`xss-clean` is doing nearly all the work alone**, and it is an
    unmaintained package — if it ever stops behaving, there is no second layer on most endpoints.
  - **Repro:** `for f in routes/*.js; do echo "$f $(grep -cE 'router\.(post|patch|put|delete)' $f) $(grep -c 'validate(' $f)"; done`
  - **Fix:** apply the existing `validation/` Zod schemas to the customer-reachable write endpoints
    first (orders, cart, shipping quote, reviews, contact), then admin ones as they are touched.
    `middleware`-level `validate()` already exists and is wired — this is coverage, not new machinery.
  - **Note:** 20 of 40 models declare no `maxlength` on any string field, which is the same gap at
    the schema layer.
  - **Location:** `routes/*.js`; the ten controllers listed above; `validation/`

- [x] **T118 · APPLIED 2026-08-30 — `webhook.test.js` brought onto T90's reason-string contract** (final re-audit 2026-08-29) — **CONFIRMED**
  - **Issue:** T90 changed `amountMismatch()` from returning a boolean to returning a reason string
    (`amount_unverifiable` / `amount_mismatch` / `currency_mismatch`) or `null`.
    `tests/webhook.test.js` still asserts `.toBe(false)` and `.toBe(true)`, so 4 cases fail on type.
    One of them — "does not block when no reliable expected amount is available" — asserts the
    *pre-T90* behaviour that T90 deliberately inverted, so it is not merely stale: it encodes the
    vulnerability as the expected outcome.
  - **Impact:** backend `main` currently fails its own suite. The T90 change itself is correct and
    covered by `tests/webhookHardening.test.js`; this is the older unit test never being updated.
  - **How it was missed:** `webhookE2E.test.js` and `webhookHardening.test.js` were run after the
    change; `webhook.test.js` — the unit test for the exact function edited — was not.
  - **Repro:** `npx jest tests/webhook.test.js --runInBand`
  - **Fix:** update the three assertions to the reason contract (`toBeNull()` /
    `toBe('amount_mismatch')` / `toBe('currency_mismatch')`), and invert the fourth to assert
    `amount_unverifiable`. Do not revert the controller.
  - **Location:** `tests/webhook.test.js:10-27`; `controllers/webhookController.js` `amountMismatch`

  ### Implementation Notes (2026-08-30 — commit `588638b`)

  Reproduced first: 4/4 red, failing on type as described. **The controller was not touched** —
  T90's behaviour is correct and is separately covered at the HTTP level by
  `webhookHardening.test.js`; this was the unit test catching up.

  Three assertions were merely stale. **The fourth was wrong, not stale.** "does not block when
  no reliable expected amount is available" asserted the pre-T90 escape hatch — a missing or zero
  expected amount let an order fulfil for *any* charged amount, including 1 pesewa. It encoded
  the vulnerability as the expected outcome, so it would have failed against correct code
  forever. Inverted to `amount_unverifiable`, with a comment recording why it flipped.

  Widened slightly while in there, since the reason string is what an operator triages on:
  `undefined` and negative expected amounts; the precedence rule (amount is checked **before**
  currency, so a charge wrong on both reports `amount_mismatch`); and a missing `currency` field
  being acceptable when the amount is right.

  **Verified by mutation, not by the tests merely passing** — a test written against an
  implementation proves nothing until it fails against a broken one:

  | Mutation applied to `amountMismatch` | Result |
  |---|---|
  | Restore the pre-T90 hatch (`return null` when unverifiable) | fails exactly the `amount_unverifiable` case |
  | Swap the amount and currency checks | fails exactly the precedence case |

  Controller restored byte-identical to `HEAD` afterwards; `git status` showed only the test file
  modified. 26/26 across all three webhook suites, 4/4 `paidPartFulfilment`, lint clean.

  **Note:** `npx jest tests/webhook` still prints "Jest did not exit one second after the test
  run has completed" — an open-handle warning that predates this change and belongs to **T120**,
  not here.

- [ ] **T119 · `FRONTEND_URL` fails silently on the BACKEND — T97 only fixed the frontend** (final re-audit 2026-08-29) — **CONFIRMED**
  - **Issue:** `utils/frontendUrl.js` returns `process.env.FRONTEND_URL || process.env.CLIENT_URL || ""`
    in production. Unset, it yields an **empty string** — no throw, no warning. T97 added a
    production fail-fast to `frontend-eaz/src/lib/seo.js`; the backend has the same class of bug and
    was not touched, and `utils/validateEnv.js` does not require the variable either.
  - **Impact:** worse than the SEO problem T97 fixed, because this reaches payments. The value is
    interpolated into **Paystack `callback_url`** in at least six places
    (`orderController.js:421`, `hostingOrderController.js:163/677/959`,
    `pos/paymentController.js:79/207`, `pos/inventoryController.js:279`,
    `domainController.js:312`, `serviceOrderController.js:109`) and into customer tracking links in
    `services/notify.js:127/150`. Empty gives Paystack `callback_url: "/order-confirmation/REF"` —
    a relative URL — and texts customers a link to `/track/<token>` with no host.
  - **Repro:** `NODE_ENV=production` with `FRONTEND_URL` and `CLIENT_URL` unset, then read the
    `callback_url` sent to Paystack in `createOrder`.
  - **Fix:** mirror T97 — throw at startup (best placed in `utils/validateEnv.js`, which already
    `process.exit(1)`s for `MONGO_URL`, `JWT_SECRET` and `PAYSTACK_SECRET`) rather than returning "".
  - **Location:** `utils/frontendUrl.js`; `utils/validateEnv.js`

- [ ] **T120 · The full backend suite is unreliable: mongod instances fail to start late in the run** (final re-audit 2026-08-29) — **CONFIRMED**
  - **Issue:** a full `--runInBand` run took **4407 s (73 minutes)** and produced **21 failures across
    3 suites** — `productReviews` (2058 s), `salesScoping` (900 s), `technicianHostingDomainAccess`
    (605 s). The errors are not assertions: `Instance failed to start within 10000ms`
    (mongodb-memory-server) followed by `MongooseError: Operation buffering timed out after 10000ms`.
    Each suite starts its own `MongoMemoryServer` in `beforeAll` (`tests/setup.js:59-62`); late in a
    long run they stop starting.
  - **Impact:** this is the root cause behind **T108** (attributed to a sleeping machine) and the
    "hang" seen twice today at ~0.2% CPU. A green full run cannot be relied on, and a red one cannot
    be told apart from a real break without inspecting every failure. All three suites pass in
    isolation.
  - **Repro:** `npx jest --runInBand` and watch the tail; or run the three named suites alone
    (they pass).
  - **Fix:** most likely mongod processes or ports not released between suites. Options: a single
    shared `MongoMemoryServer` for the whole run via `globalSetup`/`globalTeardown` instead of one
    per suite, or `MongoMemoryReplSet` reused across files. Raising the 10 s timeout treats the
    symptom.
  - **Location:** `tests/setup.js:59-70`; `jest.config.js`
  - **Supersedes:** T108, which described the symptom; this records the measured cause.

- [ ] **T121 · Hosting/domain webhook fulfilment guards duplicates with read-then-check, not atomically** (final re-audit 2026-08-29) — **POTENTIAL RISK**
  - **Issue:** the shop path is airtight — `utils/fulfilShopOrder.js:57` does a single
    `findOneAndUpdate({ paystackReference, status: 'pending', total: amountPesewas })`, so a duplicate
    or replayed webhook is an atomic no-op and the charged amount is bound into the filter. The
    hosting branch instead **reads** the order, checks `status === 'paid' && provisioningStatus !==
    'not_started'`, then writes (`controllers/webhookController.js:186-196`).
  - **Impact:** two webhooks arriving concurrently can both pass the check before either writes, and
    both proceed to provision. Paystack does retry, and retries can overlap. Not observed in
    production, and `instances: 1` in PM2 keeps it to one process — but the guard itself is not safe.
  - **Fix:** make it a conditional update like the shop path, e.g.
    `findOneAndUpdate({ _id, status: { $ne: 'paid' } }, …)` and act only if a document comes back.
  - **Location:** `controllers/webhookController.js:186-196`; compare `utils/fulfilShopOrder.js:57`

- [ ] **T122 · Deployment configuration is not in version control** (final re-audit 2026-08-29) — **CONFIRMED**
  - **Issue:** `nginx.conf` and `ecosystem.config.js` live at the workspace root
    (`/Users/mac/Desktop/eazworld/`), which is **not a git repository** — only `backend-eaz/` and
    `frontend-eaz/` are. Neither file is tracked by either repo. There is also no `Dockerfile` or
    `docker-compose.yml` anywhere in the tree, though deployment is Docker on a Spaceship VPS.
  - **Impact:** the files that define how the app is served exist only on this machine. They cannot
    be deployed by pulling either repo, are not reviewed, are not backed up, and are lost with the
    laptop. This is a deployment blocker independent of their contents.
  - **Fix:** move both into whichever repo owns deployment (or a third infra repo) and commit them;
    commit the Dockerfile alongside, or document where it lives and who owns it.
  - **Location:** `../nginx.conf`; `../ecosystem.config.js`

---

## Ad-hoc fixes (found during work, outside the original audit)

_Shipped on request during the 2026-08-29 session, tracked here after the fact so the log is
complete:_ **T110** marketplace parts/accessories/other filter (backend `kind` param) ·
**T112** Part Orders tab removed, order updates moved to the detail page · **T113** staff record
expenses, visibility scoped by recorder · **T114** same-day cutoff noon → 5 PM ·
**T116** `/shipping/methods` legacy branch reads the zone's `speedTiers`. All merged to `main`.

- [ ] **T115 · Two shipping suites pass or fail on the wall clock** (found during T114, 2026-08-29)
  - **Issue:** `tests/distanceZones.test.js` and `tests/shippingEndpoints.test.js` assert that
    Express is among the offered methods, but never pin the clock. Express is gated by
    `sameDayWindowOpen`, so the assertions hold only before the cutoff hour. Measured the same
    day: **109/109 green at 08:00, 5 failing at 12:37**, with no code change between the runs.
  - **Impact:** the full suite cannot be trusted as a gate — a red run has to be hand-diagnosed
    to tell a real break from the time of day. It is how T114's real bug stayed invisible: the
    failures looked like flake. T114 moved the cutoff to 17:00, so the window is simply wider —
    these will fail again after 5 PM.
  - **Repro:** `npx jest tests/distanceZones.test.js tests/shippingEndpoints.test.js --runInBand`
    before and after the cutoff hour, or `TZ=America/New_York` to force a morning.
  - **Fix:** pin the clock. `sameDayWindowOpen(settings, speed, now)` already takes an injectable
    `now` — the T114 cases in `tests/shippingCalculator.test.js` use it — but these two go through
    HTTP, so they need either a settings override per test (`sameDayCutoffHour = 23`, which
    `shippingCheckout.test.js` and `shippingCalculator.test.js` already do) or fake timers.
  - **Location:** `tests/distanceZones.test.js`; `tests/shippingEndpoints.test.js`
  - **Acceptance:**
    - [ ] Both suites pass at any hour, verified by forcing at least two very different clocks
    - [ ] No remaining assertion depends on the ambient cutoff

- [ ] **T111 · Reports controller still carries unreachable staff-scoping logic** (found during T83, 2026-08-29)
  - **Issue:** `getReportsAnalytics` implements T32's staff scoping — pin a staff caller to their
    own activity, never trust a client-supplied `staffId` for the staff role, return an empty
    `staffList` so staff get no picker. T83 removed staff from the route entirely, so none of
    those branches can execute.
  - **Impact:** dead code that reads as a live guarantee. A future reader may assume staff can
    reach reports safely because the scoping exists, and re-open the route on that basis.
  - **Fix:** either delete the staff branches and the `isOwnReport` / empty-`staffList` handling,
    or keep them and add a comment saying they are a deliberate belt-and-braces for a policy that
    may be reversed. Do **not** simply re-open the route to make the code reachable again.
  - **Location:** `controllers/pos/reportsController.js` (the `scope` block); the rewritten
    assertions in `tests/reportsAnalytics.test.js`

- [ ] **T105 · `roles.md` and the POS routes disagree on ~11 rows for admin and staff** (found during T83, 2026-08-29)
  - **Issue:** T83 closed the technician holes, and the technician column now matches `roles.md`
    exactly. The **admin** and **staff** columns still diverge — in both directions:

    | `roles.md` row | Matrix says | Code allows | Direction |
    |---|---|---|---|
    | See dashboard & reports | staff ✅ | `/overview` is superadmin+admin | staff has **less** |
    | Add & edit customers | staff ❌ | staff allowed | staff has **more** |
    | Take a payment on a job | admin ❌ | admin allowed | admin has **more** |
    | Take a Mobile Money payment | admin ❌ | admin allowed | admin has **more** |
    | Look up stock | staff ❌ | staff allowed | staff has **more** |
    | Add / edit stock | staff ❌ | staff allowed | staff has **more** |
    | See suppliers | staff ❌ | staff allowed | staff has **more** |
    | See expenses | staff ❌ | staff allowed | roles.md **stale** — see T5 |
    | Record / edit expenses | admin ❌ | admin allowed | roles.md **stale** — see T5 |
    | See jobs waiting to be collected | technician ✅ | technician denied | technician has **less** |
    | Send collection reminders | admin ❌, staff ✅ | superadmin+admin | wrong **both ways** |
    | Track warranty claims | admin ✅ | superadmin+staff | admin has **less** |
  - **Impact:** Lower severity than T83 — none of these is a technician escalation, and most are
    staff/admin holding access the matrix does not grant rather than a privilege boundary being
    crossed. But the two documents cannot both be right, so neither can be trusted as the
    authority for the next role change.
  - **Why not fixed under T83:** T83's acceptance criteria 1 ("match `roles.md`") and 3
    ("staff/admin/superadmin keep their current access") contradict each other on exactly these
    rows. Applying the matrix literally would have **removed working access** from staff and
    admin — a product decision, not a security fix. `roles.md` is also demonstrably stale in
    places: T5 (2026-08-26) and T83 (2026-08-29) both overrode it after asking the owner.
  - **Repro:** compare the table in `roles.md` §"The repair shop, side by side" against the
    `restrictTo(...)` calls in `routes/posRoutes.js`.
  - **Fix:** walk the 12 rows with the product owner, decide each, then make `roles.md` the
    single source of truth and align the routes to it. Add a role-matrix test per row so the two
    cannot drift again (overlaps T92).
  - **Location:** `roles.md` §"The repair shop, side by side"; `routes/posRoutes.js`
  - **Acceptance:**
    - [ ] Each of the 12 rows has an explicit owner decision
    - [ ] `roles.md` matches the routes exactly
    - [ ] A test asserts the matrix per role, so drift fails CI

- [x] **T107 · `GET /products/all` loads the entire catalogue unpaginated and un-`lean`** (found 2026-08-29, alongside T106)
  - **Issue:** `getAdminProducts` is `Product.find({}).sort({ createdAt: -1 })`
    (`controllers/productController.js:218-225`) — no `limit`, no `skip`, no `lean()`, and it
    hydrates full Mongoose documents. It is called on every Marketplace open
    (`frontend-eaz/src/app/dashboard/commerce/page.jsx:510`).
  - **Impact:** Same class as **T87**, but worse in one respect: T87 is about an unclamped
    client-supplied `limit`, whereas this route offers no bound at all. Since the parts/products
    merge this collection holds bench stock *and* shop stock, so it only grows. On a 512 MB heap
    a few thousand hydrated documents with `images`/`variants`/`gallery` arrays is a real
    exhaustion risk, and the payload ships to the browser in full.
  - **Repro:** `GET /api/v1/products/all` as admin and compare the response size and RSS against
    the paginated `GET /api/v1/products`.
  - **Fix:** clamp `page`/`limit` using the default/min/max pattern already in
    `productController.getProducts`, add `.lean()`, and project only the fields the Marketplace
    grid renders. Fold into T87's sweep if that is done first.
  - **Location:** `controllers/productController.js:218-225`; `routes/productRoutes.js:23`
  - **Acceptance:**
    - [ ] `limit` clamped with a sane default and maximum
    - [ ] `.lean()` plus a field projection
    - [ ] Marketplace still renders correctly against the paginated response

- [ ] **T108 · `refunds.test.js` fails only inside the full serial run, with an unexplained 426** (found during T83 verification, 2026-08-29)
  - **Issue:** in `npx jest --runInBand`, "Paystack webhook — refund.processed / refund.failed ›
    completes a processing refund on refund.processed" (`tests/refunds.test.js:175`) gets
    **426 Upgrade Required** where it expects 200. Run on its own the file is **19/19 green**, on
    both `main` and the T83 branch. So it is ordering/pollution, not a code regression.
  - **Impact:** the full suite is not a trustworthy gate — it went 74/74 green earlier the same
    day, then 12 failed on a stalled run, now 1. Until this is understood, a red full run cannot
    be told apart from a real break.
  - **Notable:** `426` appears **nowhere in the source** — not in `app.js`, the middleware, the
    webhook route or any controller — so it originates in a dependency under some state the
    preceding tests leave behind. Worth finding: a 426 from the Paystack webhook in production
    would silently drop refund callbacks.
  - **Repro:** `npx jest --runInBand` (fails) vs `npx jest tests/refunds.test.js --runInBand`
    (passes). Adding an unrelated test file changed the ordering enough to surface it.
  - **Fix:** bisect by running `refunds.test.js` after progressively larger prefixes of the suite
    to find the polluting file; check for shared state left in `app`-level middleware or a module
    -scope cache. `tests/setup.js` wipes collections per test but nothing resets module state.
  - **Location:** `tests/refunds.test.js:175`; `tests/setup.js`

- [ ] **T109 · Product edit page pulls the whole catalogue to render one product** (found during T107, 2026-08-29)
  - **Issue:** `frontend-eaz/src/app/dashboard/commerce/products/[id]/edit/page.jsx` uses
    `useAdminProducts()` and finds its record inside the returned array. There is no admin
    get-by-id route — `routes/productRoutes.js` exposes only `GET /:slug` (public, by slug) and
    `GET /all`. T107 paginated `/all` (50 default, 200 max), so the hook now pins `limit=200`.
  - **Impact:** editing any product beyond the 200th silently fails to find its record. The
    merged collection holds bench *and* shop stock, so 200 is reachable. It also fetches up to
    200 documents to render one form.
  - **Repro:** seed 250 products, open the edit page for the newest — the form cannot find it.
  - **Fix:** add `GET /products/id/:id` behind `protect` + `restrictTo('admin','staff')`
    returning one product regardless of `isActive`/`sellOnline` (the public `/:slug` route must
    stay unable to serve archived items), then have the edit page fetch that instead. Registering
    it under `/id/` avoids colliding with the existing `/:slug`.
  - **Location:** `controllers/productController.js`; `routes/productRoutes.js:38`;
    `frontend-eaz/src/hooks/queries/useProducts.js:57`; the edit page
  - **Acceptance:**
    - [ ] Admin get-by-id route exists and is role-gated
    - [ ] Edit page fetches one product, not a list
    - [ ] `useAdminProducts` no longer needs `limit=200`
    - [ ] Archived products remain unreachable from the public `/:slug` route

---

## Notes / Reconciliation with `AUDIT_REPORT.md` (stale)

`AUDIT_REPORT.md` predates the migration to the current stack and is **superseded** by
`AUDIT.md`. Its items were checked against today's code:

| AUDIT_REPORT.md claim | Status in current code |
|-----------------------|------------------------|
| "Auth API missing / frontend calls non-existent `/auth/*`" | ✅ **Resolved** — full auth is implemented and mounted (`authRoutes`, `protect`, `restrictTo`, JWT cookie, 2FA, reset). |
| "No auth on contacts/projects/uploads/domain orders" | ✅ **Resolved** — all gated with `protect`/`restrictTo('admin')`; IDOR ownership checks on orders/domains/hosting (test-backed). |
| "DomainOrder create will fail (schema mismatch)" | ✅ **Resolved** — domain payment + retry flows are test-backed and passing. |
| "Env/PORT mismatch, Vite proxy can't reach API" | ✅ **N/A** — no Vite; Next.js rewrites → `NEXT_PUBLIC_API_URL`; backend on 5000. |
| "Debug `console.log` in `DomainAndHostingPricingSection.jsx`" | ✅ **N/A** — that Vite component no longer exists. |
| "Not on target stack (Next.js/Tailwind/Namecheap/PM2/Nginx)" | ✅ **Done** — current stack is exactly that. |
| "npm audit vulnerabilities" (Vite/react-router/styled-components CVEs) | ➡️ **Superseded** — re-audit the current deps under **T11**; old CVE list is obsolete. |

**Recommendation:** treat `AUDIT.md` + `backend-eaz/tasks.md` + `frontend-eaz/tasks.md` as
authoritative; archive or delete `AUDIT_REPORT.md` to avoid confusion.
