# EazWorld Backend — Issue & Fix Tracker

> This is the **backend-eaz** half of the issue tracker. Frontend items live in
> **`frontend-eaz/tasks.md`**. Cross-app tasks are listed in their primary repo and
> cross-referenced.
>
> Source of truth: **`AUDIT.md`** (full end-to-end audit run 2026-08-18 — 112 backend + 31
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

_None. The app builds, all tests pass, no broken or insecure feature blocks use._
(Verification tasks that gate a production release are tracked under P1 below.)

---

## P1 — Important

- [ ] **T3 · Live E2E verification of external-service flows (the 🟣 items)**
  - **Issue:** 28 features have complete, correct-looking code but were **not** run against
    live third parties in the audit. Logic around them is test-backed; the round-trips are not.
  - **Impact:** Unknown until exercised; these are core revenue/ops paths.
  - **Sub-tasks (run each in sandbox, record result):**
    - [x] T3a · Paystack card + Mobile Money charge (shop, repair, domain, hosting, service) ✅ verified 2026-08-20
      - **Verified against the live Paystack sandbox** (confirmed `PAYSTACK_SECRET` is `sk_test_...` first).
      - **MoMo — fully completed end-to-end** through the real production code path:
        `POST /pos/jobs/:id/momo-charge` (repair) with the documented Ghana MTN test number
        `0551234987` returned `status: "success"` immediately from Paystack (no OTP needed for
        this test number); the app's own poll endpoint (`GET .../momo-charge/:reference`, which
        calls `transaction.verify`) correctly reported `success` and auto-recorded the `PosPayment`.
      - **Card — initialize/verify plumbing confirmed live**, full hosted-checkout completion
        blocked by environment (no headless browser available on this host — Playwright dropped
        macOS 12/Monterey support, `npx playwright install chromium` failed with
        "Playwright does not support chromium on mac12"): `POST /pos/jobs/:id/card-charge`
        returned a genuine `https://checkout.paystack.com/...` authorization URL + reference; the
        poll endpoint correctly reported `abandoned` for the uncompleted session, proving
        `transaction.verify` is live and accurate. Separately confirmed Paystack's documented test
        card (`4084 0840 8408 4081`, CVV `408`, any future expiry) itself works against this
        account's sandbox by charging it directly via Paystack's raw Charge API (bypassing the
        hosted-checkout redirect) — returned `status: "success"`, `gateway_response: "Successful"`.
      - **Shop, hosting, domain checkout** (`orderController.createOrder`,
        `hostingOrderController` ×3, `domainController.createDomainPayment`) already get a live
        `transaction.initialize` round-trip on every `npm test` run via
        `tests/variants.test.js`, `tests/hosting.test.js`, `tests/customerPurchase.test.js`,
        `tests/hostingStaffCreate.test.js` — confirmed still passing (full suite: 21/21).
      - **Service order checkout** (`serviceOrderController.createServicePayment`) had no live
        coverage — manually verified `POST /services/payment` against the sandbox
        (returned a valid `authorizationUrl` + reference); not covered by an automated test.
      - **Not verified:** actual completion of a card charge through the hosted-checkout page
        itself (typing card number into Paystack's UI) — needs a browser or manual click-through,
        unavailable on this host. The plumbing on both sides (initialize + verify) is proven live.
    - [ ] T3b · Paystack webhook delivery end-to-end (signature + fulfilment) — **BLOCKED — awaiting credentials**
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
      - `NAMECHEAP_SANDBOX=false` — credentials point at the **live production** Namecheap API, so a
        registration/retry test here would purchase a real domain with real money. Not attempted
        without explicit authorization.
      - Read-only **domain search** was tested live (`GET /api/v1/domain/search?domain=...`): the
        request reached Namecheap successfully but was rejected — `Invalid request IP: 154.161.66.45`
        (this dev machine's IP isn't whitelisted in the Namecheap account's API access settings, same
        constraint as T3c). Confirms credentials are valid and the round-trip/error-handling path
        works; doesn't confirm a successful availability lookup.
      - **To unblock (search):** add this machine's current IP to Namecheap's API whitelist
        (Profile → Tools → API Access).
      - **To unblock (registration/retry):** either set `NAMECHEAP_SANDBOX=true` for a free sandbox
        registration test, or explicitly authorize a real low-cost domain purchase for verification.
    - [x] T3e · Cloudinary image/video + repair-job photo upload ✅ verified 2026-08-20
      - Live round-trip via the real production code path: `POST /pos/jobs/:id/photos` uploaded a
        real 1×1 PNG to Cloudinary (`eazworld/repairs/{jobId}/...` folder, transform pipeline
        applied) — returned a genuine `res.cloudinary.com` URL. `DELETE /pos/jobs/:id/photos/:photoId`
        (needs `superadmin`/`staff`, not plain `admin` — noted for anyone reusing this) then removed
        it — independently confirmed gone via `cloudinary.api.resource()` (404 "Resource not found").
        No residue left in the account.
    - [ ] T3f · Hubtel SMS + Resend email (repair status, verify PIN, password reset, 2FA) — **BLOCKED — awaiting Hubtel credentials (HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET)**
  - **Location:** `services/*`, `controllers/*` charge/upload handlers
  - **Source:** AUDIT.md §13, §19, §28, §29 P1 (all 🟣 rows in §4)

---

## P2 — Improvements

- [ ] **T5 · Confirm/align Expenses role model** — **BLOCKED: needs product owner decision**
  - **Issue:** Expense read = `('superadmin','staff')`, write = `('superadmin')` — `admin`
    is omitted from **both**. Confirmed by re-reading `routes/posRoutes.js:93-97`: `admin`
    currently has **no read access either**, not just write (the original note undersold
    it — this isn't just a write-side gap). Inconsistent with the otherwise admin-inclusive
    pattern elsewhere in the app. Not a security hole (more restrictive, not less).
  - **Location:** `routes/posRoutes.js`
  - **Fix:** Confirm intent with product owner; add `admin` to read (and possibly write) if
    it was an oversight.
  - **Source:** AUDIT.md §7 note, §23

---

## Missing Features (new work — ⚪ in the audit)

Not defects; product features that don't exist yet. Scope separately before building.

- [x] **T45 · Pre-order support for products** — ✅ backend done 2026-08-25 — items that are out of stock, or not yet available in Ghana, currently can't be ordered at all (the shop blocks add-to-cart / checkout on zero stock). Add a pre-order capability so customers can place these ahead of availability.
  - **Model (`models/Product.js`):** add a `preorder` sub-object — e.g. `preorder.enabled` (bool), `preorder.availableFrom` (date | null), `preorder.note` (string, e.g. "ships from abroad, ~3 weeks"), and a cap field if pre-order quantity is limited. Decide how this interacts with `stock`/availability so a pre-order-enabled item bypasses the existing "out of stock → can't buy" guard *only when* `preorder.enabled`.
  - **Order flow:** flag pre-order line items on the `Order` so ops can tell them apart from in-stock items, and decide fulfilment/notification when the item actually lands. **Payment decision to make before building:** pay upfront via Paystack (same as a normal order) vs. deposit / pay-on-arrival — money-movement change, so scope explicitly.
  - **Storefront (mirror in `frontend-eaz/tasks.md`):** product card/detail shows a "Pre-order" badge + expected-availability copy instead of "Out of stock"; the add-to-cart button becomes "Pre-order".
  - **Decisions taken (2026-08-25), which shaped everything below:**
    - **Paid in full up front**, same Paystack flow as any order — so checkout, the
      webhook and idempotent fulfilment are untouched; a pre-order is just a flagged line.
    - **Optional per-product cap** (`preorder.maxQty`, null = uncapped), enforced in
      the controller, not merely hidden in the storefront.
    - **Released manually by staff.** Stock moves for plenty of reasons — a
      correction, a return, a POS void — and none of them should ship anything.
    - **Email only** at release, via the Resend path already wired.
  - **Shipped (backend):**
    - `models/Product.js` — `preorder { enabled, availableFrom, note, maxQty }` as a
      nested schema with its own default, so products predating T45 read as
      `{ enabled: false }` rather than undefined.
    - `models/Order.js` — per-item `isPreorder` + `preorderReleasedAt`.
    - `controllers/orderController.js` — a line becomes a pre-order only when the
      stock genuinely is not there **and** the product is marked for it, so enabling
      the flag cannot change how an in-stock product sells. Works for variant lines
      too. The cap is checked here.
    - `utils/fulfilShopOrder.js` — an unreleased pre-order line is skipped on
      fulfilment (a decrement would fail its guard and log a false alarm) and on
      restock (nothing was deducted, so giving stock back would invent inventory).
    - `GET /orders/preorders` — the queue: paid orders with an unreleased pre-order
      line, oldest first. Unpaid ones are excluded; nothing is owed until the money
      lands. Registered before `/:id` or Express reads "preorders" as an id.
    - `PATCH /orders/:id/preorder-release` — moves stock through the same guarded
      decrement fulfilment uses, counts `sold`, stamps the line, appends tracking
      history, and emails. A line whose stock has **not** arrived stays queued rather
      than being released against inventory that does not exist, so a partial release
      is reported back in `meta`.
    - `utils/email.js` — `sendPreorderReadyEmail`, logged under its own
      `preorder_ready` type rather than `other` (T61's reasoning). No email on the
      order is not a failure: shop checkout is phone-first here.
  - **Tests:** `tests/preorder.test.js` (new, 16) — the guard both ways, the cap at
    and over the limit, uncapped, the default for existing products, fulfilment and
    restock leaving pre-order stock alone, the queue including/excluding by paid
    status, release moving stock and counting the sale, refusing to release against
    stock that has not arrived, double-release, the email, and staff-only access.
  - **Verified:** full backend suite 55 suites / 458 tests, exit 0; lint clean.

---

## Ad-hoc fixes (found during work, outside the original audit)

- [ ] **T62 · Transactional email coverage — audit and close the gaps**
  - **Why now:** a pre-order customer waits weeks, and today they pay and hear
    nothing. Shop orders send **no customer email at all** — no receipt, no tracking
    number, no status change — while hosting orders send three. That asymmetry is the
    core of this task.
  - **Audited 2026-08-25 against the code, not assumed.**
  - **Already covered (leave alone):**
    | Area | Sends | Where |
    |---|---|---|
    | Auth | welcome, account created, password reset, 2FA pin, verification pin | `utils/email.js` |
    | Contact / consultation | admin alert + customer auto-reply | `utils/email.js` |
    | Hosting orders | order confirmation, payment received, hosting credentials | `utils/hostingEmail.js` |
    | Repair jobs | status updates, **email first with SMS fallback** | `services/notify.js` → `notifyCustomer` |
    | Repair collection | ready-for-collection reminder | `services/reminderJob.js` |
    | Pre-orders | "your item has arrived" at release (T45) | `utils/email.js` → `sendPreorderReadyEmail` |
  - **The gaps, roughly in order of what a customer would miss most:**
    1. **Shop order confirmation — nothing is sent.** The customer pays and gets a web
       page. Close the tab and they have no order number, no tracking number, no record.
       This is also what makes the T45 pre-order tracking reachable, so it is the one
       that matters most. Should carry: order number, **tracking number + link**, items,
       total, delivery zone, and for a pre-order the expected-arrival line.
    2. **Shop payment received** — hosting confirms payment, shop does not.
    3. **Shop status changes** (`processing` / `shipped` / `delivered`) — repair jobs
       notify the customer on every meaningful move; shop orders never do. Reuse
       `notifyCustomer`'s shape rather than inventing a second pattern.
    4. **Refunds** (T15) — a refund is issued and the customer is told nothing.
    5. **Domain orders** — `controllers/domainController.js` sends **zero** emails: no
       purchase confirmation, no registration success, no expiry warning.
    6. **Service orders** — only `sendAccountCreatedEmail`; no confirmation of the
       service order itself.
    7. **Unused EmailLog types** — `renewal_reminder` and `expired_notice` are in the
       enum but nothing sends them. `reminderJob` is repair-collection only, despite the
       names suggesting hosting/domain renewals. Either wire them up or drop them.
  - **Explicitly NOT wanted (decided with the user 2026-08-25):** per-stage emails for
    pre-order shipment milestones. Customers check the tracking page themselves; the
    only pre-order email is when the goods reach the shop.
  - **Conventions to follow:** every send goes through `utils/email.js`'s `send()` so it
    lands in `EmailLog`; give each new kind its **own** `type` rather than `other`, or it
    is unfilterable in the admin log (T61's finding); a missing customer email is not a
    failure — shop checkout here is phone-first, so return quietly like
    `sendPreorderReadyEmail` does; and never let a mail failure roll back the thing that
    triggered it.
  - **Frontend part:** `frontend-eaz/tasks.md` → T62.


- [x] **T43 · Money display bypasses the single `formatGhs` formatter** — ✅ done 2026-08-25 (frontend-only, no backend change)
  - **Issue:** The frontend convention (STYLE_GUIDE/CLAUDE.md) is to render money via
    `formatGhs(pesewas)` from `lib/shop.js`. Many pages instead hand-roll `GH₵{...toFixed(2)}`
    or `GH₵{...toLocaleString()}` — raw concatenation that is inconsistent and error-prone.
  - **Location:** backend side n/a — see `frontend-eaz/tasks.md` → T43 for the full file list.
  - **Fix:** None on the backend (data already arrives in pesewas; the display conversion
    happens client-side). Verify any backend money fields these pages consume are integer
    pesewas as the pages expect.
  - **Frontend part:** `frontend-eaz/tasks.md` → T43.

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
