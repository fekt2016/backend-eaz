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

- [x] **T1 · Enforce phone uniqueness for login lookup** ✅ done 2026-08-18
  - **Issue:** `User.phone` was `sparse` but **not unique**, yet `authController.login`
    matches by an `$or` that includes phone → wrong account could be selected if two users
    share a phone. (Email login was already safe — email is unique.)
  - **Impact:** MEDIUM security / auth correctness.
  - **Shipped:**
    - `scripts/checkDuplicatePhones.js` + `npm run check:duplicate-phones` — read-only
      pre-flight audit (groups by canonical form to catch cross-format dupes).
    - `scripts/normalizeUserPhones.js` + `npm run migrate:user-phones` — idempotent
      migration (`--apply` to write): normalizes phones, "keep oldest / clear duplicates",
      and reconciles the index (drops legacy sparse `phone_1`, builds unique-partial).
    - `models/User.js` — removed redundant field-level `sparse`; added
      `{ phone: 1 }` **unique** partial index (`phone` = non-empty string only).
    - `controllers/authController.js` — dup-phone **409** pre-check + race-safe `11000`
      backstop in `register`, `adminCreateUser`, `adminUpdateUser` (update excludes self).
    - `tests/phoneUniqueness.test.js` — 7 tests (register/admin guards, cross-format,
      no-phone accounts allowed, login-by-phone determinism, DB-level index backstop).
  - **Verified:** live audit → "All clear"; live migration applied (1 admin phone
    `+233257563424`→`0257563424`, 0 duplicates); live index confirmed unique-partial;
    backend suite **20 suites / 119 tests pass**.
  - **Follow-up (separate task):** phone numbers are still unverified — uniqueness prevents
    silent dupes but not phone squatting. Real fix is phone OTP (relates to T12/verification).
  - **Source:** AUDIT.md §21 (MEDIUM #1), §29 P1

- [ ] **T2 · Restock inventory on order/repair cancellation**
  - **Issue:** Cancelling a paid order/job (`status → cancelled`) does **not** return the
    stock that was decremented at fulfilment → inventory drifts.
  - **Impact:** MEDIUM data integrity (stock counts wrong over time).
  - **Location:** `controllers/orderController.js` (`updateOrderStatus`),
    `utils/fulfilShopOrder.js`, repair job cancel path
  - **Fix:** On transition to `cancelled` for an order/job that was already decremented,
    guardedly re-increment `Part.quantity` / `Product.stock` / variant stock. Flag to avoid
    double-restock. Add a test.
  - **Source:** AUDIT.md §23, §24 (#5), §29 P1

- [ ] **T3 · Live E2E verification of external-service flows (the 🟣 items)**
  - **Issue:** 28 features have complete, correct-looking code but were **not** run against
    live third parties in the audit. Logic around them is test-backed; the round-trips are not.
  - **Impact:** Unknown until exercised; these are core revenue/ops paths.
  - **Sub-tasks (run each in sandbox, record result):**
    - [ ] T3a · Paystack card + Mobile Money charge (shop, repair, domain, hosting, service)
    - [ ] T3b · Paystack webhook delivery end-to-end (signature + fulfilment)
    - [ ] T3c · WHM/CyberPanel hosting provisioning + suspend/terminate/renew/cpanel-login
    - [ ] T3d · Namecheap domain search + registration + retry
    - [ ] T3e · Cloudinary image/video + repair-job photo upload
    - [ ] T3f · Hubtel SMS + Resend email (repair status, verify PIN, password reset, 2FA)
  - **Location:** `services/*`, `controllers/*` charge/upload handlers
  - **Source:** AUDIT.md §13, §19, §28, §29 P1 (all 🟣 rows in §4)

---

## P2 — Improvements

- [ ] **T5 · Confirm/align Expenses role model**
  - **Issue:** Expense read = `('superadmin','staff')`, write = `('superadmin')` — `admin`
    is omitted (superadmin still passes via implicit override). Inconsistent with the
    otherwise admin-inclusive pattern. Not a security hole (more restrictive).
  - **Location:** `routes/posRoutes.js`
  - **Fix:** Confirm intent with product owner; add `admin` if it was an oversight.
  - **Source:** AUDIT.md §7 note, §23

- [ ] **T6 · Move hardcoded business config into Settings/env**
  - **Issue:** Shop name/phone, service price list, and contact info are hardcoded.
  - **Location:** `controllers/chatController.js` (`KNOWLEDGE`),
    `services/notify.js` (`SHOP_NAME`/`SHOP_PHONE`/pricing copy)
  - **Fix:** Extend `Settings` model (business profile) or env; read from there.
  - **Source:** AUDIT.md §24 (#3), §26, §27 (#6)

- [ ] **T8 · Rename misleading `*Ghs` money fields → `*Pesewas`**
  - **Issue:** Post money-migration, fields like `unitPriceGhs`/`amountGhs` now carry
    pesewas — accurate values, misleading names.
  - **Location:** POS models/controllers (`PartOrder`, `RepairOrder`, related handlers)
  - **Fix:** Rename in a coordinated migration (fields + all readers/writers). Behavior-
    preserving.
  - **Source:** AUDIT.md §27 (#4)

- [ ] **T10 · Add backend lint tooling (optional)**
  - **Issue:** No ESLint/lint script on the backend (plain JS by design).
  - **Location:** `backend-eaz`
  - **Fix:** Add an ESLint config + `lint` script matching the CommonJS style.
  - **Source:** AUDIT.md §27 (#7), §28

- [ ] **T11 · Refresh dependency vulnerability audit**
  - **Issue:** The stale `AUDIT_REPORT.md` lists CVEs for packages no longer in the project
    (Vite, react-router, styled-components). A fresh audit is needed against the *current*
    dependency set.
  - **Location:** both apps
  - **Fix:** Run `npm audit` in `backend-eaz` and `frontend-eaz`, triage results, apply
    non-breaking fixes. (New action — do not copy the old CVE list.)
  - **Source:** supersedes AUDIT_REPORT.md "Security Vulnerabilities"

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

- [ ] **T12 · In-app notifications / alert center** — no model/API/UI (only SMS + email exist). — AUDIT.md §24 (#1)
- [ ] **T13 · AI chat responses** — `getAIResponse` is a stub returning `null`; only rule-based replies today. — AUDIT.md §23, §24 (#2)
- [ ] **T14 · General business settings** — `Settings` holds only maintenance fields (no shop profile, tax/VAT, currency, hours). — AUDIT.md §24 (#3)
- [ ] **T15 · Refunds** — no refund endpoint or Paystack refund call anywhere. — AUDIT.md §24 (#4)

---

## Ad-hoc fixes (found during work, outside the original audit)

- [ ] **T19 · "Customer will bring device in" → "Device received" when diagnosing starts**
  - **Issue:** Once a repair job leaves the `received` stage, the customer/device card label
    should read "Device received" instead of the dropoff-based "Customer will bring device in".
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/pos/jobs/[id]/_components/CustomerDeviceCard.jsx`
  - **Fix:** Frontend-only display change keyed off `job.status`; **no backend change required**
    (see `frontend-eaz/tasks.md` → T19).

- [ ] **T45 · `expenseController`: unescaped supplier regex + no activity logs**
  - **Issue:** `getSuppliers` uses `{ $regex: q }` with no `escapeRegex` (vs.
    `customerController.getCustomers` which escapes it) — a `q` with regex metacharacters
    can match unintended rows. Also `createExpense`, `updateExpense`, `deleteExpense`,
    supplier create/update/delete never call `logFromRequest`, so POS expense/supplier
    mutations are invisible in activity logs (unlike customer/job mutations).
  - **Location:** `controllers/pos/expenseController.js` (supplier search ~lines 88–92;
    no `logFromRequest` anywhere in the file).
  - **Fix:** Use `escapeRegex(q)` in the supplier `$or`, and add `logFromRequest` entries
    for expense + supplier mutations (actions `EXPENSE_CREATED`/`UPDATED`/`DELETED`,
    `SUPPLIER_CREATED`/`UPDATED`/`DELETED` — add to `services/activityLogService.js` if
    the ACTIONS enum lacks them).
  - **Frontend part:** n/a.

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

- [ ] **T40 · `authController.logout` calls `jwt.decode` but never imports `jsonwebtoken`**
  - **Issue:** `logout()` (line ~283) runs `jwt.decode(token)` to resolve the actor identity
    for the activity log, but `jsonwebtoken` is **not required** in `authController.js`. The
    ReferenceError is swallowed by the surrounding try/catch, so logout "works" — but the
    actor is always `null` and the logout activity entry never records who logged out.
  - **Location:** `controllers/authController.js` (imports lines 1–6; logout ~lines 276–303).
  - **Fix:** Add `const jwt = require('jsonwebtoken');` to the imports (verified: no other
    `jwt` reference exists in the file). Optionally add a test asserting logout logs the
    actor identity when a valid token cookie is present.
  - **Frontend part:** n/a.

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

- [ ] **T31 · `createSale` must support shop products (accessories) too**
  - **Issue:** The POS Sell page should sell **both** repair parts **and** shop
    products/accessories. `createSale` already branches on `partId` vs `productId` — confirm
    the product path works (stock check, `$inc`, `Sale.create`) and doesn't hit the T30 500.
  - **Location:** `controllers/pos/salesController.js` (`createSale` product branch),
    `models/Sale.js`, `routes/posRoutes.js` (`/pos/inventory` `includeProducts`)
  - **Fix:** Verify products complete a sale correctly; add tests for a product-only sale and a
    mixed parts+products sale. Frontend part: `frontend-eaz/tasks.md` → T31.

- [ ] **T30 · POS sale `createSale` 500 when selling parts**
  - **Symptom:** Completing a sale from the POS Sell page with parts in the cart returns a
    **500** on **all payment options** (Cash/MoMo/Card); no sale is recorded.
  - **Location:** `controllers/pos/salesController.js` (`createSale`), `models/Sale.js`
  - **Fix (investigate):**
    - Reproduce and capture the real server error (check logs — the 500 hides the root cause).
    - Likely candidates: `res.status(201).json({ data: sale })` returns the **array** from
      `Sale.create([...])` instead of a single object; `saleNumber`/pre-save hooks; a `part`
      schema validation issue; transaction/abort mishandling.
    - Add a regression test for selling a repair part via `POST /api/v1/pos/sales`.
  - **Frontend part:** `frontend-eaz/tasks.md` → T30.

- [ ] **T29 · Role-based landing pages after login**
  - **Issue:** The frontend currently redirects admin/superadmin to `/dashboard/pos` /
    `/dashboard/pos/sell` after login instead of the Overview page.
  - **Fix (frontend):** admin/superadmin → **Overview** (`/dashboard`); staff → **Sell**
    (`/dashboard/pos/sell`); technician → `/dashboard/pos`; customer → `/`. Apply also after
    email/2FA verification.
  - **Location:** frontend — `frontend-eaz/src/app/auth/login/page.jsx`
  - **Note:** frontend-only redirect change; **no backend change required** (see
    `frontend-eaz/tasks.md` → T29).

- [ ] **T28 · Admin order edits centralized on the detail page**
  - **Issue:** The frontend admin orders list has inline status updates; all order editing
    should live on the order detail page. The POS orders list also uses card layout and should
    become a table.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/orders/page.jsx`,
    `frontend-eaz/src/app/dashboard/orders/[id]/page.jsx`,
    `frontend-eaz/src/app/dashboard/pos/orders/page.jsx` (card → table)
  - **Fix:** Frontend-only reorganization — make the list read-only with links to the detail
    page where all updates happen, and convert the POS orders cards to a table; **no backend
    change required** (see `frontend-eaz/tasks.md` → T28).

- [ ] **T27 · Confirm product-review endpoints ready for order-page form**
  - **Issue:** The customer order detail page needs a product review form. The backend
    endpoints already exist (`POST /api/v1/products/:productId/reviews`, `GET/PATCH
    …/reviews/mine`) — confirm they work for a product bought in an order and gate review
    submission to customers who actually ordered the item (optional).
  - **Location:** `routes/productRoutes.js`, `controllers/productReviewController.js`,
    `models/ProductReview.js`
  - **Fix:** Verify/complete review endpoints; optionally require a verified order of that
    product before allowing a review. Frontend form lives in `frontend-eaz/tasks.md` → T27.

- [ ] **T26 · Endpoint for the list of registered domains**
  - **Issue:** The frontend Domains page needs to show the list of **registered domains**
    (names the user owns + status/expiry), not just domain order records.
  - **Location:** `routes/domainRoutes.js`, `controllers/domainController.js`,
    `models/DomainOrder.js`
  - **Fix:** Add a registered-domains endpoint (e.g. `GET /api/v1/domains/my` returning owned/
    registered domains with name, status, expiry) or return registered-domain data from the
    existing orders endpoint. Frontend wiring lives in `frontend-eaz/tasks.md` → T26.

- [ ] **T25 · Hosting page should only show hosting-account related content**
  - **Issue:** The frontend Hosting page mixes content not strictly related to the user's
    hosting account(s).
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/hosting/page.jsx`
  - **Fix:** Frontend-only cleanup of the hosting list/detail pages to show only hosting-account
    content; **no backend change required** (see `frontend-eaz/tasks.md` → T25). Confirm the
    hosting API responses only return hosting-order data.

- [ ] **T24 · Merge "Marketplace" and "Inventory" into one page**
  - **Issue:** The frontend has separate Marketplace and Inventory pages that should be one.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/commerce/page.jsx`,
    `frontend-eaz/src/app/dashboard/commerce/inventory/page.jsx`
  - **Fix:** Primarily a frontend merge (see `frontend-eaz/tasks.md` → T24). Confirm no
    backend endpoint change is needed (both views likely share `/api/v1/products`,
    `/api/v1/inventory`).

- [ ] **T23 · Remove "New Job" button from Overview dashboard**
  - **Issue:** The frontend Overview page (`/dashboard`) shows a "New Job" button that should
    not be there; creating a repair job belongs in the POS/Jobs area.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/page.jsx`
  - **Fix:** Frontend-only removal of the Overview "New Job" button and empty-state create link;
    **no backend change required** (see `frontend-eaz/tasks.md` → T23).

- [ ] **T22 · Integrate "My Repairs" and "My Jobs" into one page**
  - **Issue:** Two overlapping views of repair jobs exist — customer "My Repairs"
    (`/dashboard/repairs`, `useMyRepairs`) and technician "My Jobs" (`/dashboard/pos`,
    `useJobs`). They should be one integrated page.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/repairs/page.jsx`,
    `frontend-eaz/src/app/dashboard/pos/page.jsx`
  - **Fix:** Primarily a frontend merge (see `frontend-eaz/tasks.md` → T22). Confirm the backend
    endpoints backing each (`GET /api/v1/pos/jobs?assignedTo=me` vs the repairs endpoint) and
    whether a single unified endpoint/hook is needed.

- [ ] **T21 · Technicians have NO hosting/domain access — backend + audit**
  - **Issue:** Technicians must have **zero** access to anything hosting- or domain-related.
    Confirm the backend routes (`/api/v1/hosting/*`, `/api/v1/domains/*`) return 401/403 for
    technicians, and that no technician-facing endpoint leaks hosting/domain data.
  - **Location:** `routes/hostingRoutes.js`, `routes/domainRoutes.js`, `controllers/*`
  - **Fix:** Audit and enforce role guards on every hosting/domain endpoint; add
    `restrictTo('admin')`/staff where missing. Frontend nav/widget hiding for technicians
    lives in `frontend-eaz/tasks.md` → T21.

- [ ] **T20 · Hide repair/technician form when job is done or cancelled**
  - **Issue:** The Technician Update + Parts forms on the repair job detail page remain editable
    after the job is finished or cancelled.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/pos/jobs/[id]/page.jsx`
  - **Fix:** Frontend-only change — hide/make read-only for `ready`/`collected`/`cancelled`;
    **no backend change required** (see `frontend-eaz/tasks.md` → T20).

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