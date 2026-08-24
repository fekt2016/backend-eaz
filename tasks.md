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

- [x] **T17 · Allow registration with email OR phone number** — ✅ done 2026-08-23 (both
  halves; frontend register form + verify page shipped in `frontend-eaz` on the same
  branch)
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
  - **Shipped (backend half):**
    - **`models/User.js`** — turned out to be a hard prerequisite, not just the schema/
      controller the fix note named: `email` was `required:true, unique:true` at the
      Mongoose level, so `User.create()` would throw a `ValidationError` for a phone-only
      registration regardless of what the controller/Zod schema allowed. Removed
      `required`/field-level `unique`; added a partial-unique index on `email` mirroring
      the existing `phone` pattern (safe to build directly — email was previously
      required+unique, so every existing document already has a distinct value). Added a
      `pre('validate')` guard rejecting a document with neither `email` nor `phone`, as
      defense-in-depth for any other `User.create()` call site.
      (Pre-existing workaround this replaces for *self*-registration: the POS
      staff-create-customer flow in `controllers/pos/customerController.js` already
      handles phone-only accounts today, but via a synthetic
      `${phone}@eazworld.local` email — left untouched, out of scope, still works.)
    - **`validation/authSchema.js`** — `registerSchema.email`/`.phone` both optional via
      `z.preprocess` (blank/whitespace → `undefined`) + `.email().optional()`, with a
      top-level `.refine()` requiring at least one. The preprocess step matters: without
      it, an intentionally-blank `email: ''` (a real value a form posts, not `undefined`)
      fails `z.string().email()`'s format check with "Invalid email" before `.refine()`
      ever runs — so the user gets the wrong error message for "I left email blank on
      purpose." Not wired into a route yet (`register`/`login` both still parse manually,
      pre-existing pattern per CLAUDE.md); kept accurate for whenever it is.
    - **`controllers/authController.js`** (`register`) — accepts either identifier;
      existing-user/phone-taken pre-checks now conditional on the identifier being
      present; verification PIN goes to email (existing `sendVerificationPin`) or SMS (new
      `sendVerificationPinSms`, phone-only), never both.
    - **`controllers/authController.js`** (`verifyPin`, `resendPin`) — necessary follow-on:
      a phone-only registrant has no email to submit to these endpoints, so both now
      accept either identifier via the same `$or` lookup pattern `login` already uses,
      instead of an email-only lookup. `verifyPin`'s post-verify `sendWelcomeEmail` is now
      conditional on the account actually having an email.
    - **`services/notify.js`** — new `sendVerificationPinSms(phone, name, pin)`, mirroring
      the existing `sendCredentialsSms` graceful-degrade pattern (silent no-op if Hubtel
      env vars aren't set — T3f is still blocked/unconfigured in this project — logged in
      dev, silent in prod; never throws to the caller).
    - `tests/registerSchema.test.js` (7 tests, schema-only, no DB) — covers the
      blank-string-vs-undefined trap directly: empty-string email+phone is rejected with
      the refine's message (not `.email()`'s "Invalid email"), a whitespace-only email
      with a real phone passes and normalizes to `undefined`, and a real invalid email
      format is still rejected when actually provided.
    - `tests/registerEmailOrPhone.test.js` (8 tests, full app + in-memory DB) — email-only
      regression, phone-only registration end-to-end, both-missing and both-empty-string
      rejected, two phone-only accounts coexist (partial index), `verify-pin`/`resend-pin`
      by phone for a phone-only account, and a garbage identifier rejected on both
      endpoints.
  - **Verified:** full suite 41 suites / 297 tests pass (up from 39/282 — 2 new files, 15
    new tests); `npm run lint` 0 errors.

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

- [ ] **T45 · Pre-order support for products** — items that are out of stock, or not yet available in Ghana, currently can't be ordered at all (the shop blocks add-to-cart / checkout on zero stock). Add a pre-order capability so customers can place these ahead of availability.
  - **Model (`models/Product.js`):** add a `preorder` sub-object — e.g. `preorder.enabled` (bool), `preorder.availableFrom` (date | null), `preorder.note` (string, e.g. "ships from abroad, ~3 weeks"), and a cap field if pre-order quantity is limited. Decide how this interacts with `stock`/availability so a pre-order-enabled item bypasses the existing "out of stock → can't buy" guard *only when* `preorder.enabled`.
  - **Order flow:** flag pre-order line items on the `Order` so ops can tell them apart from in-stock items, and decide fulfilment/notification when the item actually lands. **Payment decision to make before building:** pay upfront via Paystack (same as a normal order) vs. deposit / pay-on-arrival — money-movement change, so scope explicitly.
  - **Storefront (mirror in `frontend-eaz/tasks.md`):** product card/detail shows a "Pre-order" badge + expected-availability copy instead of "Out of stock"; the add-to-cart button becomes "Pre-order".
  - **Open questions to resolve before building:** upfront payment vs. deposit; per-item pre-order quantity cap; whether a pre-order auto-converts to a normal order once stock arrives; customer comms (SMS/email) when the item becomes available.

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

- [x] **T37 · POS inventory search: return product images** — ✅ done 2026-08-23 (both
  halves)
  - **Issue:** When the sell page searches with `includeProducts=true`, the shop product
    query does `.select('name sku price stock category')` — **no `images`** — so product
    thumbnails can't render in the sell page results/cart. Parts already return their full
    `images` array (Part model has `images`).
  - **Location:** `controllers/pos/inventoryController.js` (getParts product query ~line 32 —
    add `images` to `.select(...)`); scan lookup (`scanLookup` ~line 74) already returns full
    docs but confirm `images` survives `normalizeProduct`
  - **Fix:** Added `images` to the product `.select(...)` so `GET /pos/inventory?...` returns
    them. `normalizeProduct` spreads the full product, so `images` flows through untouched —
    no model change needed. `scanLookup`'s SKU-fallback branch already returns the full
    (unselected) product doc via `normalizeProduct`, so it needed no change.
  - **Tests:** `tests/partImages.test.js` gained a `T37` describe block — a matched product
    returns its `images` array (previously omitted), and a product with none returns `[]`,
    not `undefined`.
  - **Frontend part:** `frontend-eaz/tasks.md` → T37.

- [x] **T36 · Supplier model: add WhatsApp and WeChat fields** — ✅ done 2026-08-23 (both
  halves)
  - **Issue:** Parts/products are sourced from China — vendors are contacted via **WhatsApp**
    and **WeChat**, not just phone/email. The `Supplier` schema needs fields for both.
  - **Location:** `models/Supplier.js` (add `whatsapp`, `wechat` strings), sanitization +
    validation in `controllers/pos/expenseController.js` (createSupplier/updateSupplier),
    include in `GET /pos/suppliers` + `GET /pos/suppliers/:id` responses (already returned via
    find).
  - **Fix:** Added `whatsapp` (maxlength 30) and `wechat` (maxlength 50) optional fields to
    `Supplier`; wired into `createSupplier`/`updateSupplier` (incl. `buildChanges` activity-log
    diffing). `getSuppliers`/`getSupplier` do a plain `.find()`/`.findById()` with no
    `.select()`, so both new fields flow through untouched — no read-side change needed.
  - **Deviated from the fix note's "sanitize like phone":** used `sanitizeText`, not
    `sanitizePhone`. `sanitizePhone` (`utils/sanitize.js`) is Ghana-specific — it strips every
    non-digit character (including a leading `+`) and only accepts a 9/10-digit local number
    or a `233` country code; a China WhatsApp number (`+86138...`) would come out mangled or
    empty. `sanitizeText` just trims/strips tags, which is what the fix note's own "allow a
    leading `+`" actually needs.
  - **Tests:** new `tests/supplierContact.test.js` (4 tests) — create/read/update persist both
    fields, whatsapp keeps its leading `+`, and an unset supplier returns `undefined` for both
    (not empty strings). Full suite: 44 suites/314 tests pass. Lint clean (0 errors).
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

- [x] **T33 · `Part` model + inventory endpoint should support an image** — ✅ done
  2026-08-23 (both halves; frontend upload UI shipped in `frontend-eaz` on the matching
  branch)
  - **Issue:** Repair parts have no image field; the inventory form can't attach a photo. Shop
    products already support images (`Product.images`). Parts need the same.
  - **Location:** `models/Part.js`, `controllers/pos/inventoryController.js`,
    upload route (Cloudinary) used by products
  - **Fix:** Add an image field to `Part` (e.g. `image`/`images`), accept it in the inventory
    create/update handlers, and expose it in `GET /pos/inventory` + scan/search responses.
    Frontend part: `frontend-eaz/tasks.md` → T33.
  - **Found already shipped, not new work:** `Part.images` (schema), `createPart`/
    `updatePart` accepting and persisting it, `GET /pos/inventory` (unrestricted
    `.find()`, no `.select()`), and `GET /track/parts` (`getPublicParts`, explicit
    `.select(...images)`) were all already correct before this task touched anything —
    this fix note pre-dated whatever earlier work actually added the field. No code
    change was needed for any of that; added `tests/partImages.test.js` (5 tests) to lock
    it in, since none existed.
  - **The actual gap found and fixed:** the fix note's own "upload route (Cloudinary) used
    by products" is `POST /api/v1/uploads` (`routes/uploadRoutes.js`) — it was
    `restrictTo('admin')` only, while `createProduct`/`updateProduct`
    (`routes/productRoutes.js`) and `createPart`/`updatePart` are both
    `restrictTo('superadmin','staff','admin')`. This is a **pre-existing bug, not
    introduced here**: `ProductForm.jsx` on the frontend already calls this endpoint
    today, so a staff member using the live product form already gets 403'd trying to
    upload an image, independent of Part work. Confirmed via a full frontend grep that
    this route has exactly one other consumer (`ProductForm.jsx`) — the job-photo upload
    (`usePosJobs.js`) hits a completely separate dedicated route, unaffected — so
    widening this one to `restrictTo('admin', 'staff')` is scoped exactly to its two real
    callers, not a blanket loosening. `tests/uploadRoute.test.js` (6 tests, mocked
    Cloudinary): technician/plain-user still 403, unauthenticated still 401, staff/admin/
    superadmin now 200.
  - **Verified:** full suite 43 suites/308 tests pass (up from 41/297); `npm run lint` 0
    errors.

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