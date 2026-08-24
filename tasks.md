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

- [x] **T46 · Sales endpoints: scope by cashier + per-staff summary** — ✅ done 2026-08-24 (both halves)
  - **Request:** back the Sell page's per-staff sales section (see
    `frontend-eaz/tasks.md` → T46).
  - **Found while implementing — this was also an access-control gap.** `GET /pos/sales`
    had no `restrictTo` and no cashier scoping, so **any authenticated POS user could
    list every cashier's sales**, and `GET /pos/sales/:id` would open any sale by id.
  - **Shipped:** `controllers/pos/salesController.js`, `routes/posRoutes.js`
    - `getSales` scopes to `req.user._id` for everyone except admin/superadmin. The
      scope comes from `req.user`, never from the query string, so a staff member
      passing `?cashierId=` cannot widen it. Admins may use `?cashierId=` to filter,
      validated as an ObjectId.
    - `getSale` applies the same rule, returning **404 rather than 403** so the endpoint
      does not confirm that another cashier's sale id exists.
    - `page`/`limit` are now clamped (limit max 100). They were unbounded, so one
      request could pull the entire sales history into a 512MB heap.
    - Search terms go through `escapeRegex` — they were interpolated raw into `$regex`.
    - New `GET /pos/sales/summary`: own totals (all-time + today) for every role, plus a
      per-cashier `byStaff` aggregate for admin/superadmin. A sale whose cashier account
      was deleted still counts, labelled "Unknown", rather than vanishing from the totals.
    - The summary route is registered **before** `/sales/:id`, or Express would match
      "summary" as an id.
    - `tests/salesScoping.test.js` (new, 16 tests) covering the scoping, the
      cannot-widen case, admin filtering, the 404-not-403 behaviour, voided exclusion,
      the limit clamp, and every summary shape.
  - **Frontend part:** `frontend-eaz/tasks.md` → T46.
  - **Verified:** full backend suite 50 suites / 382 tests, exit 0; no new lint warnings
    (salesController went 37 → 36).

- [ ] **T47 · `Sale.saleNumber` collides when two cashiers check out at once**
  - **Issue:** `models/Sale.js`'s pre-save hook builds the sale number from a document
    count: `const count = await mongoose.model('Sale').countDocuments()` then
    `SAL-YYYYMM-{count+1}`. Two concurrent creates read the same count, generate the
    same number, and the unique index rejects one with
    `E11000 duplicate key error ... saleNumber_1`. The losing cashier gets a 500 and the
    sale is not recorded.
  - **Reproduced 2026-08-24** while writing T46's tests: three sequential creates
    succeed (`SAL-202608-00001..3`); three concurrent creates produce two successes and
    one E11000. The window is the whole `countDocuments()` round-trip, so this is not a
    narrow race — two cashiers ringing up at the same moment is enough.
  - **Also wrong regardless of the race:** the count includes voided sales but a voided
    sale keeps its number, and any future delete would cause reuse.
  - **Fix (suggested):** replace the count with an atomic per-month counter
    (`findOneAndUpdate` with `$inc` and `upsert` on a small counters collection), or
    retry on E11000. Note the hook runs inside `createSale`'s transaction, so the
    counter write must join the same session.
  - **Frontend part:** none — surfaces as the same "Sale failed" error T30 added.

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

- [x] **T42 · `BlogArticle` renders markdown via `dangerouslySetInnerHTML` — stored-XSS risk** — ✅ done 2026-08-24 (both halves)
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
  - **Finding — the existing sanitiser was weaker than the task assumed.** `createPost`
    and `updatePost` already ran `sanitizeMessage(content, 50000)`, so this looked done.
    It was not: that function removed whole `<script>…</script>` blocks and the literal
    string `javascript:` in a **single pass**, and every one of these got through —
    verified against the old code before changing it:
    - `<img src=x onerror=alert(1)>`, `<svg onload=…>`, `<iframe>`, `<body onload=…>`
      — event handlers and dangerous tags were never considered at all.
    - `<scr<script></script>ipt>alert(1)</script>` — the single pass *built* the
      payload: deleting the inner `<script></script>` let the outer fragments close up
      into a live `<script>alert(1)</script>`.
    - `javasjavascript:cript:alert(1)` — same reconstruction trick on the scheme.
    - `java<TAB>script:alert(1)` — browsers strip tab/newline from inside a URL before
      parsing the scheme, so this executes.
  - **Shipped:**
    - `utils/sanitize.js` — new `stripExecutableMarkup()` behind `sanitizeMessage`.
      Removes script blocks, dangerous tags (`iframe`/`object`/`embed`/`style`/`link`/
      `meta`/`base`/`form`/`svg`/`math`), inline `on*=` handlers, and executable URL
      schemes. It loops to a fixed point rather than passing once, which is what closes
      the reconstruction bypasses; each pass only deletes, so it terminates (with a
      10-iteration cap as belt-and-braces).
    - Scheme names are matched tolerating control characters between letters, so
      `java<TAB>script:` is caught. Only control characters are allowed in those gaps —
      not spaces — so ordinary prose like "Java Script: a book review" is untouched.
    - `data:` is stripped only for `text/html` and `image/svg+xml`; a legitimate
      `data:image/png` survives.
    - Input is truncated to `maxLen` **before** stripping, so a hostile payload cannot
      make the loop do more work than necessary.
    - **This hardening reaches more than blog posts:** `sanitizeMessage` is also used by
      `chatController` (chat messages), `reviewController` (product reviews) and
      `contactController` (contact form) — all user-submitted, all previously exposed to
      the same bypasses.
    - `tests/sanitizeRichText.test.js` (new, 22 tests): 11 payloads asserted inert, 6
      legitimate inputs asserted byte-identical, plus create/update route tests proving
      nothing executable is persisted. Detection normalises control characters the way a
      browser does, so an obfuscated scheme cannot pass the assertion either.
  - **Frontend part:** `frontend-eaz/tasks.md` → T42.

- [x] **T41 · Public track page part-order cart mixes float-GHS and pesewas** — ✅ done 2026-08-24
  - **Issue:** On the `/track/:token` page, `addToCart` stores `unitPriceGhs: sellingPrice / 100`
    (float GHS) then recomputes `totalPesewas = partsSubtotalGhs * 100 + shippingPesewas`
    (float × 100), while `addPartToShopCart` stores integer pesewas directly. Two cart paths,
    two money conventions — float-rounding risk and inconsistent with the pesewas rule.
  - **Location:** backend side n/a (server recomputes totals from the Part price; the cart
    money is client-local) — see `frontend-eaz/tasks.md` → T41 for the fix.
  - **Fix:** None on the backend. Optionally confirm `POST /track/:token/orders` ignores the
    client's price and re-prices from the `Part` model (it does — items carry only
    `partId`+`quantity`).
  - **Outcome — confirmed frontend-only, and the optional check was actually done.**
    `controllers/pos/jobController.js` → `createRepairOrder` (mounted at
    `POST /api/v1/track/:token/orders`) destructures only `items, shippingZoneId, name,
    phone, email` from the body, and for each item reads just `it.partId` and
    `it.quantity` (clamped 1–10). Unit price comes from `Part.sellingPrice` via
    `Part.findById`, shipping from `DeliveryZone.fee`; `subtotalPesewas` and
    `totalPesewas` are computed server-side from those. **No client-supplied price is
    read anywhere in the handler**, so the frontend's float-vs-pesewas confusion could
    never have affected what a customer was charged — it was a display bug only.
    Stock is also re-checked against `part.quantity` before the order is accepted.
  - No backend code changed.
  - **Frontend part:** `frontend-eaz/tasks.md` → T41.

- [x] **T39 · Product detail tabs + `shortDescription` field** — ✅ done 2026-08-24 (both halves)
  - **Issue:** The frontend product detail page (`/shop/[slug]`) should show **tabs** for
    Description and Reviews instead of stacking them as one long page.
  - **Originally filed as frontend-only** ("no API/model/route work required"). That turned
    out to be wrong: with the full description moved behind a tab, the buy column needed a
    short summary of its own, and the decision was that it should be a real editor-authored
    field rather than text derived on the client. So this grew a backend half.
  - **Shipped:**
    - `models/Product.js` — new optional `shortDescription` (String, trimmed, `maxlength:
      200`, defaults to `""`). Optional by design: every product that predates the field
      stays valid, and the storefront falls back to summarising `description`.
    - `controllers/productController.js` — `createProduct` destructures its fields
      explicitly, so `shortDescription` had to be added there and passed to
      `Product.create`. `updateProduct` spreads `req.body`, so it needed no change —
      mongoose drops unknown keys, and the field flows through once it is on the schema.
    - **No projection changes needed:** `productController` has no `.select()` anywhere,
      so the new field is already returned by both the list and detail endpoints.
    - `tests/productShortDescription.test.js` (new, 5 tests): persists on create, defaults
      to `""` when omitted, updates without clobbering `description`, rejects >200 chars
      with a 400, and is present on the public `GET /api/v1/products/:slug` the page reads.
  - **Note:** retail parts surface in the catalogue under a synthetic `part-<id>` slug and
    resolve to a `Part`, which has no `shortDescription` — those fall back to the derived
    summary on the client. Giving `Part` its own field was left out of scope.
  - **Verified:** full backend suite passes; `eslint` clean on the changed files.

- [x] **T38 · Cart overlay viewport fit — no backend change** — ✅ done 2026-08-24
  - **Issue:** The cart overlay that opens on **Add to Cart** from a product detail page
    (frontend `CartDrawer`) should fit all content within one viewport. This is a
    **frontend-only** layout fix; no API/model/route work required.
  - **Location:** n/a (backend) — see `frontend-eaz/tasks.md` → T38 for the fix.
  - **Fix:** None on the backend. After the frontend drawer change, verify cart flow
    endpoints used from the drawer still work: `POST /api/v1/cart/sync` (if present),
    `GET /api/v1/products`, and checkout `POST /api/v1/orders`.
  - **Outcome:** confirmed frontend-only — the fix was a CSS flexbox correction in
    `CartDrawer.jsx` (a missing `min-h-0`), touching no API. No backend code changed.
    The cart-flow endpoints named above are unaffected and still covered by the
    existing suite (48 suites / 344 tests green).

- [x] **T35 · Variant model: support a per-variant price** — ✅ done 2026-08-24
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
  - **Shipped:** deviated from the fix note's suggested `default: 0` — used `default: null`
    instead, since `0` is a valid legitimate "free variant" price and would be indistinguishable
    from "unset" under a truthy-check fallback. Resolution in `orderController.createOrder` is
    `variant.price != null ? variant.price : product.price` (nullish check, not `||`). Scoped to
    shop checkout only — POS sell (`salesController.js`) has no variant-selection mechanism at
    all today (confirmed: no `variant.sku` lookup, no variant field in the POS cart payload), so
    there's nothing to resolve there yet; adding POS variant selection was treated as out of
    scope for this task. 3 new tests in `variants.test.js` (variant price wins, unset falls back
    to base price, explicit 0 stays free) — 44 suites/317 tests pass.

- [x] **T34 · Product image upload endpoint already covers local uploads — no backend change** — ✅ done 2026-08-24
  - **Issue:** The product form's main images field is URL-only in the UI, but the backend
    upload route (`POST /api/v1/uploads`, Cloudinary) already exists and is used by the form's
    variant/gallery upload buttons. No backend work required for local product image upload.
  - **Location:** `controllers/uploadController.js` (or wherever `/uploads` is handled),
    `routes/uploadRoutes.js`
  - **Fix:** None expected on the backend — verify the upload endpoint accepts `image/*` and
    returns `{ url }`. Frontend change only (see `frontend-eaz/tasks.md` → T34).
  - **Confirmed:** no backend change needed — frontend's `ProductForm.jsx` now reuses the same
    `UploadButton` → `POST /uploads` → `{ url }` flow already exercised by the variant/gallery
    fields; see `frontend-eaz/tasks.md` → T34 for what shipped.

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