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

- [ ] **T17 · Allow registration with email OR phone number**
  - **Issue:** Registration currently requires an email input (`email` is a required field
    on the signup schema), but users should be able to register using **either** an
    email **or** a phone number. (Related: login already supports `$or` lookup by email/phone;
    phone uniqueness is enforced — see T1.)
  - **Location:** `validation/authSchema.js` (register schema),
    `controllers/authController.js` (`register`)
  - **Fix:** Make `email` optional when `phone` is provided (and vice versa); require at
    least one identifier. Send verification (email PIN or phone OTP) to whichever
    identifier was chosen. Scope account verification/OTP accordingly.
  - **Frontend part:** register form changes live in **`frontend-eaz/tasks.md` → T17**.

- [ ] **T18 · Backend guard: reject `cancelled` from `ready` repair jobs**
  - **Issue:** Frontend hides "Cancel Job" once a job is `ready` (see
    `frontend-eaz/tasks.md` → T18). For parity, the backend status-transition guard should
    also reject a transition from `ready` → `cancelled`.
  - **Location:** POS repair job controller (status update handler)
  - **Fix:** Add a guard so a `ready`/`collected` job cannot be transitioned to `cancelled`;
    return a friendly 400. Add a test.

---

## Missing Features (new work — ⚪ in the audit)

Not defects; product features that don't exist yet. Scope separately before building.

- [x] **T14 · General business settings** — `Settings` holds only maintenance fields (no shop profile, tax/VAT, currency, hours). — AUDIT.md §24 (#3)
  - **Finding before implementation:** this audit line was stale. T6 (2026-08-20) already
    built "shop profile" and "hours" — `Settings.business` + `getBusinessProfile()` +
    `PATCH /api/v1/settings` (admin-only). What was actually still missing: (1) tax/VAT
    fields, genuinely absent everywhere (zero hits searching the whole codebase), and (2)
    **any admin UI at all** for `business.*` — `/dashboard/settings` is the personal
    account page shared by every role (profile/password/2FA/theme), not a business-settings
    editor; the only thing touching `Settings` in the frontend was `MaintenanceCard` on the
    admin Overview page, and it only ever sent maintenance fields. So the real scope became
    "add VAT fields + build the missing admin UI," not "add new backend fields."
  - **Decisions made explicit, not left as oversights:** no currency setting added, not even
    read-only — the app is hardcoded to GHS/pesewas everywhere (`CLAUDE.md`'s golden rule +
    the completed Phase 7 money-standardization migration); a fake selector that does
    nothing when changed would be misleading, and real multi-currency support is a
    money-architecture change on Phase 7's scale, not a settings-page addition. VAT fields
    are **display-only** — nothing here computes VAT into any order/sale/invoice total,
    and wiring the new fields into any actual invoice/receipt/checkout display is
    explicitly deferred to a separate future task (several plausible places to put it;
    not picking one unilaterally here).
  - **Shipped:**
    - `models/Settings.js` — `business.vatEnabled` (bool), `business.vatRate` (0–100,
      server-clamped), `business.vatNumber` (string), `business.pricesIncludeVat` (bool).
    - `controllers/settingsController.js` — extended the existing dot-path merge logic for
      these 4 fields (same pattern T6 established); `vatRate` clamped server-side
      regardless of what the client sends.
    - `frontend-eaz`: new admin-only `/dashboard/business-settings` page (Shop Profile /
      Services & Pricing / Tax-VAT sections), reusing the existing `useSettings`/
      `useUpdateSettings` hooks as-is. New `adminNav` sidebar entry.
  - **Bug found + fixed during implementation (frontend):** the VAT-rate `<input>` initially
    had both `max="100"` and a JS clamp on submit. HTML5 constraint validation silently
    blocks form submission when a number input's value exceeds its `max` — so typing 250
    and clicking Save would do *nothing* in a real browser (no error, no clamp, just a
    blocked submit), never reaching the JS clamp at all. Removed `max` (kept `min="0"`),
    matching the convention already used elsewhere in this app (e.g. the repair-job
    labour-cost input) of relying on the backend's authoritative clamp rather than a
    native `max` attribute. Caught by a test that deliberately submitted an out-of-range
    value and got 0 mock calls instead of the expected clamped payload.
  - **Tests:** backend `tests/businessProfile.test.js` extended (+4 tests: VAT defaults,
    a VAT-fields PATCH that doesn't disturb other business fields, rate clamping at both
    ends). Full file: 9/9 passed. Frontend `page.test.jsx` (5 tests: renders fetched
    values, saves shop profile, hides/shows + saves VAT fields, add/remove service row).
    Full frontend suite: 28 files / 131 tests passed. Lint clean both sides; `next build`
    succeeded (`/dashboard/business-settings` compiles).
- [x] **T15 · Refunds** — no refund endpoint or Paystack refund call anywhere. — AUDIT.md §24 (#4)
  - **v1 scope (agreed with product owner before implementation, given real money
    movement):** full-order refunds for shop `Order`s only, via the real Paystack refund
    API (`paystack.refund.create`/`.fetch` — already available on the `@paystack/paystack-sdk`
    dependency this codebase already uses for `transaction.initialize`/`.verify`, just unused
    until now). Admin/superadmin only (`restrictTo('admin')`), staff excluded — narrower than
    the other order-management routes, since a refund is irreversible in a way editing a
    status isn't. No second-approver step. Not a new `Order.status` value — `refund` is a
    separate sub-object (payment outcome is orthogonal to fulfilment status); a refund
    transitions the order to `status: 'cancelled'`, reusing the exact existing "cancel any
    live order" transition + **T2's restock guard** (`stockDeducted && !stockRestored` →
    `restockOrderItems()`) for free — no new inventory logic.
  - **Concurrency (reviewed at T30-level rigor before implementation):** "one refund per
    order" is enforced by a single atomic `findOneAndUpdate({_id, 'refund.status':'none',
    status:{$in: eligible}}, {$set:{'refund.status':'processing', ...}})` — a single-document
    write, atomically guaranteed by MongoDB without needing T30's `session.withTransaction()`
    (that was needed there for *multi*-document atomicity across Sale+Part; this is one
    document). **Claim-then-call ordering, deliberately**: the atomic claim flips
    `refund.status` to `'processing'` *before* `paystack.refund.create()` fires, so a crash
    between the two fails safe (stuck record, no money moved) instead of the alternative
    (call-then-claim) which risks a duplicate refund attempt if a crash hides a
    successfully-created refund from the DB. If `create()` itself throws, the ambiguous state
    is left at `'processing'` rather than guessed at — `@paystack/paystack-sdk`'s refund
    create endpoint has no idempotency key, so blindly retrying risked a real duplicate.
  - **Recovery when the webhook doesn't arrive** — and it might not: `T3b` (Paystack webhook
    delivery end-to-end) is **still blocked/unverified in this project**, so T15 does not
    assume it works. Two real recovery paths: `POST /orders/:id/refund/sync` (admin,
    read-only `refund.fetch` against Paystack, safe to call repeatedly), and a periodic
    `services/refundReconcileJob.js` (mirrors the existing `setInterval`-based
    `reminderJob`/`renewalJob` pattern in `server.js` — this codebase has no `node-cron`)
    that finds any refund stuck in `'processing'` past a threshold and checks it
    automatically. **Documented gap, not silently swallowed:** if `create()` itself threw
    before a refund id was captured, there's no reference to look up and no way to filter
    Paystack's `refund.list()` by transaction — that narrow case needs manual investigation
    via the Paystack dashboard; it's distinct from (and rarer than) the case the reconcile
    job actually covers (create() succeeded, only the webhook confirming it never arrived).
  - **Live sandbox finding that changed the design:** live-verified `refund.create()` +
    `.fetch()` against the real Paystack sandbox (charged a real transaction via the
    documented MTN test number, then refunded it) — confirmed the request/response shapes,
    but also found a refund's initial status is `'pending'`, not settled synchronously, and
    Paystack's own `expected_at` for that MTN GHA refund was **~9 days out**. Adjusted the
    reconcile job's `server.js` interval from an initially-planned 15 minutes to **2 hours**
    to match that real timeline instead of polling Paystack for nothing for over a week per
    stuck refund.
  - **Explicitly out of scope:** POS payments/sales (`PosPayment`/`Sale`/`RepairJob` —
    often cash, no Paystack reference; `voidSale` is a pre-existing, unrelated concept, not
    touched); Hosting/Domain/Service order refunds (separate money conventions per the
    completed Phase 7 migration's "Group C"); partial/line-item refunds (full-order only);
    refunding an already-`delivered` order (restock semantics need a separate decision —
    was the item actually returned?); dual-approval workflow; customer-initiated refund
    requests; **retrying a `'failed'` refund** — once `refund.status` leaves `'none'` the
    atomic claim guard blocks a second attempt by design, and no reset/retry UI was built —
    a failed refund currently needs direct DB intervention to retry, a deliberate limitation
    to avoid a careless one-click retry on real money movement, not an oversight.
  - **Shipped:** `models/Order.js` (`refund` subdocument), `controllers/orderController.js`
    (`refundOrder`, `syncRefund`), `routes/orderRoutes.js` (`POST /:id/refund`,
    `POST /:id/refund/sync`), `controllers/webhookController.js` (new `refund.processed`/
    `refund.failed` branch, matched by the refund id captured at creation — not live-verified,
    since webhook delivery itself is unverified in this project, but consistent with the
    live-verified refund object shape), `utils/refunds.js` (`applyRefundOutcome`,
    `mapPaystackRefundStatus` — shared by the webhook branch, sync endpoint, and reconcile
    job), `services/refundReconcileJob.js`, `server.js` wiring, `services/activityLogService.js`
    (`REFUND_INITIATED`/`REFUND_COMPLETED`/`REFUND_FAILED`).
  - **Tests — explicit about live vs. mocked:** `paystack.refund.create()`/`.fetch()` request
    shapes were **live-verified** against the real Paystack sandbox (one-off script, not
    committed — mirrors how T3a's live verification was documented as prose, not a permanent
    test). Everything else — the webhook branch, sync endpoint, reconcile job, and the
    atomicity guard — is **mocked-SDK** (`jest.mock('@paystack/paystack-sdk', ...)`, same
    pattern as T13's Anthropic SDK mock), because webhook delivery can't be received in this
    environment (same blocker as T3b) and refund settlement takes days, not test-suite time.
    `tests/refunds.test.js` — 19 tests: eligibility (no reference/pending/cancelled/staff),
    a real two-simultaneous-requests concurrency regression (T30-style — exactly one 200,
    one 409, Paystack contacted once), the happy path (cancel + T2 restock + reference
    capture), a confirmed Paystack rejection (`failed`, fulfilment untouched), an ambiguous
    thrown error (`processing`, not guessed at), both webhook outcomes + idempotency + an
    unmatched event + a bad signature, the sync endpoint (resolves / stays pending / 400 with
    no reference), and the reconcile job (resolves past-threshold / ignores recent / skips
    the no-reference gap). Full backend suite: 39 suites / 282 tests passed. Lint clean.

---

## Ad-hoc fixes (found during work, outside the original audit)

- [ ] **T44 · Hosting/domain/service amounts stored as major-GHS floats — align to pesewas**
  - **Issue:** The integer-pesewas money rule applies to POS/shop, but hosting, domain, and
    service orders still store **major GHS floats** (`hostingOrderController.js` computes
    `Math.round(priceUSD * usdRate * markup * years * 100) / 100`; the webhook then
    converts with `Math.round(field * 100)` to compare against Paystack pesewas). T8 covers
    POS field *names* only — this unit mismatch is a separate, broader deviation from the
    golden rule ("money is integer pesewas, never floats").
  - **Location:** `controllers/hostingOrderController.js` (amount calc ~line 95),
    `controllers/webhookController.js` (`amountMismatch` callers for hosting/domain/service
    ~lines 120, 217, 483), hosting/domain/service `checkout` order creation.
  - **Fix (decision needed):** Either migrate these to integer pesewas end-to-end (model +
    controllers + webhook + frontend display) or explicitly document the float-GHS exception
    as intentional. If migrating, mirror the T8/POS migration approach with a one-time script
    and update the frontend `GH₵{order.amount}` displays (see `frontend-eaz/tasks.md` → T44).
  - **Frontend part:** `frontend-eaz/tasks.md` → T44.

- [ ] **T43 · Money display bypasses the single `formatGhs` formatter**
  - **Issue:** The frontend convention (STYLE_GUIDE/CLAUDE.md) is to render money via
    `formatGhs(pesewas)` from `lib/shop.js`. Many pages instead hand-roll `GH₵{...toFixed(2)}`
    or `GH₵{...toLocaleString()}` — raw concatenation that is inconsistent and error-prone.
  - **Location:** backend side n/a — see `frontend-eaz/tasks.md` → T43 for the full file list.
  - **Fix:** None on the backend (data already arrives in pesewas; the display conversion
    happens client-side). Verify any backend money fields these pages consume are integer
    pesewas as the pages expect.
  - **Frontend part:** `frontend-eaz/tasks.md` → T43.

- [ ] **T42 · `BlogArticle` renders markdown via `dangerouslySetInnerHTML` — stored-XSS risk**
  - **Issue:** Blog post content from `GET /api/v1/posts/:slug` is converted markdown→HTML
    with regex and injected via `dangerouslySetInnerHTML` with **no escaping/sanitization**.
    If an admin-authored (or compromised) post body contains HTML/JS, it executes for every
    reader. (`JsonLd`/theme-init uses are static-safe; this one is dynamic content.)
  - **Location:** backend side — `controllers/` post create/update should sanitize the
    `content` field on write (`sanitizeText`/strip script/iframe) as a defense-in-depth
    measure, since the frontend cannot fully trust rendered HTML.
  - **Fix:** Sanitize blog `content` server-side on create/update (strip `<script>`, event
    handlers, `javascript:` URLs). The primary render fix lives in the frontend
    (`frontend-eaz/tasks.md` → T42) — escape HTML before the markdown regex, or use a
    safe renderer.
  - **Frontend part:** `frontend-eaz/tasks.md` → T42.

- [ ] **T41 · Public track page part-order cart mixes float-GHS and pesewas**
  - **Issue:** On the `/track/:token` page, `addToCart` stores `unitPriceGhs: sellingPrice / 100`
    (float GHS) then recomputes `totalPesewas = partsSubtotalGhs * 100 + shippingPesewas`
    (float × 100), while `addPartToShopCart` stores integer pesewas directly. Two cart paths,
    two money conventions — float-rounding risk and inconsistent with the pesewas rule.
  - **Location:** backend side n/a (server recomputes totals from the Part price; the cart
    money is client-local) — see `frontend-eaz/tasks.md` → T41 for the fix.
  - **Fix:** None on the backend. Optionally confirm `POST /track/:token/orders` ignores the
    client's price and re-prices from the `Part` model (it does — items carry only
    `partId`+`quantity`).
  - **Frontend part:** `frontend-eaz/tasks.md` → T41.

- [ ] **T39 · Product detail tabs (Description / Reviews) — no backend change**
  - **Issue:** The frontend product detail page (`/shop/[slug]`) should show **tabs** for
    Description and Reviews instead of stacking them as one long page. This is a
    **frontend-only** UI change; no API/model/route work required.
  - **Location:** n/a (backend) — see `frontend-eaz/tasks.md` → T39 for the fix.
  - **Fix:** None on the backend. Verify the endpoints backing the tabs still work:
    `GET /api/v1/products/:slug` (description + specs), `GET /api/v1/products/:productId/reviews`
    (public review list), and the review submit/eligibility routes.

- [ ] **T38 · Cart overlay viewport fit — no backend change**
  - **Issue:** The cart overlay that opens on **Add to Cart** from a product detail page
    (frontend `CartDrawer`) should fit all content within one viewport. This is a
    **frontend-only** layout fix; no API/model/route work required.
  - **Location:** n/a (backend) — see `frontend-eaz/tasks.md` → T38 for the fix.
  - **Fix:** None on the backend. After the frontend drawer change, verify cart flow
    endpoints used from the drawer still work: `POST /api/v1/cart/sync` (if present),
    `GET /api/v1/products`, and checkout `POST /api/v1/orders`.

- [ ] **T37 · POS inventory search: return product images**
  - **Issue:** When the sell page searches with `includeProducts=true`, the shop product
    query does `.select('name sku price stock category')` — **no `images`** — so product
    thumbnails can't render in the sell page results/cart. Parts already return their full
    `images` array (Part model has `images`).
  - **Location:** `controllers/pos/inventoryController.js` (getParts product query ~line 32 —
    add `images` to `.select(...)`); scan lookup (`scanLookup` ~line 74) already returns full
    docs but confirm `images` survives `normalizeProduct`
  - **Fix:** Add `images` to the product `.select(...)` so `GET /pos/inventory?...` returns
    them. `normalizeProduct` spreads the full product, so `images` flows through untouched.
    No model change needed.
  - **Frontend part:** `frontend-eaz/tasks.md` → T37.

- [ ] **T36 · Supplier model: add WhatsApp and WeChat fields**
  - **Issue:** Parts/products are sourced from China — vendors are contacted via **WhatsApp**
    and **WeChat**, not just phone/email. The `Supplier` schema needs fields for both.
  - **Location:** `models/Supplier.js` (add `whatsapp`, `wechat` strings), sanitization +
    validation in `controllers/pos/expenseController.js` (createSupplier/updateSupplier),
    include in `GET /pos/suppliers` + `GET /pos/suppliers/:id` responses (already returned via
    find).
  - **Fix:** Add `whatsapp` (phone, maxlength ~30) and `wechat` (WeChat ID, maxlength ~50)
    optional fields; sanitize like phone (and allow a leading `+`). Frontend renders chat
    links. Keep money/roles unchanged.
  - **Frontend part:** `frontend-eaz/tasks.md` → T36.

- [ ] **T35 · Variant model: support a per-variant price**
  - **Issue:** `Product.variants[]` only has `sku`, `attributes`, `stock`, `images` — no price.
    Variants should support their own price (different sizes/colors/storage cost differently)
    instead of always inheriting the base product price.
  - **Location:** `models/Product.js` (variants schema ~lines 55–66 — add
    `price: { type: Number, min: 0, default: 0 }` in **pesewas**), product create/update
    validation, order line price resolution (variant price wins over base price), shop
    product detail + POS sell
  - **Fix:** Add `price` (pesewas) to the variant schema and accept it in product
    create/update. When an order/sale line references a variant, use the variant price if set
    (else base price). Keep money in integer pesewas.
  - **Frontend part:** `frontend-eaz/tasks.md` → T35.

- [ ] **T34 · Product image upload endpoint already covers local uploads — no backend change**
  - **Issue:** The product form's main images field is URL-only in the UI, but the backend
    upload route (`POST /api/v1/uploads`, Cloudinary) already exists and is used by the form's
    variant/gallery upload buttons. No backend work required for local product image upload.
  - **Location:** `controllers/uploadController.js` (or wherever `/uploads` is handled),
    `routes/uploadRoutes.js`
  - **Fix:** None expected on the backend — verify the upload endpoint accepts `image/*` and
    returns `{ url }`. Frontend change only (see `frontend-eaz/tasks.md` → T34).

- [ ] **T33 · `Part` model + inventory endpoint should support an image**
  - **Issue:** Repair parts have no image field; the inventory form can't attach a photo. Shop
    products already support images (`Product.images`). Parts need the same.
  - **Location:** `models/Part.js`, `controllers/pos/inventoryController.js`,
    upload route (Cloudinary) used by products
  - **Fix:** Add an image field to `Part` (e.g. `image`/`images`), accept it in the inventory
    create/update handlers, and expose it in `GET /pos/inventory` + scan/search responses.
    Frontend part: `frontend-eaz/tasks.md` → T33.

- [ ] **T32 · Scope analytics: staff own report only; admin sees all staff + per-staff activity**
  - **Issue:** `getReportsAnalytics` returns **shop-wide** figures to every role (only
    technicians blocked). Staff must see **only their own** numbers; admin must see **all
    staff** and drill into each staff member's activity.
  - **Location:** `controllers/pos/reportsController.js` (`getReportsAnalytics`),
    `routes/posRoutes.js` (`/pos/reports/analytics`), `controllers/pos/common.js`
  - **Fix:** Accept an optional `staffId` filter (jobs by `assignedTo`/`createdBy`, sales by
    `cashier`, payments, activity). For staff roles, **force** the filter to `req.user._id`
    regardless of the query param (never trust client ids). For admin/superadmin, allow
    selecting a staff member and return a per-staff activity breakdown. Add tests.
  - **Frontend part:** `frontend-eaz/tasks.md` → T32.

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