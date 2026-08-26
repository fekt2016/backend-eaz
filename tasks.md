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

- [x] **T5 · Confirm/align Expenses role model** — ✅ resolved 2026-08-26
  - **Issue:** Expense read = `('superadmin','staff')`, write = `('superadmin')` — `admin`
    was omitted from **both** (not just write; the original note undersold it). Inconsistent
    with the admin-inclusive pattern everywhere else. Not a security hole — more restrictive.
  - **Decision (user, 2026-08-26): admin gets full access** — added to read and write in
    `routes/posRoutes.js`; staff stays read-only; superadmin unchanged. Frontend follows:
    the Expenses nav entry admits `admin` and the page's manage gating widened from
    `isSuperAdmin` to superadmin+admin (`dashboardNav.js`, `pos/expenses/page.jsx`).
  - **Tests:** `tests/expensesRoleModel.test.js` (new, 4) — admin read+create, staff
    read-but-no-write, user/technician refused on both.

---

## Missing Features (new work — ⚪ in the audit)

Not defects; product features that don't exist yet. Scope separately before building.

---

## Ad-hoc fixes (found during work, outside the original audit)

- [x] **T69 · Chat quality monitoring — attribution, claim flow, metrics** — ✅ done 2026-08-26 (all four phases)
  - **Why:** asked 2026-08-25 "how do superadmin/admin monitor staff↔customer chat quality".
    All three roles share one console (`/dashboard/chats`; `restrictTo('admin','staff')`,
    superadmin implicit via `middleware/auth.js:46`) and can read every transcript — but quality
    was unmeasurable: replies stored only `{ role: 'admin' }` with no sender, `acceptChat` recorded
    nobody, `resolved` had no timestamp, and there is no rating.
  - **Phase 0 (security) — ✅ closed, and the original diagnosis was out of date.** The route is
    still public, deliberately: it's how the *customer's* widget polls for replies, and that
    visitor has no account, so `protect` would break live chat outright. It is not open, though —
    the caller must present an `ew_session` cookie matching the sessionId in the URL, so a leaked
    or guessed id alone reads nothing. Two real gaps were fixed instead: the dead
    `req.user?.role === 'admin'` bypass (`protect` never runs there, so `req.user` was always
    undefined) is gone, and the response is now projected to `_id/role/content/createdAt` so the
    new `senderId`/`senderName` never reach the customer.
  - **Phase 1 (attribution) — ✅** `senderId`/`senderName` on `messageSchema`; `adminReply` stamps
    `req.user` and echoes it back for the console's optimistic render. `role:'admin'` unchanged, so
    every existing renderer and the widget keep working; pre-T69 messages read as "Unattributed".
  - **Phase 2 (claim) — ✅** `acceptedBy`/`acceptedByName`/`acceptedAt` on the session, stamped by
    `acceptChat`; new `POST /chat/sessions/:id/claim` takes over a chat that isn't a pending
    request (bot-only, or one another agent already holds) **without** touching
    `humanAccepted`/`humanAcceptedAt`, so a supervisor stepping in doesn't reset the customer's wait
    clock. `resolvedAt` is stamped on resolve and cleared on reopen — including the reopen that
    `adminReply` does implicitly, or a stale stamp would feed negative durations into the metrics.
  - **Phase 3 (metrics endpoint) — ✅** `GET /api/v1/chat/metrics?from&to`, `restrictTo('admin')`
    (staff don't read the scoreboard they're measured on). Returns volume, median first-response
    time (first agent message at/after `humanAcceptedAt`), resolution rate + median time to close,
    and a per-agent breakdown (claimed / replies / resolved / median first reply). `.lean()` with
    `messages.content` projected away — content is the bulk of a session and nothing in the maths
    reads it. Range defaults to 30 days, junk dates fall back to it, and the window is clamped to
    365 days so `from=1970-01-01` can't pull every session into a 512MB heap. New
    `{ createdAt: -1 }` index backs the range filter.
  - **Phase 4 (CSAT) — ✅ done 2026-08-26.** Product call taken: customers **are** prompted, but
    only after a chat a *person* handled — rating the bot would measure a script. `rating`/
    `ratingComment`/`ratedAt` on `ChatSession`; public
    `POST /chat/sessions/:sessionId/rating` gated exactly like polling (the `ew_session`
    cookie must match the sessionId in the URL — the rater has no account). Whole-number 1–5
    enforced; only resolvable on a **resolved** conversation; re-rating allowed (same visitor,
    and a misclicked star they can't correct is worse data than an update — last rating wins);
    comment sanitized to 500 chars. Polling's `meta.rating` tells the widget what's already
    saved so it shows the score back instead of asking twice. Metrics grew an overall
    `csat { average, count, responseRate }` (response rate = share of closed chats that rated,
    so a 4.9 from two ratings doesn't parade as gospel) and per-agent `csatAverage`/`csatCount`,
    credited to whoever owned (`acceptedBy`) the conversation.
  - **Tests:** `tests/chatMonitoring.test.js` (25) covers attribution, the widget projection, the
    cookie gate, claim/accept ownership, `resolvedAt`, the metrics maths + role guards, and the
    rating endpoint end to end (store + comment, wrong-cookie 403, open-chat 400, bad star
    values, re-rate overwrite, `meta.rating` echo). `tests/setup.js` Spaceship key-blanking
    untouched. Suite: 59 files / 533 tests green; lint 0 errors.
  - **Frontend part:** `frontend-eaz/tasks.md` → T69 — ✅ done in the same pass.

- [x] **T66 · Hosting prices are now USD-sourced and converted, like domains** — ✅ done 2026-08-25; ladder repriced 2026-08-26, no open questions
  - **⚠️→✅ Resolved — the price ladder was inverted.** Shared/Ultimate at **GH₵961/mo cost more
    than VPS Pro at GH₵950/mo**, and Shared/Enterprise (496) more than Cloud Starter (420).
    Decision (user, 2026-08-26): market ladder for shared — `$4/$8/$14/$18` →
    **GH₵62/124/217/279**, so a shared account now always costs less than the cheapest VPS
    (280). Annual ×10: 620 / 1,240 / 2,170 / 2,790. Pure `priceUsd` edits; every test derives
    from `getPlanPrice`, so nothing else moved.
  - **Was:** `config/hostingPlans.js` stored shared tiers as 9/16/32/62 and the storefront rendered
    them as **GH₵/month** — about $0.58–$4, a USD price list that never got converted. Same class of
    bug as `utils/domainHelper.js` pricing `.com` at GH₵85 against a real cost of GH₵190.
  - **Decision (user, 2026-08-25):** they were meant to be USD. Converted at `USD_TO_GHS_RATE`.
  - **Fix — the domain pattern, applied to hosting.** Rather than rewriting the cedi numbers (which
    would leave the same trap for the next person), every tier now stores **`priceUsd`** and GH₵ is
    derived at read time, mirroring `config/domainPricing.js` + `usdToGhs()`. A half-converted price
    is no longer expressible, and a rate change moves all 16 tiers at once.
    - `monthlyPrice` / `annualPrice` remain on every plan as **enumerable getters**, so the plans API,
      the storefront and `getPlanPrice` all keep working with no changes and always see the live rate.
      (`enumerable` is load-bearing: without it they vanish from `JSON.stringify` and the API returns
      no prices.)
    - VPS/Cloud/WordPress/Email `priceUsd` values were back-derived from their original GH₵ at 15.5,
      so **only the shared group repriced**; everything else is unchanged to the cedi.
  - **Repriced:** Deluxe GH₵9→**140**/mo, Professional 16→**248**, Enterprise 32→**496**,
    Ultimate 62→**961**.
  - **Tests:** `tests/hosting.test.js` no longer hardcodes 9/900 — it derives from `getPlanPrice`, so
    the assertion (pesewas === amount × 100) survives any future rate change.
  - **Verified:** 57 suites / 501 tests, exit 0; lint clean.
  - **✅ Closed 2026-08-26 — see the repricing decision at the top of this entry.** The old
    open question ("shared USD too high, or VPS/WordPress cedi too low?") was answered: shared
    was too high for this market.

- [ ] **T67 · Annual billing gives no discount, and the UI advertised "Save GH₵0"**
  - **Partly fixed 2026-08-25 (frontend).** Every `annualPrice` in `config/hostingPlans.js` is
    exactly `monthlyPrice × 12` — all 14 tiers. So annual billing costs the same as paying monthly.
  - The storefront computed `saving = monthlyPrice * 12 - annualPrice` and rendered it unguarded, so
    a customer choosing Annual was shown a green **"Save GH₵ 0"** and a tab reading
    **"Annual (Save GH₵ 0)"**. Fixed: all three render sites now require `saving > 0`
    (`frontend-eaz` → hosting/page.jsx, hosting/checkout/page.jsx ×2).
  - **Decision (user, 2026-08-25): two months free.** `annualPrice` is no longer stored at all —
    it's derived as `monthlyPrice × MONTHS_BILLED_ANNUALLY` (10) in `config/hostingPlans.js`, so the
    discount can't silently drift back to ×12 the way it had. The storefront's "Save GH₵…" line
    reappeared on its own once the saving became non-zero.
  - **Saving now shown:** two months of the plan, e.g. Deluxe GH₵1,680 → **GH₵1,400/yr, save GH₵280**.
  - **Verified:** backend 57 suites / 501 tests; frontend 47 files / 301 tests. Both exit 0.

- [~] **T68 · VPS / Cloud / Email orders are paid for but never provisioned, and nothing chases them** — ✅ done 2026-08-26 (backend + frontend; purchase email folds into T62)
  - **What happened before:** `utils/provisionHosting.js` auto-provisions only
    `autoProvisionTypes = ['shared', 'wordpress']`. Everything else was marked
    `provisioningStatus: 'skipped'` and stopped there. A customer could pay **GH₵950/month for
    VPS Pro** and have nothing created — and `getHostingStats` counted
    `paidProvisioningSkipped` with no queue, no list, no notification behind the number.
    Spaceship's Starlight VMs have no provisioning API, so these stay manual for good.
  - **Shaped after T45's pre-order release queue, which solves this exact problem:**
    - `GET /hosting/orders/awaiting-provisioning` (admin/staff) — paid orders with
      `provisioningStatus: 'skipped'`, oldest first, limit clamped 1–100 default 50, `.lean()`.
      Unpaid excluded, same reasoning as the pre-order queue: nobody builds a server for money
      that has not landed.
    - `PATCH /hosting/orders/:id/mark-provisioned` (admin/staff) — staff enter the username and
      password they created by hand in Starlight Manager (+ optional domain). The order goes
      `active`, gets its expiry stamped by billing cycle (same +1 month / +1 year rule the
      auto-provisioner applies), `provisionedAt` is set, and the existing
      `sendHostingCredentials` email fires best-effort. **Idempotent:** marking an order that is
      already active+provisioned returns 200 with `meta.alreadyProvisioned` and does not re-email;
      a second click can never double-send credentials. The password is passed straight to the
      email and never stored — no schema field, on purpose. Username min 3 / password min 8,
      both sanitized (`sanitizeText`/`sanitizeDomain`). Audit-logged as ORDER_STATUS_CHANGED.
    - Dashboard page + nav entry: `frontend-eaz/tasks.md` → T68 — ✅ done in the same pass.
  - **Not done here:** a customer email at *purchase* saying "we're building your server" —
    folds into T62, which already covers the missing hosting-order emails.
  - **Tests:** `tests/hostingAwaitingProvisioning.test.js` (new, 14) — queue ordering and the
    paid/skipped filter excluding pending/active/auto-path orders, role guards on both endpoints,
    activation + annual expiry stamp, credential email content, temp-domain and customer-domain
    fallbacks, double-mark idempotency, unpaid refusal, credential validation, 404.
    Suite: 60 files / 547 tests green; lint clean.


- [x] **T64 · Registrar switch: Namecheap → Spaceship** — ✅ done 2026-08-25 · **cPanel deferred 2026-08-26**
  - **cPanel licence decision (user, 2026-08-26):** deferred until ~3 hosted clients (currently
    1) — no Admin-tier purchase yet. To make that safe, `provisionHosting.js` now marks
    WHM-unconfigured orders `'skipped'` instead of `'failed'`, so paid shared/wordpress orders
    land in the awaiting-provisioning queue as manual builds (they used to vanish into
    `'failed'`, which no list chased). WHM-rejects-after-config still means `'failed'`.
    Test: `tests/hostingAwaitingProvisioning.test.js` proves a paid shared order reaches the
    queue with hasConfig false. When client #3 arrives: buy Admin ($35.99/mo, skip Solo's
    hard 1-account cap), install WHM on the Starlight VM, allowlist EC2 IP 18.133.107.249,
    send me `WHM_HOST`/`WHM_USER`/`WHM_TOKEN`.
  - **Why:** hosting and domains moved to Spaceship (this is also what T44 was parked on).
  - **Verified live** against `https://spaceship.dev/api/v1` with real credentials before building.
  - **Shipped:**
    - `services/spaceship.js` (new) — exports the *same six* functions as `namecheap.js`
      (`checkDomain`, `checkMultipleDomains`, `registerDomain`, `setEazWorldNameservers`,
      `getPricing`, `hasConfig`) so the eight call sites only changed their `require` line.
      REST/JSON instead of XML; registration is async (202 → poll `/async-operations/{id}`);
      contacts are saved once via `PUT /contacts` and referenced by id.
    - `config/domainPricing.js` (new) — **Spaceship has no pricing endpoint.** Namecheap's
      live `users.getPricing` is gone, so per-TLD USD costs live here and go through the
      unchanged `usdToGhs()`. Four TLDs are verified against published renewal pricing;
      the rest are marked UNVERIFIED and set high on purpose (overcharging is recoverable,
      selling below cost is not).
    - Callers repointed: `domainController`, `hostingOrderController`, `webhookController`,
      `domainRoutes`, `utils/registerDomainOrder`, `utils/provisionHosting`.
    - `utils/validateEnv.js` — recommends `SPACESHIP_API_KEY`/`SPACESHIP_API_SECRET`.
    - `tests/setup.js` — blanks both Spaceship keys. **Spaceship has no sandbox**, so an
      unmocked path in a test run would spend real money. This guard is load-bearing.
  - **Tests:** `tests/spaceship.test.js` (new, 29) — config gating, `usdToGhs`, E.164 phone
    normalisation, availability incl. premium pricing beating the flat TLD price, unsupported
    TLDs answered without a network call, 20-per-request chunking, the full register →
    poll → success path, year clamping, failure when no operation id comes back, and a
    nameserver failure *after* a paid registration still reporting success (a retry would
    buy the domain twice).
  - **Verified:** full backend suite 57 suites / 501 tests, exit 0; lint 0 errors.
  - **⚠️ Open — needs a decision, see T65.** Spaceship cannot sell `.gh`, `.com.gh` or
    `.africa`. They are in `UNSUPPORTED_TLDS` and rejected before any API call.
  - **Hosting:** no code change. Spaceship's Starlight VPS ships cPanel + WHM with root, so
    `services/whm.js` works as-is — repoint `WHM_HOST` / `WHM_USER` / `WHM_TOKEN` at the new
    VM (needs a prepaid cPanel licence, 1/3/12-month; no PAYG option). Doing this also clears
    T3c's IP-allowlist blocker, since we control the new VM's firewall.
  - **Not done:** `services/namecheap.js` is still on disk (unused) as a rollback path;
    `services/cyberpanel.js` was already dead code before this task — nothing requires it.
    Delete both once the switch is settled in production.

- [x] **T65 · `.com.gh` / `.gh` / `.africa` can no longer be sold — product answer decided** — ✅ closed 2026-08-26
  - **The answer (user, 2026-08-26): we don't resell them.** Customers register these through
    a ghNIC-accredited registrar (they need proof of Ghana business registration anyway), and
    EazWorld connects the resulting domain to their hosting/email.
  - **Already shipped in that direction (commit 4a064a4 frontend / 2366697 backend):**
    - `src/seedBlog.js` — the `.com.gh` post now says up front that international registrars
      don't sell it, names the ghNIC route, and links our own checkout only for the extensions
      we do sell; pricing claims for the three TLDs are gone.
    - `frontend domains/page.jsx` SEO description lists sellable TLDs instead of `.com.gh`/`.africa`.
    - `hosting/checkout` no longer suggests `.com.gh` when a domain is taken (was a dead end).
    - `serviceDetails.js` FAQ answers with the ghNIC explanation instead of listing `.gh`/`.africa`.
    - Backend: the three stay in `UNSUPPORTED_TLDS`, rejected before any API call.
  - **Not chosen:** hunting a reseller carrying ghNIC, or building a quote/manual-order flow —
    revisit if demand shows up.
  - **Context from the original finding:** Spaceship returns `tldNotSupported` for all three
    (verified live 2026-08-25); `.com.gh` is ghNIC-run and requires proof of Ghana business
    registration, so mainstream registrars never resold it either — a pre-existing gap the
    switch exposed, not a regression (`domainorders` had 0 documents). The old copy actively
    advertised all three (blog post with GH₵250–450/yr claims, SEO description, checkout
    suggestion, FAQ) — all fixed as listed above.

- [x] **T62 · Transactional email coverage — audit and close the gaps** — ✅ done 2026-08-26
  - **Why now:** a pre-order customer waits weeks, and today they pay and hear
    nothing. Shop orders send **no customer email at all** — no receipt, no tracking
    number, no status change — while hosting orders send three. That asymmetry is the
    core of this task.
  - **Audited 2026-08-25 against the code, not assumed.**
  - **Already covered (left alone):** auth, contact/consultation, hosting orders,
    repair jobs (`notifyCustomer`), repair collection reminders, pre-order release.
  - **Shipped 2026-08-26 — every send rides Resend via `utils/email.js`'s `send()`,**
    each with its own EmailLog type so the admin log stays filterable:
    - **Shop order confirmation** (`order_confirmation`) — sent once, at payment,
      from `fulfilShopOrder`: order + tracking numbers with a `/track/order/:n`
      button, itemised lines through `formatGhs` (pesewas in, cedi out), delivery
      zone name, and a blue pre-order section carrying each line's
      `preorder.note`/`availableFrom` pulled fresh off the product plus the
      "we'll email you when it reaches our shop" expectation. **Decision:** gaps 1
      and 2 are one email, not two — shop order creation has no touchpoint before
      payment, unlike hosting where order and payment are separate moments, so a
      separate payment-received mail would be two emails in the same second.
    - **Shop status moves** (`shop_status_update`) — processing/shipped/delivered/
      cancelled each get a message, mirroring `notify.js`'s per-status shape.
      Wired into BOTH doors a status walks through (`updateOrderStatus` and
      `addTrackingEvent`, guarded by an actual transition — notes-only tracking
      updates don't email). Paid/pending deliberately have no template: paid IS
      the confirmation above.
    - **Refund outcomes** (`refund_completed`/`refund_failed`) — hooked inside
      `applyRefundOutcome`, so whichever path learns the outcome first (webhook,
      manual `/refund/sync`, reconcile job) tells the customer exactly once. A
      failed refund is not hidden from the person it happened to.
    - **Domain orders** (`domain_confirmation`) — webhook branch emails on
      payment, covering both registration outcomes: registered (years + renewal
      year) or "team is finishing it" (a Spaceship hiccup must not leave a paying
      customer in silence). Renders `price` as raw GH₵ — the T44 Group-C float.
    - **Service deposits** (`service_confirmation`) — package, deposit, balance;
      GHS floats formatted locally, never through pesewas-based `formatGhs`.
  - **Audit item 7 was stale:** `renewal_reminder` and `expired_notice` were NOT
    orphaned — `utils/renewalJob.js` already sends both (30d/7d/1d staging via
    `renewalReminderSent`, expiry notice at suspension), scheduled daily in
    server.js. Nothing to do; recorded here so nobody "wires them up" twice.
  - **Still true (unchanged):** no per-stage pre-order shipment emails — customers
    check tracking; the only other pre-order email is arrival (T45).
  - **From-address:** all senders resolve `RESEND_FROM_EMAIL` → legacy
    `EMAIL_FROM` → default, so a verified Resend sender set once in .env covers
    every template (`utils/email.js`, `utils/hostingEmail.js`, `utils/renewalJob.js`);
    blanked in `tests/setup.js` like the API key, and recommended by validateEnv.
  - **Tests:** `tests/shopTransactionalEmails.test.js` (new, 20) — Resend mocked at
    the module boundary so assertions read real subject/html: receipt content
    incl. tracking link/zone/pre-order note, phone-first quiet return, all four
    status templates + paid/pending silence, refund outcomes incl. settled-once,
    domain both branches, service float formatting, fulfilment idempotency
    (webhook retry never double-emails), endpoint wiring for PATCH status and
    `applyRefundOutcome`, and signed-webhook coverage for domain/service.
    Suite: 61 files / 570 tests green; lint clean.
  - **Frontend part:** `frontend-eaz/tasks.md` → T62 — ✅ (confirmation page shipped
    earlier in cb41a45; nothing further needed).

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
