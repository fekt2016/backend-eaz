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

- [x] **T18 · Backend guard: reject `cancelled` from `ready` repair jobs** — ✅ done 2026-08-25
  - **Issue:** Frontend hides "Cancel Job" once a job is `ready` (see
    `frontend-eaz/tasks.md` → T18). For parity, the backend status-transition guard should
    also reject a transition from `ready` → `cancelled`.
  - **Location:** POS repair job controller (status update handler)
  - **Fix:** Add a guard so a `ready`/`collected` job cannot be transitioned to `cancelled`;
    return a friendly 400. Add a test.
  - **Found already implemented** — this was absorbed into T53's forward-only transition
    work and the checkbox here was simply never ticked. `canTransitionJobStatus` in
    `controllers/pos/common.js` carries the rule explicitly:
    - line 81 — `if (to === 'cancelled') return from !== 'ready';  // T18 guard`
    - line 80 — `collected`/`cancelled` are terminal, which is what blocks
      `collected → cancelled`.
    `jobController.js:353` is the single gate in front of the only line that writes a
    client-supplied status (`:356`), returning
    `400 Cannot change status from ready to cancelled.`
  - **Checked for bypasses:** the only other writes to a repair job's status are
    `webhookController.js:599,657`, which set `waiting_for_parts` on payment and never
    cancel. `orderController.js:711` (`claimed.status = 'cancelled'`) is a **shop Order**,
    not a RepairJob. So the guard has no way around it.
  - **Gap closed:** T18 names `ready`/`collected`, but only `ready → cancelled` was
    tested — the `collected` cases exercised `received` and `repairing`, so the exact
    transition the task names was never asserted for `collected`. Added
    `rejects collected -> cancelled (T18)` to `tests/jobStatusTransition.test.js`
    (12 tests there now), pinning the transition rather than trusting that the terminal
    rule and the ready rule happen to cover it between them.
  - **Frontend half already shipped:** the Cancel Job button is hidden once a job is
    `ready` and confirmed via a modal, covered by
    `src/app/dashboard/pos/jobs/[id]/page.test.jsx`.

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

- [x] **T47 · `Sale.saleNumber` collides when two cashiers check out at once** — ✅ done 2026-08-24
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
  - **Shipped:** `models/Counter.js` (new), `models/Sale.js`, `controllers/pos/salesController.js`
    - `Counter` is a small `{ _id: String, seq: Number }` collection keyed per period
      (`sale:202608`). `Counter.next(key, session)` is a single `findOneAndUpdate`
      `$inc`, so the number is issued atomically instead of read-modify-write.
    - The pre-save hook passes `this.$session()` into it — **verified that a document
      created via `Sale.create([...], { session })` really does expose the transaction's
      session inside the hook.** So the counter and the sale commit together, and an
      aborted sale rolls its number back rather than burning it.
    - Numbering is now genuinely per-month: a new month starts at `00001`. Within the
      current month it continues from wherever the old scheme left off — the counter
      row is seeded from the highest `SAL-<period>-` number already issued
      (`Sale.ensureNumberCounter`), so no existing number can be handed out twice.
      **No migration needed**: the counter is created lazily on the first sale.
    - `ensureNumberCounter()` runs in `createSale` **before** the transaction opens.
      That placement is the point: two transactions upserting the same *missing*
      counter row race into an E11000, and `withTransaction` will not retry it (a
      duplicate-key error carries no `TransientTransactionError` label). With the row
      already there, concurrent `$inc`s collide as `WriteConflict`, which *is* labelled
      transient and so retries on its own.
    - The hook also skips any document that already has a `saleNumber`, so a caller
      can supply one (the legacy-seeding test does) without it being overwritten.
  - **Tests:** 5 added to `tests/posSale.test.js` (which already runs on a replica set).
    The API-level 5-concurrent-checkout test **passes even against the old code** —
    auth and body parsing stagger the requests enough to hide the race — so there is
    also a model-level test that opens six transactions at once, which reproduced the
    exact `E11000 ... saleNumber_1` before the fix. Plus: number format/sequence, no
    reuse after a delete, and continuation from a pre-counter number.
  - **Verified:** full backend suite 50 suites / 389 tests, exit 0; `posSale.test.js` run
    3× back to back with no flakes; no new lint warnings (the new files are clean,
    `salesController` stays at its existing 36).
  - **Frontend part:** none — surfaced as the same "Sale failed" error T30 added.

- [ ] **T45 · Pre-order support for products** — items that are out of stock, or not yet available in Ghana, currently can't be ordered at all (the shop blocks add-to-cart / checkout on zero stock). Add a pre-order capability so customers can place these ahead of availability.
  - **Model (`models/Product.js`):** add a `preorder` sub-object — e.g. `preorder.enabled` (bool), `preorder.availableFrom` (date | null), `preorder.note` (string, e.g. "ships from abroad, ~3 weeks"), and a cap field if pre-order quantity is limited. Decide how this interacts with `stock`/availability so a pre-order-enabled item bypasses the existing "out of stock → can't buy" guard *only when* `preorder.enabled`.
  - **Order flow:** flag pre-order line items on the `Order` so ops can tell them apart from in-stock items, and decide fulfilment/notification when the item actually lands. **Payment decision to make before building:** pay upfront via Paystack (same as a normal order) vs. deposit / pay-on-arrival — money-movement change, so scope explicitly.
  - **Storefront (mirror in `frontend-eaz/tasks.md`):** product card/detail shows a "Pre-order" badge + expected-availability copy instead of "Out of stock"; the add-to-cart button becomes "Pre-order".
  - **Open questions to resolve before building:** upfront payment vs. deposit; per-item pre-order quantity cap; whether a pre-order auto-converts to a normal order once stock arrives; customer comms (SMS/email) when the item becomes available.

- [x] **T48 · Product popularity metrics: view count + sold count** — ✅ done 2026-08-24 (both halves)
  - **Request:** product cards should show how many times a product has been **viewed**
    and how many units have been **sold**; the product detail page should show the
    live **stock count** and **sold count**. Backend half — schema fields, counters,
    and API exposure (storefront half: `frontend-eaz/tasks.md` → T48).
  - **Current state:** `models/Product.js` has no `views` or `sold` fields. Stock
    exists (`stock` top-level + per-variant) but nothing tracks cumulative sales or
    detail-page traffic.
  - **Schema (`models/Product.js`):** add `views: { type: Number, default: 0 }` and
    `sold: { type: Number, default: 0 }`, both `min: 0`. Existing products default to
    0 without migration.
  - **Views (`controllers/productController.js`):** increment `views` atomically when
    the public `GET /api/v1/products/:slug` detail endpoint is read (`$inc`, not
    read-modify-write — concurrent readers must not clobber each other). Do **not**
    count list-endpoint reads. Decide whether admin/staff requests (JWT present)
    should be excluded so staff previews don't inflate the count; simplest correct
    version counts every public detail fetch and never trusts a client-supplied count.
  - **Sold (`utils/fulfilShopOrder.js`):** `sold` must be incremented in the same
    place stock is decremented on payment — `fulfilShopOrder`'s `$inc` — so it stays
    idempotent with the existing `stockDeducted` guard (no double-count on webhook
    retries) and reverses correctly in `restockOrderItems` if an order is
    cancelled/refunded after fulfilment. Sum quantities across order line items for
    that product.
  - **Decision needed:** whether in-store POS sales of products
    (`controllers/pos/salesController.js`, items sent as `productId`) should also
    bump `sold`. Recommend yes (it's real demand), implemented in the same `$inc`
    that already deducts product stock there.
  - **API exposure:** ~~`productController` has no `.select()` projections (confirmed in
    T39), so once the fields are on the schema they flow through list + detail
    automatically.~~ **This was wrong, and it shipped wrong.** `getProducts` builds its
    response with an aggregation carrying an explicit `$project`, so a new schema field
    does *not* reach the client for free — list rows came back with no `views`/`sold` at
    all and the homepage cards had nothing to render. Fixed by naming both in the
    `$project`, with `$ifNull` → 0 because an aggregation applies no schema defaults and
    products predating T48 have no such key stored. Retail parts (the `$unionWith`
    branch) deliberately get neither field: they have no view tracking, and absent reads
    as "not tracked" on the card rather than as "0 views". Keep both out of any admin
    create/update payload parsing so they can only change via the counters, not client
    input.
  - **Decisions taken:** POS sales **do** count toward `sold` (the spec's own
    recommendation — an over-the-counter sale is real demand), and **every** public
    detail fetch counts as a view. Staff previews are not excluded, because
    `GET /products/:slug` is mounted with no auth middleware at all — there is no
    `req.user` on that route to exclude by, and adding one to serve a counter would
    be the wrong trade.
  - **Shipped:** `models/Product.js`, `controllers/productController.js`,
    `utils/fulfilShopOrder.js`, `controllers/pos/salesController.js`
    - `views` / `sold` added with `default: 0`, so existing products need no migration.
      `min: 0` on both is documentation, not enforcement: `$inc` is a raw update and
      skips validators — the clamp lives in `Product.decrementSold`.
    - ~~The detail read is now one `findOneAndUpdate` with `$inc: { views: 1 }`.~~
      **Replaced same day — counting on the GET counted fetches, not visitors.**
      See the "views are recorded by the browser" follow-up below.
    - `sold` rides on the *same* update that deducts stock, in all three places
      (plain line, variant line, POS sale). That is what keeps it honest: it inherits
      `fulfilShopOrder`'s pending→paid idempotence so a Paystack retry cannot
      double-count, and a line that fails the no-oversell guard is not counted as sold.
      Variant lines count against the parent product — `sold` is product-level.
    - `Product.decrementSold(id, qty, session)` reverses it on cancel/restock and on a
      POS void. It is a **pipeline update** (`$max: [0, …]`) rather than a plain
      `$inc: -qty` for a specific reason: orders paid *before* this shipped deducted
      stock without ever bumping `sold`, so cancelling one of those now would drive
      the counter negative.
    - `createProduct`/`updateProduct` destructure named fields, so neither counter can
      be set from a client payload — verified with a test that posts `views: 9999`.
  - **Tests:** `tests/productPopularity.test.js` (new, 12) — defaults, the admin
    payload being ignored, one view per detail read, 8 concurrent readers all counted,
    list reads not counted, a 404 not counted, sold on fulfil, no double-count on
    webhook retry, variant lines, no count when the stock guard fails, restock
    reversal, and the clamp for a pre-T48 order. Plus 3 in `tests/posSale.test.js`
    (replica set) for the POS sale, the void reversal, and parts not counting.
  - **Follow-up (same day) — views are recorded by the browser, not by the fetch.**
    Counting inside `GET /products/:slug` was wrong in both directions:
    - **Over-counted a real visit ~3x.** `src/app/shop/[slug]/page.jsx` calls
      `getProductBySlug` in `generateMetadata` *and* again in the page component, and
      `lib/products.js` fetches with `cache: "no-store"` so Next dedupes neither. The
      client `ProductDetail` then fetches a third time.
    - **Counted visits nobody made.** Next prefetches `<Link>` targets on hover/viewport,
      which renders the route server-side — so hovering a shop card counted a view.
      Any SEO crawler hitting the page did the same.
    - **Now:** `POST /api/v1/products/:slug/view` (public, new) does the `$inc` and
      returns the new figure; the detail GET is a plain `findOne` again. `ProductDetail`
      posts once after the product renders, guarded by a ref so React's development
      double-mount doesn't count twice, and skips `part-` slugs (parts have no counter).
      Because it takes a script running in a browser, crawlers can no longer inflate it.
      The response's count is what the page displays, so a visitor sees a figure that
      includes their own visit rather than a stale one.
    - **Checked against the running dev stack:** three plain detail GETs left the count
      at 3; one POST took it to 4.
  - **Follow-up (same day):** the list projection above. Two tests now pin it —
    a list row carries `views`/`sold`, and a product with the keys `$unset` still
    reports 0 — so the next field added to this schema fails loudly instead of
    silently missing from every card.
  - **Verified:** full backend suite 51 suites / 409 tests, exit 0; no new lint
    warnings (`salesController` stays at its existing 36, everything else clean).
    Also checked against the running dev stack: three detail reads of a live product
    moved its `views` 0 → 3 and the homepage's own query
    (`/products?limit=8&sort=newest&kind=product`) returned it.
  - **Frontend part:** `frontend-eaz/tasks.md` → T48 — done.

---

## Ad-hoc fixes (found during work, outside the original audit)

- [x] **T61 · 2FA PIN email logged as `other` — not filterable in EmailLog** ✅ done 2026-08-20
  - **Issue:** `utils/email.js` `sendTwoFactorPin` calls `send({ type: 'other', ... })` (line 284),
    so the 2FA code emails are recorded in `EmailLog` with `type: 'other'` and the admin Email
    log (`(admin)/emails`) has no `2fa` filter — they're lumped under "Other" and can't be
    isolated from genuine misc logs. All other transactionals use distinct types
    (`welcome`, `password_reset`, `contact_*`, `account_created`, `order_confirmation`, …).
  - **Location:** `utils/email.js:281-284`; `frontend-eaz/src/app/dashboard/(admin)/emails/page.jsx`
    `TYPE_LABELS`/`typeColors` (lines 15-26, 39+).
  - **Fix:** Change the `type` to `'two_factor'` (keep the enum open — no Mongoose enum on
    `EmailLog.type`), and add `two_factor: "2FA Pin"` to `TYPE_LABELS` + a color in `typeColors`
    on the admin emails page.
  - **Shipped:** `utils/email.js` — `sendTwoFactorPin`'s `send()` call now uses
    `type: 'two_factor'` (confirmed no Mongoose enum on `EmailLog.type`, and no test
    referenced the old `'other'` value). **Frontend part:** see `frontend-eaz/tasks.md` →
    T61 — added `two_factor: "2FA Pin"` to `TYPE_LABELS` (which also drives the filter
    dropdown, generated from `Object.entries(TYPE_LABELS)`) and an amber `typeColors`
    entry. Full backend suite (137 tests) and frontend build both pass.

- [x] **T60 · Hosting `createOrder` returns 500 instead of 400 for unknown plan/tier** ✅ done 2026-08-20
  - **Issue:** `config/hostingPlans.js` `getPlanPrice` **throws** on an unknown `planType` or
    `tier` (lines 330-336). `hostingOrderController.createOrder` calls it at line 77 inside the
    try/catch, so a client sending `planType: "bogus"` (or a stale frontend sending a removed
    tier) propagates as a 500. The `if (planTotal == null)` 400-check at lines 78-80 only
    handles the `cloud/enterprise` custom tier (which returns `total: null`), not the throw.
  - **Location:** `config/hostingPlans.js:328-336` (`getPlanPrice`); `controllers/hostingOrderController.js:77`.
  - **Fix:** Return `{ total: null }` (or a sentinel) from `getPlanPrice` for unknown
    type/tier instead of throwing, so the existing 400 path fires; add a test asserting
    `POST /api/v1/hosting/orders` with a bogus plan returns 400 not 500.
  - **Shipped:**
    - `config/hostingPlans.js` — `getPlanPrice` now returns `{ basePrice: null, total: null,
      billingCycle }` for an unknown `planType` or `tier`, same shape already used for the
      cloud/enterprise custom tier, instead of throwing.
    - Confirmed all **three** call sites (`hostingOrderController.js` — `createOrder:77`,
      renewal flow `:628`, staff-create `:875`) already had a `planTotal == null` /
      `!price || price.total == null` 400-check immediately after the call — they were all
      equally broken by the throw and are all fixed by this one change, not just `createOrder`.
    - `tests/hosting.test.js` — added `POST /api/v1/hosting/orders — invalid plan/tier (T60)`:
      2 tests (unknown `planType`, unknown `tier` on a known `planType`) asserting 400, not
      500.
  - **Verified:** full suite 22 suites / 139 tests pass (up from 137 — the 2 new tests); `npm
    run lint` 0 errors. (One unrelated flaky failure — a `socket hang up` network error,
    reproduced once then gone on immediate re-run — seen both before and after this change;
    not caused by it.)

- [x] **T59 · Service orders: free-form status + unclamped pagination** ✅ done 2026-08-20
  - **Issue:** `serviceOrderController.updateServiceOrder` assigns `status` straight from the
    body with no enum check, and uses `findByIdAndUpdate` (no `runValidators`), so any string
    is silently persisted (no 400, no schema validation). `getServiceOrders` takes raw
    `page`/`limit` from the query with no clamping (a client can pass `limit=100000` or
    `page=-1`), unlike every other list endpoint's default/min/max pattern.
  - **Location:** `controllers/serviceOrderController.js` — `getServiceOrders` (133-146),
    `updateServiceOrder` (151-163).
  - **Fix:** Validate `status` against the `ServiceOrder` enum (and a forward-only guard, e.g.
    don't move `paid` → `pending`), and clamp `page`/`limit` to sane bounds. Add a test.
  - **Shipped:**
    - `controllers/serviceOrderController.js` — added `SERVICE_ORDER_STATUSES` +
      `canTransition(from, to)`, mirroring `orderController.js`'s existing
      `ORDER_STATUSES`/`canTransition` pattern exactly (forward-only by rank; `cancelled`
      reachable from any live state; `completed`/`cancelled` terminal; same-status is a
      no-op).
    - `updateServiceOrder` — 400s on a status outside the enum, 400s on a disallowed
      transition (checked against the order's current status via `findById`, not blind
      `findByIdAndUpdate`), otherwise mutates + `.save()`s (runs full schema validation,
      replacing the old `findByIdAndUpdate` call that skipped it).
    - `getServiceOrders` — `page`/`limit` clamped with the same `Math.max`/`Math.min`
      pattern as `productController.getProducts` (limit capped at 100); an invalid
      `status` filter value is silently ignored rather than erroring, matching
      `orderController.getOrders`'s existing behavior for the same case.
    - `tests/serviceOrders.test.js` (new, 8 tests) — invalid status rejected; backward
      move (`paid`→`pending`) rejected; move out of a terminal state
      (`completed`→`in_progress`) rejected; reviving a `cancelled` order rejected; full
      forward chain `pending`→`paid`→`in_progress`→`completed` allowed; cancelling a
      live order allowed; `adminNote`-only update still works without touching status;
      oversized `limit`/negative `page`/invalid `status` filter on the list endpoint
      handled per the above.
  - **Verified:** full suite 23 suites / 147 tests pass (up from 139); `npm run lint`
    0 errors.

- [x] **T58 · POS part/repair order status allows backward moves** ✅ done 2026-08-20
  - **Issue:** `inventoryController.updatePartOrder` (308-332) and `jobController.updateRepairOrder`
    (802-826) validate the status against `['pending','paid','cancelled']` but enforce no
    forward-only rule, so `paid → pending` and `paid → cancelled` are allowed. Cancelling a
    **paid** part order also leaves the linked repair job stuck at `waiting_for_parts`
    (set by the webhook on payment), with no re-evaluation back to `diagnosing`.
  - **Location:** `controllers/pos/inventoryController.js` (`updatePartOrder` 308-332);
    `controllers/pos/jobController.js` (`updateRepairOrder` 802-826).
  - **Fix:** Mirror `orderController.canTransition` (390-401): forbid leaving `paid` backwards,
    and when a `paid` part order is cancelled, reset the linked job's `waiting_for_parts` back
    to `diagnosing` (or require manual status change). Add tests.
  - **Shipped:**
    - `controllers/pos/common.js` — new shared `PART_REPAIR_ORDER_STATUSES` constant and
      `canTransitionPartRepairOrder(from, to)` guard, exported for both controllers to
      share (rather than duplicating the same guard twice): only `pending` may move — to
      `paid` or `cancelled`; same-status is a no-op; `paid`/`cancelled` are both terminal
      (no un-paying, and — per the issue's explicit ask — no cancelling a *paid* order
      either, since that needs a refund process, not a status flip).
    - `controllers/pos/inventoryController.js` (`updatePartOrder`) and
      `controllers/pos/jobController.js` (`updateRepairOrder`) — both now check
      `canTransitionPartRepairOrder(prevStatus, status)` and 400 on a disallowed move,
      before applying the change.
    - `tests/partRepairOrderStatus.test.js` (new, 14 tests via `describe.each` covering
      both `PartOrder` and `RepairOrder`): invalid status rejected; `pending→paid` and
      `pending→cancelled` allowed; `paid→pending` and `paid→cancelled` rejected;
      `cancelled→anything` rejected; same-status no-op allowed.
    - **Did NOT implement the "reset waiting_for_parts → diagnosing on cancel" half** —
      took the fix note's explicit fallback ("require manual status change") instead.
      Reason: `waiting_for_parts` is not exclusively driven by the Paystack webhook —
      `jobController.updateJob`'s free-form `if (status) job.status = status` (no guard
      yet; that's the still-open **T53**) lets staff set it manually for unrelated
      reasons (e.g. waiting on a supplier part with no linked online order). There's no
      field on `RepairJob` distinguishing "webhook-set because of *this* order" from
      "staff-set for something else," so an automatic reset risks silently overwriting a
      status a staff member set deliberately. Flagging as a follow-up worth revisiting
      once T53 lands (a `waitingForPartsReason`/order-linkage field would make the
      auto-reset safe).
  - **Verified:** full suite 24 suites / 161 tests pass (up from 147); `npm run lint`
    0 errors.

- [x] **T57 · POS `updateJob` accepts money fields from technicians (bill understatement)** ✅ done 2026-08-20
  - **Issue:** `PATCH /pos/jobs/:id` (`routes/posRoutes.js:62`) sits behind the router-wide
    `restrictTo('superadmin', 'admin', 'staff', 'technician')` (line 35), and `jobController.updateJob`
    applies money-bearing fields straight from `req.body` with no role check: `laborCost`
    (line 327), `depositPaid` (line 328), `diagnosisFee` (lines 331-334), and custom-part
    `cost`/`costAtTime` (lines 362, 365). Inventory-linked parts are correctly anchored to
    `Part.sellingPrice`/`costPrice` (lines 341-367), but **non-inventory custom parts accept a
    client-supplied price**, and `laborCost`/`diagnosisFee`/`depositPaid` are client-trusted.
    A technician can understate the customer's bill (e.g. `laborCost: 0`, free custom parts) or
    claim a `depositPaid` without any staff involvement.
  - **Location:** `controllers/pos/jobController.js` — `updateJob` (lines 327-334, 341-367);
    `routes/posRoutes.js:62`.
  - **Fix:** Role-guard the money fields server-side — only `superadmin`/`staff`/`admin` may set
    `depositPaid` and client-priced custom parts; keep technician `laborCost`/`diagnosisFee` entry
    only if that's the intended shop workflow (at minimum log it). Add a test: a technician
    `PATCH /pos/jobs/:id` with `depositPaid: 0` (or a bogus custom part price) leaves the job's
    money untouched.
  - **Frontend part:** n/a — enforce server-side; the technician UI already hides the payment
    section but the save payload still carries the money fields.
  - **Decision (user, mid-task):** the fix note's own ambiguity ("keep technician
    laborCost/diagnosisFee entry only if that's the intended workflow") was resolved as
    **restrict, don't just log** — `laborCost`/`diagnosisFee` locked to the same
    staff/admin/superadmin roles as `depositPaid` and custom-part pricing, not left open
    to technicians with an audit-log trail.
  - **Shipped:**
    - `controllers/pos/jobController.js` (`updateJob`) — added
      `isMoneyRole = ['superadmin','admin','staff'].includes(req.user?.role)`, matching
      the existing `POST /jobs/:id/payments` role list (which already excludes
      technician for the same reason). `laborCost`, `depositPaid`, and `diagnosisFee`
      (both the `requiresDiagnosis`-toggle branch and the direct-edit branch) now only
      apply `if (isMoneyRole)`; a non-money role's request silently leaves them
      unchanged rather than erroring, since the same request may legitimately be
      updating other, non-money fields.
    - Custom (non-inventory) part pricing — snapshotted the job's existing custom-part
      prices by name *before* the wholesale `job.parts = parts.map(...)` replacement.
      For a non-money role: a custom part **already on the job** keeps its existing
      `priceAtTime`/`costAtTime` (so a technician can still edit quantity, add/remove
      lines) regardless of what price the client payload sent; a **brand-new** custom
      line from a non-money role prices at 0 (staff must price it in a follow-up edit).
      Inventory-linked parts were already anchored to `Part.sellingPrice`/`costPrice`
      and are unaffected by this change.
    - `tests/updateJobMoneyGuard.test.js` (new, 7 tests): technician's
      laborCost/depositPaid/diagnosisFee changes ignored; technician can't wipe
      `diagnosisFee` via `requiresDiagnosis: false`; technician's new custom part prices
      at 0; technician resubmitting an existing staff-priced custom part (e.g. to bump
      quantity) keeps the staff price; technician can still edit non-money fields
      (diagnosis, status); staff/admin/superadmin unaffected (regression check);
      inventory-linked part pricing unaffected by this guard.
  - **Verified:** full suite 25 suites / 168 tests pass (up from 161); `npm run lint`
    0 errors.

- [x] **T56 · POS job detail page missing `waiting_for_parts` status** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T56 for the full Shipped/Verified notes
  - **Issue:** `src/app/dashboard/pos/jobs/[id]/page.jsx:29` defines
    `STATUSES = ["received", "diagnosing", "repairing", "ready", "collected", "cancelled"]` —
    omitting `waiting_for_parts`, which IS a real backend status (`models/RepairJob.js:46` enum)
    set by the online part-order flow (`webhookController.js:573, 631`) and covered by the
    notification service (`services/notify.js:30`). A job in `waiting_for_parts` renders an
    unmapped `<select>` value (lines 306-307 — no matching `<option>`, so the browser shows a
    blank/first option) and has no quick-action button (the `status ===` cases end at line 501),
    so staff can only advance it via the generic dropdown — the normal one-tap flow silently skips it.
  - **Location:** `frontend-eaz/src/app/dashboard/pos/jobs/[id]/page.jsx` — `STATUSES` (line 29),
    `<select>` (306-307), quick-status buttons (468-501).
  - **Fix:** Add `waiting_for_parts` to `STATUSES` (with label "Waiting for parts") and add a
    quick-action case (e.g. `waiting_for_parts → repairing`) so staff can advance the job with one
    tap. Keep it between `diagnosing` and `repairing` in the flow.
  - **Backend detail:** n/a — backend already supports the status end-to-end.

- [x] **T55 · Credentials/PINs generated with non-crypto `Math.random()`** ✅ done 2026-08-20
  - **Issue:** `authController.generatePin` (`controllers/authController.js:11`,
    `String(Math.floor(100000 + Math.random() * 900000))`) produces every 6-digit verification /
    2FA PIN (call sites at lines 86, 243, 464, 553) with `Math.random`; `services/whm.js:22-31`
    and `services/cyberpanel.js:22-28` generate live cPanel/CyberPanel account passwords the same
    way (`chars[Math.floor(Math.random() * chars.length)]`). `Math.random` is a PRNG, not a CSPRNG
    — for the PINs this compounds the unthrottled-PIN brute-force risk already tracked as T46.
  - **Location:** `controllers/authController.js:11` (generatePin + 4 call sites);
    `services/whm.js:22-31`; `services/cyberpanel.js:22-28`.
  - **Fix:** Use `crypto.randomInt` for the PIN (`crypto.randomInt(100000, 1000000)`) and
    `crypto.randomBytes`/`randomInt` for the passwords (they already import `crypto`). The codebase
    already has the correct pattern in `controllers/pos/common.js:89` (`generatePassword` uses
    `crypto.randomInt` + Fisher–Yates) — mirror it. Add a test
    asserting the PIN has the correct 6-digit range/format.
  - **Frontend part:** n/a.
  - **Rotation check (user asked before implementing):** queried the live Mongo cluster
    directly — **0 of 25 users** currently have any stored `verifyPin`/`twoFactorPin`
    (expired or not), and **0 hosting orders** have ever been provisioned
    (`cpanelUsername` unset on all — WHM account passwords are never persisted in our DB
    at all, only handed to WHM's `createAccount` call and the credentials email). Nothing
    to rotate today; this is a forward-only fix. Noted that any PIN mid-flight at deploy
    time would still be weak until its ≤15-minute expiry — not worth engineering around.
  - **Shipped:**
    - `controllers/authController.js` — `generatePin` now
      `String(crypto.randomInt(100000, 1000000))` (same [100000, 999999] range/format as
      before, just CSPRNG-backed). Exported `generatePin` from the module (previously
      internal-only) so it's directly unit-testable.
    - `services/whm.js` — `generatePassword` now uses `crypto.randomInt` for every
      character pick, plus a Fisher–Yates shuffle (mirroring
      `controllers/pos/common.js`) so the guaranteed upper/lower/digit/special
      characters aren't always in the first 4 positions. Same 16-char length and
      character sets as before.
    - `services/cyberpanel.js` — `generatePassword` switched to `crypto.randomInt`;
      no shuffle needed there (unlike whm.js, it already picks uniformly across the
      whole combined charset per position, not from fixed per-class slots).
    - `tests/generatePin.test.js` (new, 2 tests): 500 draws all match `/^\d{6}$/` and
      fall in `[100000, 999999]`; a 500-draw uniqueness-spread sanity check
      (>490 distinct) to catch a broken/constant generator.
    - **Not touched:** `tests/hosting.test.js`/`hostingStaffCreate.test.js` fully mock
      `whm.generatePassword`, so they're unaffected by the real implementation change —
      confirmed, no test updates needed there.
  - **Verified:** full suite 26 suites / 170 tests pass (up from 168); `npm run lint`
    0 errors.

- [x] **T54 · Hosting order domain fee is client-trusted — Namecheap price lookup never matches** ✅ done 2026-08-20
  - **Issue:** `hostingOrderController.createOrder` (`controllers/hostingOrderController.js:84-104`)
    computes the domain fee server-side with `tld = domain_s.split('.').slice(1).join('.')` (e.g.
    `"com"`, **no leading dot**) and indexes `namecheap.getPricing()` — whose keys ARE
    dot-prefixed (`.com`, see `services/namecheap.js:119` and `utils/domainHelper.js:28`).
    The lookup always misses, so the code always falls back to
    `Math.min(Number(domainRegistrationFee) || 0, 500)` — **trusting the client-supplied
    `domainRegistrationFee`** in a GH₵0–500 band. A buyer can zero it out (free domain bundled
    into a hosting order) or inflate it; the webhook then charges the stored `amount`.
  - **Latent double-conversion:** `priceUSD` is a misnomer — `getPricing()` already returns GHS
    (`usdToGhs`, 15.5 rate × 1.2 markup applied). If someone "fixes" the key to `.com`, the code
    then multiplies by `usdRate * markup` **again** (~18× too high). Compare the correct pattern
    in `domainController.createDomainPayment` (lines 242-244), which uses `pricing[tld]` directly.
  - **Location:** `controllers/hostingOrderController.js` — `createOrder` (~lines 84-104).
  - **Fix:** Use `extractTLD(domain_s)` (returns the dot-prefixed TLD) to index `prices`, drop the
    redundant `usdRate * markup` conversion (price is already GHS), and keep the GH₵500-capped
    client fallback only for the Namecheap-unavailable case. Add a test: `createOrder` with a
    known TLD uses the server price and ignores `domainRegistrationFee`.
  - **Frontend part:** n/a — the checkout already displays the correct server price from domain search.
  - **Shipped:**
    - `controllers/hostingOrderController.js` — imported `extractTLD` from
      `utils/domainHelper.js`. In `createOrder`'s domain-fee block: `tld = extractTLD(domain_s)`
      (dot-prefixed, matches `getPricing()`'s keys), renamed the misleading `priceUSD` var to
      `priceGHS`, and dropped the `usdRate * markup` re-multiplication — `domainFee = Math.round(priceGHS
      * years * 100) / 100`. The unknown-TLD and Namecheap-unavailable fallbacks (capped
      client value) are unchanged.
    - **Found and fixed a second occurrence of the identical bug** — the staff-create flow
      (`POST /hosting/orders/staff-create`, ~line 882) had the exact same
      `split('.').slice(1)` + `priceUSD * usdRate * markup` pattern. Not named in the task's
      location note, but it's the same code duplicated, not a new issue — fixed the same way.
      This one previously had no client-fallback branch at all (domain fee always landed at 0
      for a "new domain" order, since the lookup always missed) — that's now replaced by a
      correct server-computed fee when the TLD is known.
    - `tests/hosting.test.js` — added `getPricing: jest.fn(async () => ({ ".com": 85, ".net":
      75 }))` to the file's existing `namecheap` mock (previously absent — none of the
      existing tests hit the `domainMode: 'new'` path, so it was never needed until now).
      New describe block (4 tests): known TLD uses the server price over a zeroed client
      value; price multiplies correctly by `domainRegistrationYears` (proves the
      double-conversion is gone — `75 × 2 = 150`, not `75 × 15.5 × 1.2 × 2`); unknown TLD
      falls back to the capped client value; Namecheap throwing falls back to the capped
      client value.
  - **Verified:** full suite 26 suites / 174 tests pass (up from 170); `npm run lint`
    0 errors.

- [x] **T53 · POS `updateJob` allows backward / terminal-to-live status transitions** ✅ done 2026-08-20
  - **Issue:** `jobController.updateJob` (`controllers/pos/jobController.js:318`) does
    `if (status) job.status = status;` with no transition validation — unlike
    `orderController.canTransition` (`controllers/orderController.js:390-401`), which enforces
    forward-only moves and treats `delivered`/`cancelled` as terminal. As written, a
    staff/technician can move a repair job backwards (`collected`→`received`,
    `ready`→`diagnosing`) or out of a terminal state (`cancelled`→`repairing`). Worse,
    `completedAt` is set when a job reaches `collected` (line 373) but is **never cleared** on a
    backward move, and `warrantyExpires` (set at collection when `warrantyDays > 0`) goes stale
    the same way — corrupting warranty + uncollected-reminder logic.
  - **Location:** `controllers/pos/jobController.js` — `updateJob` (~lines 318, 373-381);
    `models/RepairJob.js` — `status` enum (line 44-48), `completedAt` (line 59),
    `warrantyExpires` (line 64).
  - **Fix:** Mirror `orderController.canTransition`: a `STATUS_RANK` order over
    `['received','diagnosing','waiting_for_parts','repairing','ready','collected']`, reject
    moves to lower rank, treat `cancelled` as terminal (only reachable from a live state, per the
    existing T18 cancel guard), and allow same-status no-op. When a job is moved off `collected`
    (backwards), clear `completedAt`/`warrantyExpires`; set them only on `collected`. Add a test:
    `collected`→`received` is rejected with 400; `cancelled`→`repairing` is rejected.
  - **Frontend part:** n/a (see `frontend-eaz/tasks.md` → T53 for the UI side of the cancel guard).
  - **Shipped:**
    - `controllers/pos/common.js` — new `JOB_STATUS_RANK` + `canTransitionJobStatus(from, to)`
      guard, mirroring `orderController.canTransition`: forward-only over
      `received→diagnosing→waiting_for_parts→repairing→ready→collected` (skips allowed);
      `collected` and `cancelled` are both fully terminal (no moves out of either — same
      precedent as orders' `delivered`/`cancelled`, so the "clear `completedAt`/
      `warrantyExpires` on a backward move off `collected`" half of the fix note is now
      unreachable and was deliberately **not** added — the guard rejects the move before
      `job.save()` runs, so those fields can no longer go stale); `cancelled` reachable from
      any live status except `ready` (the T18 rule, folded in here since T18 itself is still
      unshipped).
    - **One deliberate exception, not in the original fix note:** `waiting_for_parts` →
      `diagnosing` is explicitly allowed as a backward move. T58 shipped a guard on
      `PartOrder`/`RepairOrder` but explicitly skipped auto-resetting a linked job stuck at
      `waiting_for_parts` when its paid order is cancelled, deferring to "require manual
      status change" instead — a plain forward-only guard here would have silently closed
      off that exact fallback. Documented inline in `common.js` with the T58 cross-reference.
    - `controllers/pos/jobController.js` (`updateJob`) — checks
      `canTransitionJobStatus(prevStatus, status)` and 400s on a disallowed move before
      applying the change.
    - `tests/jobStatusTransition.test.js` (new, 11 tests): forward move + skip allowed;
      same-status no-op allowed; backward move rejected; `collected`→anything rejected
      (terminal); `cancelled`→anything rejected (terminal); `ready`→`cancelled` rejected
      (T18); a live non-`ready` status → `cancelled` allowed; `waiting_for_parts`→`diagnosing`
      allowed (T58 fallback); other backward moves out of `waiting_for_parts` still rejected;
      `completedAt` set on reaching `collected`.
  - **Verified:** full suite 27 suites / 185 tests, 184 pass (1 pre-existing/unrelated
    `seedCatalog.test.js` timeout under full-suite load — passes standalone, confirmed
    unaffected by this change by re-running it against `main` via `git stash`); `npm run
    lint` 0 errors.
  - **T58 follow-up — does this change the calculus on the deferred auto-reset?** No, on the
    substantive question, but it does affect the manual fallback:
    - **Auto-reset is still unsafe, and T53 doesn't fix why.** T58's blocker was that
      nothing on `RepairJob` distinguishes "webhook set `waiting_for_parts` because of
      *this* order" from "staff set it manually for something else" (no
      `waitingForPartsReason`/order-linkage field). T53 is a pure status-transition guard —
      it adds no such field. An automatic reset on order-cancel would still risk silently
      overwriting a status a staff member set deliberately. That's unchanged.
    - **What T53 *does* change: it would have silently broken the manual fallback T58
      fell back to, if left as a strict forward-only guard.** A plain forward-only rule
      blocks *all* backward moves, including `waiting_for_parts`→`diagnosing` — the exact
      correction staff need after cancelling a paid order. Without the explicit exception
      added above, T53 would have shipped and quietly taken away the one escape hatch T58
      relied on, with no other route back to `diagnosing`. The exception keeps that
      fallback alive; it does not make auto-reset any safer.
    - **Net:** stays a manual-only fix, same as T58 concluded — T53 doesn't unlock a safe
      auto-reset path. If auto-reset is wanted later, it still needs the linkage field
      T58 flagged, as its own separate task.

- [x] **T52 · Frontend dashboard admin gates exclude superadmin** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T52 for the full Shipped/Verified notes
  - **Issue:** Admin pages gate on `user?.role === "admin"` (or `!== "admin"`), so a superadmin
    (site owner) is redirected to `/dashboard` or the admin data never loads.
  - **Location:** frontend — `src/app/dashboard/(admin)/hosting-orders/page.jsx:107`;
    `domain-orders/page.jsx:35,38,41,57`; `consultations/page.jsx:187,207,231`;
    `blog/page.jsx:126,140,186`; `chats/page.jsx:58,63`; `users/page.jsx:511`;
    `emails/page.jsx:71`; `src/app/dashboard/hosting/[orderId]/page.jsx:176`.
  - **Fix:** Use `["admin", "superadmin"].includes(user?.role)` everywhere admin views are
    gated (ideally a small shared helper). `middleware.js` and `DashboardShell` already handle
    superadmin correctly.
  - **Backend part:** see `backend-eaz/tasks.md` → T51.

- [x] **T51 · Superadmin excluded by controller-level `role === 'admin'` checks** ✅ done 2026-08-20
  - **Issue:** `restrictTo('admin')` grants superadmin implicit access
    (`middleware/auth.js:46`), but several `protect`-only routes re-check
    `req.user.role === 'admin'` inside the controller, so a superadmin passes the route yet is
    treated as a regular user: sees only their own hosting/domain orders, and gets 403 on other
    users' orders, invoices, cPanel SSO, service status, and cPanel password resets.
  - **Location:** `controllers/hostingOrderController.js` — `getOrders:204`, `getOrder:425`,
    `getInvoice:446`, `getCpanelLoginUrl:584`, `getServiceStatus:741`, `changeHostingPassword:781`;
    `controllers/domainController.js` — `getDomainOrders:354`, `getDomainOrder:388`.
  - **Fix:** Route-level: add `restrictTo('admin')` to the admin-capable routes (`/hosting/orders`,
    `/hosting/orders/:id`, `/hosting/orders/:id/invoice`, `/hosting/orders/:id/cpanel-login`,
    `/hosting/orders/:id/status`, `/hosting/orders/:id/password`, `/domains/orders`,
    `/domains/orders/:id`) OR replace the manual checks with `['admin', 'superadmin'].includes(...)`.
    Prefer route-level `restrictTo` for list endpoints and a superadmin-aware helper for
    ownership-or-admin checks.
  - **Frontend part:** see `frontend-eaz/tasks.md` → T52.
  - **Shipped:** All 8 sites turned out to be mixed owner-or-admin endpoints (a regular
    customer legitimately hits the same route for their own order/hosting account), so
    route-level `restrictTo` wasn't an option for any of them — went with the manual-check
    replacement instead, matching the inline `[...].includes(role)` convention already used
    elsewhere (`reportsController.js`, `jobController.js`); no new shared helper introduced
    for 8 call sites.
    - `controllers/hostingOrderController.js` — `getOrders`, `getOrder`, `getInvoice`,
      `getCpanelLoginUrl`, `getServiceStatus`, `changeHostingPassword`: `req.user?.role ===
      'admin'` (or `!== 'admin'`) → `['admin', 'superadmin'].includes(req.user?.role)`.
    - `controllers/domainController.js` — `getDomainOrders`, `getDomainOrder`: same swap.
    - `tests/hosting.test.js` (new `describe` block, 6 tests): superadmin sees every order
      via `GET /orders`; can read another customer's order, invoice, service status,
      cPanel SSO session, and reset another customer's cPanel password.
    - `tests/domainOrdersRoleGuard.test.js` (new, 4 tests): superadmin sees every domain
      order via `GET /orders`; a regular user's list stays filtered to their own; superadmin
      can read another customer's order by id; a non-owner, non-admin user is still 403'd
      (regression guard on the ownership check itself, not just the superadmin gap).
  - **Verified:** `tests/hosting.test.js` + `tests/domainOrdersRoleGuard.test.js` 24/24 pass
    (10 new); `npm run lint` on touched files 0 errors (2 pre-existing unrelated warnings in
    `hostingOrderController.js`). Full-suite run showed 2 failing suites/20 tests, both in
    `tests/productReviews.test.js` (unrelated to T51 — `mongodb-memory-server` failing to
    start / mongoose buffering timeouts, i.e. resource contention across parallel Jest
    workers) — confirmed pre-existing and unrelated: that file passes 19/19 standalone, and
    all T51/T53/T58 status-guard tests together (49 tests, 4 suites) pass clean.

- [x] **T19 · "Customer will bring device in" → "Device received" when diagnosing starts**
  - **Issue:** Once a repair job leaves the `received` stage, the customer/device card label
    should read "Device received" instead of the dropoff-based "Customer will bring device in".
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/pos/jobs/[id]/_components/CustomerDeviceCard.jsx`
  - **Fix:** Frontend-only display change keyed off `job.status`; **no backend change required**
    (see `frontend-eaz/tasks.md` → T19, implemented there).

- [x] **T50 · `resetPassword` / `verifyPin` don't check `isBlocked`** ✅ done 2026-08-21
  - **Issue:** `login` rejects blocked accounts, but `resetPassword` (~line 350) and
    `verifyPin` (~line 397) issue a fresh token via `sendTokenResponse` without checking
    `user.isBlocked`. A blocked user who still has a valid reset link or verification PIN can
    obtain a valid session token. Impact is limited (`protect` rejects blocked users on the
    next request) but the token is still issued and the flows are inconsistent.
  - **Location:** `controllers/authController.js` — `resetPassword`, `verifyPin`.
  - **Fix:** After loading the user in both flows, if `user.isBlocked` return the same 403
    used by `login` (with `blockedReason`). Add a test: blocked user with valid reset token
    / PIN gets 403, not a token.
  - **Frontend part:** n/a.
  - **Shipped:**
    - `controllers/authController.js` — extracted `blockedAccountError(user)` (the
      message logic `login` already had) and reused it in all three spots; `login`'s
      inline duplicate replaced with a call to the same helper.
    - `resetPassword` — `isBlocked` check inserted right after the token-validity lookup,
      before the password-length validation.
    - `verifyPin` — `isBlocked` check inserted right after the user-lookup 404, before
      the `isVerified` check.
    - No schema/query change needed — `isBlocked`/`blockedReason` aren't `select: false`
      on `User`, so they're already present on both queries.
    - `tests/authBlockedUser.test.js` (new, 4 tests): blocked user's valid reset token →
      403, no `Set-Cookie`; non-blocked user's reset still succeeds; blocked user's valid
      PIN → 403, no `Set-Cookie`; non-blocked user's PIN verification still succeeds.
  - **Verified:** `tests/authBlockedUser.test.js` 4/4 pass; `npm run lint` on touched files
    0 errors (2 pre-existing unrelated warnings — unused `protect`/`restrictTo` imports,
    not introduced by this change); full suite via `npm test` (`--runInBand`) 29 suites /
    199 tests, all pass.

- [x] **T49 · `verifyPin` / `twoFactorPin` stored and compared in plaintext** ✅ done 2026-08-21
  - **Issue:** 6-digit PINs are stored unhashed on `User` (`verifyPin`, `twoFactorPin`) and
    compared with plain `!==` (not a constant-time compare). A DB read exposes usable codes,
    and timing side-channel on comparison is possible.
  - **Location:** `models/User.js` (verifyPin/twoFactorPin fields), `controllers/authController.js`
    (verifyPin ~line 424, verifyTwoFactor ~line 617, confirmTwoFactor ~line 570).
  - **Fix (low risk):** Hash the PIN before storing (e.g. `crypto.createHash('sha256')` like
    `resetPasswordToken`) and compare digests, or compare with `crypto.timingSafeEqual`.
    Keep the 6-digit format for UX. Do NOT send the stored PIN anywhere; the plain code is
    emailed at generation time only.
  - **Frontend part:** n/a.
  - **Decision (user, before implementing):** SHA-256 + `timingSafeEqual` (matching
    `resetPasswordToken`'s existing pattern in this file), not bcrypt — these are
    short-lived (≤15 min), low-entropy 6-digit codes; hashing defends against DB-read
    exposure at rest, not online brute force (that's the still-open T46 rate-limit gap),
    so bcrypt's per-op cost buys nothing and doesn't fit the existing
    hash-and-compare-digests shape. Confirmed forward-only, no migration: same live-DB
    check T55 already ran found 0/25 users with a stored PIN; the only caveat (a PIN
    mid-flight at the exact deploy moment stops matching, user just hits resend,
    self-heals within the PIN's own ≤15 min expiry) is the same call T55 made and
    explicitly declined to engineer around. No user-facing format change — the plaintext
    6-digit code is still what's emailed/generated; only the DB write is hashed.
  - **Shipped:**
    - `controllers/authController.js` — `hashPin(pin)` (sha256 digest, exported for tests)
      and `pinMatches(storedHash, candidate)` (`timingSafeEqual` on the two digests,
      exported for tests). Wired into all 4 write sites (`register`, `login`'s 2FA
      trigger, `resendPin`, `enableTwoFactor` — each now stores `hashPin(pin)` instead of
      the plaintext) and all 3 compare sites (`verifyPin`, `confirmTwoFactor`,
      `verifyTwoFactor` — each now uses `pinMatches(...)` instead of `!==`). Email/SMS
      delivery (`sendVerificationPin`/`sendTwoFactorPin`) still receives the plaintext
      `pin` generated before hashing — unaffected.
    - `tests/pinHashing.test.js` (new, 6 tests): `hashPin`/`pinMatches` unit tests
      (deterministic, matches only the right plaintext, safe on missing input);
      `register` stores a digest (not the emailed plaintext) and only the correct code
      verifies; `2fa/enable`→`2fa/confirm` stores a digest and only the correct code
      confirms; login-triggered 2FA stores a digest and `2fa/verify` accepts the correct
      code.
    - **Fixed two pre-existing tests that read the plaintext PIN straight off the DB**
      (broken by this change, since the DB no longer holds plaintext):
      `tests/productReviews.test.js`'s E2E flow now mocks `sendVerificationPin` and reads
      the code from the (mocked) send call, same as the real emailed code would arrive;
      `tests/authBlockedUser.test.js` (T50) now seeds its fixture with `hashPin(...)`
      instead of a raw string.
  - **Verified:** `tests/pinHashing.test.js` 6/6 pass; `tests/productReviews.test.js` and
    `tests/authBlockedUser.test.js` re-verified 19/19 and 4/4 after the fix; `npm run lint`
    0 errors (2 pre-existing unrelated warnings); full suite via `npm test`
    (`--runInBand`) 30 suites / 205 tests, all pass.

- [x] **T48 · `api.js` drops the `requiresVerification` flag from error responses** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T48 for the full Shipped/Verified notes
  - **Issue:** When login returns 403 for an unverified account, the backend body includes
    `requiresVerification: true` + `email`, but `lib/api.js` (`request`, ~lines 20–26) only
    copies `error`/`errors`/`status` onto the thrown Error. `AuthContext.login` then depends on
    `err.message.toLowerCase().includes('verify')` (message text is `'Please verify your email
    before logging in.'`) — brittle; breaks if the message text changes.
  - **Location:** `frontend-eaz/src/lib/api.js` (error construction ~lines 20–26),
    `frontend-eaz/src/context/AuthContext.jsx` (login ~lines 32–40).
  - **Fix:** In `api.js`, spread the rest of `data` onto the Error (e.g. `Object.assign(err,
    data)`) so `requiresVerification`, `email`, etc. survive; in `AuthContext.login`, check
    `err.requiresVerification` instead of message matching; pass `err.email` through to the
    verify redirect.
  - **Backend:** none needed (see `backend-eaz/tasks.md` → T48).

- [x] **T47 · `updateProfile` missing phone-uniqueness pre-check** ✅ done 2026-08-21
  - **Issue:** `updateProfile` (~line 497) does `User.findByIdAndUpdate` with
    `phone: phone || ''` and no duplicate check. If a user sets a phone already in use, the
    partial unique index throws a 11000 duplicate-key error → unhandled 500. `register` and
    `adminCreateUser`/`adminUpdateUser` all pre-check and return a friendly 409.
  - **Location:** `controllers/authController.js` — `updateProfile` (~lines 497–511).
  - **Fix:** Before updating, if `phone` is non-empty, `User.findOne({ phone, _id: { $ne:
    req.user._id } })` and return 409 if taken (mirror `adminUpdateUser` ~line 790). Clear the
    phone field (`phone: ''`) is fine — the partial index ignores empty strings.
  - **Frontend part:** n/a (error surfaces in the settings profile form).
  - **Shipped:** `controllers/authController.js` (`updateProfile`) — pre-check inserted
    verbatim from `adminUpdateUser`'s existing pattern (same query shape, same 409
    message), right after the name-required check and before `findByIdAndUpdate`.
    `tests/updateProfilePhoneUnique.test.js` (new, 4 tests): taken phone → 409, not 500;
    an unused phone succeeds; re-saving your own existing phone doesn't false-positive
    against yourself; clearing to `''` still works.
  - **Verified:** 4/4 new tests pass; `npm run lint` 0 errors (2 pre-existing unrelated
    warnings); full suite via `npm test` (`--runInBand`) 31 suites / 209 tests, all pass.

- [x] **T46 · `/api/v1/auth/verify` rate limit is dead code — PIN endpoints unthrottled** ✅ done 2026-08-21
  - **Issue:** `app.js:158` mounts a strict limiter at `app.use('/api/v1/auth/verify', 10/15min)`.
    Express path matching means it only hits the literal `/api/v1/auth/verify` route — which
    doesn't exist. The real routes `/api/v1/auth/verify-pin`, `/api/v1/auth/resend-pin`, and
    `/api/v1/auth/2fa/verify` are protected **only** by the global 150/15min limit, so the
    6-digit PIN endpoints can be brute-forced far beyond the intended 10 attempts/15min.
  - **Location:** `app.js` (~line 158); routes are `routes/authRoutes.js` lines 32 (`verify-pin`),
    33 (`resend-pin`), 47 (`2fa/verify`).
  - **Fix:** Replace the dead mount with limits on the actual paths, e.g.
    `app.use('/api/v1/auth/verify-pin', 10/15min)` and `app.use('/api/v1/auth/2fa/verify', 10/15min)`
    (or a `router`-level limiter inside `authRoutes.js`). Add `resend-pin` a gentler limit
    (e.g. 5/60min) to prevent PIN-resend spam. Verify with a rate-limit test.
  - **Frontend part:** n/a.
  - **Discussion (user asked before implementing):** exposure is IP rotation, not a
    single-IP attack — one PIN's 900,000-value keyspace vs. its ≤15 min expiry already
    makes a single-IP brute force impractical even under just the global 150/15min limit
    (~0.017% keyspace coverage per PIN lifetime), but a distributed attacker gets a fresh
    150-request budget per IP, and a hit here yields a live session token
    (`sendTokenResponse`), not just an "account confirmed" flag — so a dedicated,
    order-of-magnitude-tighter per-route limit still meaningfully raises the cost.
  - **Shipped:** `app.js` — replaced the dead `/api/v1/auth/verify` mount with three
    real-path mounts: `/api/v1/auth/verify-pin` and `/api/v1/auth/2fa/verify` at
    10/15min (same values the dead code already had, matching `login`'s precedent);
    `/api/v1/auth/resend-pin` at a gentler 5/60min (matching `forgot-password`'s
    precedent, since resend abuse is spam, not guessing).
    `tests/authRateLimitWiring.test.js` (new, 2 tests) — can't test this behaviorally
    (the limiter's own `skip` deliberately no-ops when `NODE_ENV === 'test'`, set
    globally by `tests/setup.js` before any test file loads `../app`), so it verifies
    the wiring itself via Express's own `Layer#match()`: a path-specific limiter layer
    exists on all 3 real paths, and none remains on the dead literal `/verify` path.
    Confirmed the test actually catches the bug by stashing `app.js` back to the dead
    mount and re-running — both assertions fail as expected, restored after.
  - **Verified:** 2/2 new tests pass (and fail correctly against the pre-fix code);
    `npm run lint` 0 errors (2 pre-existing unrelated warnings); full suite via
    `npm test` (`--runInBand`) 32 suites / 211 tests, all pass.

- [x] **T45 · `expenseController`: unescaped supplier regex + no activity logs** ✅ done 2026-08-21
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
  - **Shipped:**
    - `services/activityLogService.js` — added `EXPENSE_CREATED`/`UPDATED`/`DELETED` and
      `SUPPLIER_CREATED`/`UPDATED`/`DELETED` to `ACTIONS`, and `EXPENSE`/`SUPPLIER` to
      `RESOURCES` (no schema migration needed — `ActivityLog.action`/`resourceType` are
      plain strings, not a Mongoose enum).
    - `controllers/pos/expenseController.js` — `getSuppliers` wraps `q` in
      `escapeRegex(q)` (was already imported, unused, in this file's destructure).
      `createExpense`/`createSupplier` log on create (no diff, matches the
      `createCustomer`/`createPart` precedent). `updateExpense`/`updateSupplier` capture
      a before/after snapshot and log via `buildChanges`, mirroring
      `inventoryController.updatePart`'s exact pattern. `deleteExpense`/`deleteSupplier`
      log using the deleted doc's own name/id after the delete succeeds.
    - `tests/expenseSupplierActivityLog.test.js` (new, 8 tests): a regex-metacharacter
      query (`"(unmatched"`) returns an empty result instead of throwing; a real match
      still works; all 3 expense mutations and all 3 supplier mutations each write the
      expected `ACTIONS.*` log entry, and the two update tests assert the specific
      before/after diff values.
    - Confirmed the tests actually catch the original bug: stashed
      `expenseController.js` back to the pre-fix version and reran — 7/8 fail (the
      regex-throw case and all 6 logging assertions), only the plain-match control test
      passes either way, as expected; restored after.
  - **Verified:** 8/8 new tests pass; `npm run lint` 0 errors (33 pre-existing unrelated
    warnings — the shared `controllers/pos/*.js` destructure-import pattern, same as
    every other file in this directory; none of the 5 imports this fix actually uses
    appear in that list); full suite via `npm test` (`--runInBand`) 33 suites / 219
    tests, all pass.

- [x] **T44 · Hosting/domain/service amounts stored as major-GHS floats — align to pesewas** — ✅ **RESOLVED 2026-08-25 — Option B, intentional exception, not migrated**
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
  - **Decision (2026-08-25):** documented as intentional, permanent — **not migrating**.
    `PHASE7_MONEY_MIGRATION_PLAN.md` (the actual prior POS/repair pesewas migration,
    2026-08-14) already carved this exact scope out as "Group C — out of scope," calling it a
    separate, internally-consistent convention the webhook already handles correctly at its
    boundary — this decision confirms that prior exclusion rather than reopening it. A real
    migration would mean converting live subscription money (`HostingOrder` models active
    billing subscriptions with `expiresAt`/`renewalOrderId` chains), unlike T8's rename, which
    a pre-check found 0 documents to convert. Full reasoning in
    `MASTER_TASK_ORDER.md`'s "✅ Resolved decisions" section.
  - **Shipped instead of migrating:**
    - Comments on `HostingOrder.amount`/`addons[].price`/`domainRegistrationFee`,
      `DomainOrder.price`, `ServiceOrder.depositAmount`/`totalAmount` state the exception
      explicitly and cross-reference `webhookController.js`'s `amountMismatch` comment
      (updated to point back).
    - **Follow-up (closes the one real residual risk — float round-trip precision):** added
      `amountPesewas` (`HostingOrder`, `DomainOrder`) and `depositAmountPesewas`/
      `totalAmountPesewas` (`ServiceOrder`), populated at all 5 create call sites (hosting
      create/renew/staff-create in `hostingOrderController.js`, domain create in
      `domainController.js`, service create in `serviceOrderController.js`) by reusing the
      pesewas value each site already computes for its Paystack `initialize()` call — not new
      arithmetic. The 3 webhook `amountMismatch` comparisons now read these fields directly
      instead of re-deriving via `Math.round(field * 100)`, with a fallback to the old
      derivation for orders created before this field existed. 10 new tests (`hosting.test.js`
      + new `domainServiceAmountPesewas.test.js`): field set correctly on creation, webhook
      decision follows the new field over a deliberately-inconsistent recomputed value
      (proves the wiring, not just that both formulas agree), and the legacy-order fallback
      still works — confirmed the fix-specific tests fail without the fix. 46 suites/340 tests
      pass, lint clean.

- [ ] **T43 · Money display bypasses the single `formatGhs` formatter**
  - **Issue:** The frontend convention (STYLE_GUIDE/CLAUDE.md) is to render money via
    `formatGhs(pesewas)` from `lib/shop.js`. Many pages instead hand-roll `GH₵{...toFixed(2)}`
    or `GH₵{...toLocaleString()}` — raw concatenation that is inconsistent and error-prone.
  - **Location:** backend side n/a — see `frontend-eaz/tasks.md` → T43 for the full file list.
  - **Fix:** None on the backend (data already arrives in pesewas; the display conversion
    happens client-side). Verify any backend money fields these pages consume are integer
    pesewas as the pages expect.
  - **Frontend part:** `frontend-eaz/tasks.md` → T43.

- [x] **T42 · `BlogArticle` renders markdown via `dangerouslySetInnerHTML` — stored-XSS risk** — ✅ done 2026-08-25
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
  - **Shipped:** new `sanitizePostContent` (`utils/sanitize.js`), used only for `Post.content` in
    `createPost`/`updatePost` — deliberately did **not** touch the existing `sanitizeMessage`
    helper it replaced there, since that's shared by five other unrelated controllers (chat,
    reviews, contact, settings, product reviews) and changing its behavior was out of scope.
    Tried `sanitize-html` first (matches the design doc) but it pulls in `htmlparser2@12`, which
    is ESM-only and breaks Jest's CJS-only transform pipeline with no babel config in this repo;
    rather than bolt on ESM-transform infra for one dependency, or pin `sanitize-html` to an
    older version, checked that older version against a known CVE first — `sanitize-html
    <=2.17.4` has a real published advisory (GHSA-vccv-cmxp-4j9h, incomplete URI-scheme
    validation) — and declined to knowingly ship a vulnerable version of the library doing the
    XSS fix itself, even though my `allowedTags: []` config happens to sidestep that specific
    flaw. Switched to `xss` (js-xss) instead: CJS-native, zero dependency vulnerabilities,
    same allowlist approach (empty `whiteList` HTML-*encodes* disallowed tags rather than
    stripping them — inert either way, confirmed by test). Plus a stripped-and-restored belt of
    literal `javascript:`-substring removal for the markdown-link vector, which isn't real HTML
    so no HTML sanitizer's tag/attribute allowlist ever sees it. Also wrote (and live-tested
    against a disposable local MongoDB, never the real DB) `scripts/resanitizePostContent.js` —
    an idempotent hygiene pass that re-sanitizes already-stored `Post.content` rows to match
    what a fresh write produces today; supports `--dry-run`. Confirmed with the frontend fix
    that this is genuinely optional, not load-bearing — the frontend sanitizes at *render* time,
    on every request, so old malicious content is already safe to view without it; whether to
    run it against the real database is a separate call for the user. 8 new tests
    (`postXss.test.js`, unit + integration) — confirmed the 5 security-relevant ones fail
    without the fix (temporarily reverted `sanitizePostContent`) before restoring it. 45
    suites/330 tests pass, lint clean, `npm audit`: 0 vulnerabilities (unchanged).

- [x] **T41 · Public track page part-order cart mixes float-GHS and pesewas** — ✅ done 2026-08-25
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
  - **Confirmed:** independently re-verified `submitOrder` sends only `{ partId, quantity }` per
    line before touching anything — matches this note exactly, no backend change needed. See
    `frontend-eaz/tasks.md` → T41 for what shipped.

- [x] **T40 · `authController.logout` calls `jwt.decode` but never imports `jsonwebtoken`** ✅ done 2026-08-20
  - **Issue:** `logout()` (line ~283) runs `jwt.decode(token)` to resolve the actor identity
    for the activity log, but `jsonwebtoken` is **not required** in `authController.js`. The
    ReferenceError is swallowed by the surrounding try/catch, so logout "works" — but the
    actor is always `null` and the logout activity entry never records who logged out.
  - **Location:** `controllers/authController.js` (imports lines 1–6; logout ~lines 276–303).
  - **Fix:** Add `const jwt = require('jsonwebtoken');` to the imports (verified: no other
    `jwt` reference exists in the file). Optionally add a test asserting logout logs the
    actor identity when a valid token cookie is present.
  - **Frontend part:** n/a.
  - **Shipped:** picked up out of queue order — the new ESLint setup (T10) flagged this as
    a live `no-undef` error on its first run. Added `const jwt = require('jsonwebtoken');`
    to `controllers/authController.js`'s imports (user confirmed fixing it now rather than
    waiting for T40's own turn). No test added for the actor-identity assertion the original
    fix note suggested — full suite (137 tests) still passes; flagging as unclaimed if
    wanted later.

- [x] **T39 · Product detail tabs (Description / Reviews) — no backend change** — ✅ done 2026-08-25
  - **Issue:** The frontend product detail page (`/shop/[slug]`) should show **tabs** for
    Description and Reviews instead of stacking them as one long page. This is a
    **frontend-only** UI change; no API/model/route work required.
  - **Location:** n/a (backend) — see `frontend-eaz/tasks.md` → T39 for the fix.
  - **Fix:** None on the backend. Verify the endpoints backing the tabs still work:
    `GET /api/v1/products/:slug` (description + specs), `GET /api/v1/products/:productId/reviews`
    (public review list), and the review submit/eligibility routes.
  - **Confirmed:** the frontend fix reuses `useProductBySlug` and `<ProductReviews>` completely
    untouched — no new endpoint calls, no changed request shapes — so there's nothing here that
    could have broken. See `frontend-eaz/tasks.md` → T39 for what shipped.

- [x] **T38 · Cart overlay viewport fit — no backend change** — ✅ done 2026-08-25
  - **Issue:** The cart overlay that opens on **Add to Cart** from a product detail page
    (frontend `CartDrawer`) should fit all content within one viewport. This is a
    **frontend-only** layout fix; no API/model/route work required.
  - **Location:** n/a (backend) — see `frontend-eaz/tasks.md` → T38 for the fix.
  - **Fix:** None on the backend. After the frontend drawer change, verify cart flow
    endpoints used from the drawer still work: `POST /api/v1/cart/sync` (if present),
    `GET /api/v1/products`, and checkout `POST /api/v1/orders`.
  - **Confirmed:** the fix was a pure CSS/flexbox change (3 Tailwind classes) — `CartDrawer`
    doesn't call any endpoint itself (Checkout is a `<Link>` to `/checkout`, not an API call from
    this component), so there was nothing here that could have broken. See
    `frontend-eaz/tasks.md` → T38 for what shipped.

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

- [x] **T32 · Scope analytics: staff own report only; admin sees all staff + per-staff activity** — ✅ done 2026-08-25
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
  - **Shipped:** each collection scoped by the field that actually attributes it to a person —
    `Sale.cashier`, `PosPayment.receivedBy`, `RepairJob.createdBy` (matches `getMyOverview`'s
    existing convention for non-technician roles; `assignedTo` is the technician-ownership
    concept and technicians can't reach this route at all) — never combined with `$or`, so no
    document can match twice. Verified before implementing that `Sale`/`PosPayment`/`Order` are
    disjoint collections with no cross-references, so summing revenue across them can't
    double-count one underlying transaction; a dedicated test seeds a job where the same person
    is both `createdBy` and `receivedBy` and confirms it's counted once, not twice. Shop `Order`s
    are excluded entirely (not shown shop-wide) under a staff-scoped view, since online orders
    are never attributable to a specific staff member. Invalid `staffId` from admin is silently
    ignored (falls back to shop-wide), matching the existing pattern for optional id filters
    elsewhere in this controller. Response gained `scope: { staffId, staffName, isOwnReport,
    staffList }` — `staffList` (admin/superadmin only) is the same roles already allowed on this
    route, since only they can appear as `cashier`/`receivedBy`/`createdBy`. 5 new tests in
    `reportsAnalytics.test.js` (own-scope forced for staff, admin per-staff filter, shop-wide
    unchanged + union-equals-shop-wide check, same-person double-count guard, invalid id
    fallback) — 44 suites/322 tests pass.

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