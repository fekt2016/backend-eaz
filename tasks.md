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

- [x] **T2 · Restock inventory on order/repair cancellation** ✅ done 2026-08-20
  - **Issue:** Cancelling a paid order/job (`status → cancelled`) does **not** return the
    stock that was decremented at fulfilment → inventory drifts.
  - **Impact:** MEDIUM data integrity (stock counts wrong over time).
  - **Location:** `controllers/orderController.js` (`updateOrderStatus`),
    `utils/fulfilShopOrder.js`, repair job cancel path
  - **Fix:** On transition to `cancelled` for an order/job that was already decremented,
    guardedly re-increment `Part.quantity` / `Product.stock` / variant stock. Flag to avoid
    double-restock. Add a test.
  - **Shipped:**
    - `models/Order.js` — added `stockDeducted`/`stockRestored` booleans.
    - `utils/fulfilShopOrder.js` — `fulfilShopOrder` now sets `stockDeducted: true` after
      decrementing; added `restockOrderItems(order)` (mirrors the decrement loop, incrementing
      `Part.quantity`/`Product.stock`/variant stock).
    - `controllers/orderController.js` — `updateOrderStatus` and `addTrackingEvent` call
      `restockOrderItems` and set `stockRestored: true` when transitioning to `cancelled`,
      guarded by `order.stockDeducted && !order.stockRestored`.
    - `models/RepairJob.js` — added `stockRestored` boolean.
    - `controllers/pos/jobController.js` (`updateJob`) — snapshots deducted parts before the
      `parts[]` array is reassigned, restores `Part.quantity` for each on transition to
      `cancelled`, guarded by `job.stockDeducted && !job.stockRestored`.
    - `tests/stockRestore.test.js` — 5 tests: order restock (parts + product/variant stock),
      no-restock when never deducted (order cancelled while still `pending`), repair-job
      restock, no-restock when job parts were never deducted, and idempotency (re-cancel
      doesn't double-restock).
  - **Verified:** full backend suite — 21 suites / 130 tests pass.
  - **Source:** AUDIT.md §23, §24 (#5), §29 P1

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

- [x] **T6 · Move hardcoded business config into Settings/env** ✅ done 2026-08-20
  - **Issue:** Shop name/phone, service price list, and contact info are hardcoded.
  - **Location:** `controllers/chatController.js` (`KNOWLEDGE`),
    `services/notify.js` (`SHOP_NAME`/`SHOP_PHONE`/pricing copy)
  - **Fix:** Extend `Settings` model (business profile) or env; read from there.
  - **Note:** `notify.js` had no hardcoded pricing copy — that half of the audit's Location
    note didn't hold up on inspection; only `SHOP_NAME`/`SHOP_PHONE` (already env-backed
    with a hardcoded fallback default) were in scope there.
  - **Source:** AUDIT.md §24 (#3), §26, §27 (#6)
  - **Shipped:**
    - `models/Settings.js` — new `business` sub-document: `shopName`, `shopPhone`,
      `whatsapp`, `email`, `location`, `hours`, `consultationPath`, `services[]`
      (name/price/path), seeded with the previous hardcoded values as schema defaults so
      existing behavior is unchanged until an admin edits them.
    - `utils/businessProfile.js` — new `getBusinessProfile()`: reads `Settings.business`
      with a 5-minute in-memory TTL cache (falls back to `SHOP_NAME`/`SHOP_PHONE` env vars,
      then hardcoded defaults, if Settings is empty or the DB is unreachable — chat/SMS/
      email must never break on a config lookup). `clearBusinessProfileCache()` is called
      by `updateSettings` so admin edits apply immediately, not after the TTL.
    - `controllers/chatController.js` — removed the hardcoded `KNOWLEDGE` const;
      `ruleBasedResponse(message, knowledge)` now takes the profile as a parameter, fetched
      once per `sendMessage` call. The Location/Contact/fallback response blocks (which
      separately duplicated the phone/email/hours as freeform text, not sourced from
      `KNOWLEDGE` even before this change) now interpolate the same profile too.
    - `services/notify.js` — `STATUS_MESSAGES`/`EMAIL_MESSAGES` value functions and
      `_renderRepairEmail`/`_sendHubtelSms` now take the business profile as a parameter
      instead of closing over module-level `SHOP_NAME`/`SHOP_PHONE` consts.
    - `controllers/settingsController.js` — `GET`/`PATCH /api/v1/settings` now
      read/write `business` (admin-only for PATCH, same as other settings), with input
      sanitized via the existing `sanitizeMessage` helper.
    - **Not touched (out of scope):** the per-service narrative blurbs in
      `chatController.js` (SEO/Paid Ads/Branding/etc. tier breakdowns, e.g. "Local SEO —
      GHS 800/month") are freeform marketing copy that already duplicated the top-level
      price ranges independently of `KNOWLEDGE`/`Settings`; the audit's "Location" pointer
      named only `KNOWLEDGE`, and turning that prose into templated config is a
      materially bigger job than this task's scope. Flagging for a follow-up if wanted.
    - No frontend Settings UI was added for the new `business` fields — updates go via
      `PATCH /api/v1/settings` directly for now.

- [x] **T8 · Rename misleading `*Ghs` money fields → `*Pesewas`** ✅ done 2026-08-20
  - **Issue:** Post money-migration, fields like `unitPriceGhs`/`amountGhs` now carry
    pesewas — accurate values, misleading names.
  - **Location:** POS models/controllers (`PartOrder`, `RepairOrder`, related handlers)
  - **Fix:** Rename in a coordinated migration (fields + all readers/writers). Behavior-
    preserving.
  - **Source:** AUDIT.md §27 (#4)
  - **Pre-check:** confirmed via a read-only query against the live Mongo cluster that
    `partorders`/`repairorders` currently hold **0 documents** — nothing to migrate.
    Approved as a straight rename (no dual-field/backfill step).
  - **⚠️ Turned out not to be backend-only:** the renamed fields are part of the wire
    contract for two customer/staff-facing pages, so this required matching
    `frontend-eaz` changes too — see `frontend-eaz/tasks.md` → T8.
  - **Shipped:**
    - `models/PartOrder.js` — `unitPriceGhs` → `unitPricePesewas`, `amountGhs` →
      `amountPesewas`.
    - `models/RepairOrder.js` — `items[].unitPriceGhs` → `items[].unitPricePesewas`.
    - `controllers/pos/inventoryController.js` (`createPartOrder`) — local vars +
      `PartOrder.create()` call updated to the new names.
    - `controllers/pos/jobController.js` — `getJobByToken`'s `.select()` and response
      DTO (`partOrders[].amountPesewas`, `repairOrders[].items[].unitPricePesewas`),
      and `createRepairOrder`'s line-item builder.
    - `controllers/pos/jobController.js:541` — also renamed the unrelated-but-confusing
      `priceGhs` DTO key (derived from `RepairJob.parts[].priceAtTime`, not a stored
      `*Ghs` field) to `pricePesewas` for consistency, per explicit instruction.
    - `controllers/webhookController.js` — `applyPaidPartToJob`'s `item.unitPricePesewas`
      param, and both call sites (`fulfilPartOrder`, `fulfilRepairOrder`).
    - `src/migratePosMoneyToPesewas.js` — updated the `partorders`/`repairorders`
      pipelines to read the old `unitPriceGhs`/`amountGhs` names (for the hypothetical
      case of a still-unmigrated legacy backup) and write the current
      `unitPricePesewas`/`amountPesewas` names, so the script stays useful/correct
      against today's schema instead of silently writing to dead field names.
    - `tests/paidPartFulfilment.test.js`, `tests/posMoneyMigration.test.js` — updated
      fixtures/assertions to the new field names; added a `repairorders` migration case
      (the previous test only covered `partorders`).
    - **Frontend (`frontend-eaz`):** `app/track/[token]/page.jsx` (customer-facing part
      list + order history) and `app/dashboard/pos/orders/page.jsx` (staff orders list)
      updated to read `pricePesewas`/`amountPesewas` from the API. Full detail in
      `frontend-eaz/tasks.md` → T8.
    - **Not touched (deliberately out of scope):** `track/[token]/page.jsx`'s own local
      cart-state field also happens to be named `unitPriceGhs` (`cart[].unitPriceGhs`,
      `partsSubtotalGhs`) — it's a client-only derived display value
      (`part.sellingPrice / 100`), never sent to or read from the renamed backend
      fields, so renaming it isn't part of this fix. Flagging as a residual naming
      quirk in the same file if it's ever worth a follow-up cleanup.
    - Full backend suite (22 suites / 137 tests) and frontend `next build` + `next lint`
      on both touched files pass.

- [x] **T10 · Add backend lint tooling (optional)** ✅ done 2026-08-20
  - **Issue:** No ESLint/lint script on the backend (plain JS by design).
  - **Location:** `backend-eaz`
  - **Fix:** Add an ESLint config + `lint` script matching the CommonJS style.
  - **Source:** AUDIT.md §27 (#7), §28
  - **Shipped:**
    - `eslint.config.js` (flat config) — `@eslint/js` recommended +
      `eslint-plugin-n`'s `flat/recommended-script` (CommonJS/Node-correctness rules:
      unresolvable `require()`s, Node-builtin version support, etc.), `globals` for
      node/jest env globals. `no-unused-vars` set to `warn` (not `error`, args ignored,
      `^_` escape hatch) rather than off, so dead code stays visible without failing CI.
      `no-empty` keeps `allowEmptyCatch: true` for the `catch (_) {}` idiom used by
      `scripts/*.js`'s best-effort disconnect-before-exit handlers.
    - `package.json` — `"lint": "eslint ."` script; added `engines.node: ">=18.0.0"`
      (accurate — `services/notify.js`/`reminderJob.js` use global `fetch`, stable since
      Node 18) so eslint-plugin-n's Node-builtin-support check reads the real target
      instead of an unset/ancient default.
    - Installed `eslint`, `eslint-plugin-n`, `globals`, `@eslint/js` as devDependencies
      (peer resolution landed on eslint ^9.39.5 / eslint-plugin-n ^17.24.0, not the
      newest majors — eslint-plugin-n doesn't yet support eslint 10).
    - **Real bugs the first lint run caught and fixed** (not style — genuine broken code
      paths, verified against `services/*.js` targets before fixing):
      - `controllers/webhookController.js` (Paystack webhook, hosting-renewal branch) —
        `base` was declared inside the `if (parent) {...}` block but read outside it at
        the activity-log call a few lines down → **always** threw
        `ReferenceError: base is not defined` on every hosting-renewal webhook, and
        `parent._id` would also have thrown if the parent order wasn't found. Hoisted
        `base` to the outer scope (`null` when no renewal happened) and switched to
        `hostingOrder.parentOrderId` (same id, never null) for the log fields.
      - `controllers/pos/staffController.js` (`createStaff`, `POST /pos/staff`) —
        `require('../utils/sanitize')` resolved to the nonexistent
        `controllers/utils/sanitize.js` (should be `../../utils/sanitize`, two levels up
        from `controllers/pos/`) → every staff-account creation 500'd. No test coverage
        existed for this endpoint. Fixed the path.
      - `controllers/pos/jobController.js` (`triggerReminders`,
        `POST /pos/reminders/trigger`) — same `../` vs `../../` mistake for
        `require('../services/reminderJob')` → manual reminder trigger always 500'd.
        Fixed the path.
      - `controllers/index.js` — a 4-line ESM (`export * from ...`) barrel file, present
        since the very first commit, never `require()`'d anywhere in the codebase (would
        SyntaxError if it ever were — Node's CommonJS loader can't parse `export`).
        Confirmed dead via full-repo grep + git history, then deleted per the project's
        "if certain it's unused, delete it" convention — it was also a parse error
        blocking a clean lint run.
      - `controllers/authController.js` (`logout`) — already-tracked **T40**
        (`jwt.decode` used without importing `jsonwebtoken`); fixed out of queue order
        with explicit user confirmation since the new tooling surfaced it as a live
        `no-undef` error on its first run. See T40 above for detail.
    - **Suppressed with a scoped, commented `eslint-disable` (not a config-wide off)**,
      because both are deliberate, verified-correct patterns rather than bugs:
      - `server.js`'s two `require("./socket/socketServer")` /
        `require("./utils/memoryMonitor")` — genuinely-missing, **intentionally
        optional** modules already guarded by `try { require(...) } catch (error) { if
        (error.code === 'MODULE_NOT_FOUND') ... }` graceful-degradation blocks.
      - `services/notify.js` / `services/reminderJob.js`'s two `fetch()` calls to
        Hubtel — global `fetch` is stable/unflagged since Node 18 in practice, but
        eslint-plugin-n's compat data still marks it "Experimental" per Node's own
        stability index until v21; not worth bumping `engines.node` to 21 just to
        silence this.
    - **Baseline left as-is (269 pre-existing warnings, not errors):** almost entirely
      `no-unused-vars` from the `controllers/pos/*.js` pattern of destructuring the
      *entire* `common.js` export list per controller even when a given file only uses
      a subset — a pre-existing repo-wide style choice, not new dead code. `npm run
      lint` exits 0 with this baseline (warnings don't fail it); scrubbing all 269 is a
      separate, much larger cleanup this task didn't ask for and isn't attempted here.
    - Full backend suite (22 suites / 137 tests) still passes after all fixes.

- [x] **T11 · Refresh dependency vulnerability audit** ✅ done 2026-08-20
  - **Issue:** The stale `AUDIT_REPORT.md` lists CVEs for packages no longer in the project
    (Vite, react-router, styled-components). A fresh audit is needed against the *current*
    dependency set.
  - **Location:** both apps
  - **Fix:** Run `npm audit` in `backend-eaz` and `frontend-eaz`, triage results, apply
    non-breaking fixes. (New action — do not copy the old CVE list.)
  - **Source:** supersedes AUDIT_REPORT.md "Security Vulnerabilities"
  - **Shipped:**
    - **`backend-eaz`:** 14 vulnerabilities (7 moderate, 7 high) → **0**. `npm audit fix`
      (no `--force`) resolved everything — all fixes were same-major, in-range bumps
      already permitted by the existing `^` semver ranges (`mongoose` 8.19.3→8.24.3,
      `express` 4.22.1→4.22.2, `resend` 6.9.3→6.21.0, `axios` 1.13.6→1.19.0, plus
      transitive `body-parser`/`qs`/`morgan`/`path-to-regexp`/`form-data`/`uuid`/
      `lodash`/`brace-expansion`/`picomatch` patch bumps). No direct dependency needed
      a major-version change. Full suite (22 suites/137 tests) and `npm run lint`
      (0 errors) still pass afterward.
    - **`frontend-eaz`:** 14 vulnerabilities (3 moderate, 10 high, 1 critical) →
      **10 (3 moderate, 6 high, 1 critical) remaining, not fixed.** `npm audit fix`
      resolved 4 (`picomatch`, `js-yaml`, `flatted`, `brace-expansion` — all transitive,
      same-major patch bumps). The remaining 10 all require `npm audit fix --force`,
      which would: **(a)** bump `next` 14→**16** — a major-version jump across two
      majors, directly contradicting this project's documented stack (`CLAUDE.md`:
      "Next.js 14 App Router") and almost certainly requiring an App Router migration
      pass, not a safe autofix; **(b)** bump `eslint-config-next`/`@next/eslint-plugin-next`
      to 16.x (version-coupled to `next`, same concern); **(c)** bump `vitest`/`vite`/
      `esbuild` to new majors (the "critical" entry — a Vitest UI dev-server
      arbitrary-file-read issue, `devDependency` only, exploitable only if someone runs
      `vitest --ui` and exposes that dev server; not a production/runtime risk, but the
      version bump risks silently breaking the 9 existing test files' config).
      **Deliberately left un-forced** per this task's own scope ("apply non-breaking
      fixes") — flagging the Next 14→16 upgrade and the Vitest major bump as two
      separate, deliberate migration decisions for whenever you want to schedule them,
      not something to force through here. Full suite (9 files/67 tests), `npm run lint`,
      and `next build` all still pass on the un-forced state.
    - `AUDIT_REPORT.md`'s old CVE list was not consulted or copied — this is a fresh
      audit against current `package-lock.json` state per the task's own instruction.

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

- [x] **T12 · In-app notifications / alert center** — no model/API/UI (only SMS + email exist). — AUDIT.md §24 (#1)
  - **v1 scope (agreed with product owner before implementation):** generic per-user
    `Notification` model + polling API (`/api/v1/notifications`: list, unread-count,
    mark-read, mark-all-read) + a small helper (`utils/notifications.js`: `notify()`,
    `notifyRoles()`) — server-created only, no client-facing create endpoint. Two v1
    triggers wired end-to-end: (1) a repair job's assigned technician gets notified on
    creation and on reassignment (`controllers/pos/jobController.js`); (2) admin/staff/
    superadmin get notified when a shop order transitions pending→paid
    (`utils/fulfilShopOrder.js`, the same idempotent choke point the webhook and manual-
    verify paths both call). Frontend: `NotificationBell` (bell + unread badge + dropdown)
    wired into both `DashboardShell` and `PosShell` topbars (commerce reuses
    `DashboardShell` already), plus a `/dashboard/notifications` page (all/unread filter,
    pagination, mark-all-read).
  - **Explicitly out of scope this pass** (agreed up front, to not bleed into T13/T14/T15):
    AI/smart summarization (T13), notification-preferences/settings UI (T14), refund
    triggers (T15, refunds don't exist yet), customer-facing in-app notifications
    (customers already get SMS/email via `services/notify.js`), real-time/websocket
    delivery, push notifications. More trigger events (low stock, payment received,
    domain/hosting expiry, warranty expiring) are follow-up tasks, not part of T12.
  - **Decisions made explicit, not left as oversights:** unread-count badge polls every
    30s (`refetchInterval`, matches the app's global 30s `staleTime` default; pauses
    automatically when the tab is backgrounded — react-query default). Read notifications
    auto-expire 90 days after `readAt` via a partial-filter TTL index
    (`{ readAt: 1 }, { expireAfterSeconds: 90d, partialFilterExpression: { read: true } }`)
    — unread notifications never expire, so nothing disappears before it's seen.
  - **Bug found + fixed during implementation:** `job.populate([...])` mutates the
    Mongoose document in place, so reading `job.assignedTo.toString()` *after* that call
    (as the pre-existing `afterSnapshot` for the activity-log diff already did) returns
    Mongoose's debug-inspect string, not the hex id — passing that into `notify()` as a
    recipient threw a cast error. Fixed by capturing `newAssignedTo` from `job.assignedTo`
    *before* the populate call, dedicated to the notification, and left the pre-existing
    (cosmetic-only, activity-log-diff) `afterSnapshot.assignedTo` behavior alone as
    out-of-scope for this task.
  - **Tests:** `tests/notifications.test.js` — API (list scoped to own user, unread-count,
    mark-read ownership check, mark-all-read scoping) + both triggers (assign on create,
    reassign notifies only the new technician, new-order notifies admin/staff/superadmin
    but not technician/customer, idempotent on duplicate fulfilment). Full regression run
    with the job/order suites this touches: 6 suites / 44 tests passed. Frontend:
    `useNotifications.test.jsx` (7 tests); full `vitest run`: 27 files / 126 tests passed.
    Lint clean both sides; `next build` succeeded.
- [x] **T13 · AI chat responses** — `getAIResponse` is a stub returning `null`; only rule-based replies today. — AUDIT.md §23, §24 (#2)
  - **v1 scope (agreed with product owner before implementation):** filled in the existing
    `getAIResponse(messages, userMessage)` hook in `controllers/chatController.js` — no other
    part of the chat system (model, session lifecycle, human-handoff flow) changed. Model:
    `claude-sonnet-5` (explicit choice — Opus 5 is the tool's own default, but flagged the
    cost tradeoff for this low-stakes FAQ bot and the user picked Sonnet 5 over Opus
    5/Haiku 4.5). New dependency: `@anthropic-ai/sdk`. `ANTHROPIC_API_KEY` added to
    `.env.example` and to `validateEnv.js`'s *recommended* (not required) list — unset key
    means `getAIResponse` returns `null` immediately, same "optional integration, degrade
    gracefully" pattern as `namecheap.hasConfig()`/`whm.hasConfig()`.
  - **Design:** system prompt built from `getBusinessProfile()` — the same knowledge object
    the rule-based engine already uses — with an explicit "only quote what's in this list,
    otherwise say you'll connect them with a human" instruction (hallucination guardrail on
    real pricing). History (`session.messages`, roles `user`/`bot`/`admin`) mapped to
    Anthropic's `user`/`assistant` and truncated to the last 12 messages sent per call (full
    history stays in Mongo). Non-streaming call, `max_tokens: 500`. Any SDK error (rate
    limit, timeout, auth) is caught and returns `null` — falls straight through to the
    existing rule-based engine, never breaks the request.
  - **Explicitly out of scope this pass** (agreed up front): no changes to General Business
    Settings (T14) — reads the profile as-is, adds no settings fields or admin toggle beyond
    "is the API key set"; no refund logic (T15); no tool use/function calling — the AI only
    answers in text, cannot book consultations or touch real orders/accounts; no
    AI-generated quick-reply suggestion chips (still rule-based-engine-only; `suggestions: []`
    on the AI path, and the frontend widget already renders that correctly); no streaming,
    voice, or image input; no usage/cost dashboard or per-session spend caps — the existing
    `/api/v1/chat` IP rate limit (60 req/15 min, `app.js`) plus the `max_tokens` cap and
    history truncation are the v1 cost controls.
  - **Frontend:** none required — checked `ChatWidget.jsx`; it already does
    `json.data.suggestions || []` and only renders the suggestion-chip row when non-empty, so
    the AI path's empty `suggestions` needed no widget change. `frontend-eaz`'s
    `task-t13-ai-chat-responses` branch was created (chained correctly off T12) but carries no
    commits — genuinely nothing to change there.
  - **Tests:** `tests/chatAI.test.js` (7 tests) — falls back to rule-based with no API key;
    uses the AI response when configured; falls back to rule-based on an API error; system
    prompt is grounded in business-profile services; bot/admin history maps to `assistant`
    with the latest user message last; history truncates to 12; AI is never called once a
    human agent has taken over (`humanRequested`). Full backend suite run afterward to confirm
    no regressions from the new dependency. Lint clean.
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
- [ ] **T15 · Refunds** — no refund endpoint or Paystack refund call anywhere. — AUDIT.md §24 (#4)

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

- [x] **T31 · `createSale` must support shop products (accessories) too** ✅ done 2026-08-21
  - **Issue:** The POS Sell page should sell **both** repair parts **and** shop
    products/accessories. `createSale` already branches on `partId` vs `productId` — confirm
    the product path works (stock check, `$inc`, `Sale.create`) and doesn't hit the T30 500.
  - **Location:** `controllers/pos/salesController.js` (`createSale` product branch),
    `models/Sale.js`, `routes/posRoutes.js` (`/pos/inventory` `includeProducts`)
  - **Fix:** Verify products complete a sale correctly; add tests for a product-only sale and a
    mixed parts+products sale. Frontend part: `frontend-eaz/tasks.md` → T31.
  - **Verified:** the product branch was already logically correct (stock check, `$inc`,
    `Sale.create` all handled products the same as parts) but shared the exact T30 500 —
    fixed together. `tests/posSale.test.js` covers a mixed parts+products sale and a
    products-only sale, both passing.

- [x] **T30 · POS sale `createSale` 500 when selling parts** ✅ done 2026-08-21
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
  - **Root cause confirmed (reproduced live, not guessed):** `const [sale] = await
    Sale.create([{...}], { session })` correctly destructures the single created doc into
    `sale` (the response itself, `res.json({ data: sale })`, was already correct) — but the
    post-commit `logFromRequest` call referenced `sale[0].saleNumber` etc., and `sale[0]` is
    `undefined` on a plain object. That threw *after* the transaction had already committed
    (sale saved, stock deducted), so the 500 masked a sale that had actually gone through.
  - **Second, more severe bug found in the same code path:** the `catch` block's unconditional
    `session.abortTransaction()` then threw a *second*, unhandled `MongoTransactionError`
    ("Cannot call abortTransaction after calling commitTransaction") — unhandled because
    nothing wraps a catch block's own throw — and `server.js` treats unhandled promise
    rejections as fatal (`process.exit(1)`). So this bug didn't just 500 one request, it
    crashed the entire backend server. Confirmed by direct reproduction against a real
    transaction-capable Mongo instance before fixing.
  - **Third finding, escalated to the user before implementing (approved: fold into T30
    now):** while building a flake-free regression test, direct reproduction turned up
    MongoDB's default `maxTransactionLockRequestTimeoutMillis` (5ms — intentionally
    aggressive; transactions are expected to retry on contention via the driver's
    `session.withTransaction()` helper). `createSale`/`voidSale` used raw
    `startTransaction()`/`commitTransaction()` with **no retry**, so ordinary concurrent
    writes to the same part/product (two cashiers selling the same item at once) could 500 a
    perfectly legitimate sale in production, not just in a rapid-fire test loop. Not a test
    artifact — reproduced the exact same error class against real transaction semantics.
  - **Shipped:**
    - `controllers/pos/salesController.js` — `sale[0]` → `sale` (the actual T30 bug).
      `createSale` and `voidSale` both refactored from raw
      `startTransaction()`/`commitTransaction()`/`abortTransaction()` to
      `session.withTransaction(callback)`. Business-rule aborts (insufficient stock, not
      found, underpaid, already voided) now `throw new SaleError(statusCode, message)` from
      inside the callback instead of `await session.abortTransaction(); return res.status(...)`
      — `withTransaction()` handles abort/commit/retry itself; a small `SaleError` class
      (thrown only for deliberate business rules, never DB/transient errors) is caught once
      outside the transaction and turned into the matching HTTP response. Removed the
      earlier `session.inTransaction()` guard this same session added — no longer needed,
      since `withTransaction()` never leaves an ambiguous abort-after-commit state.
    - `tests/posSale.test.js` (new, 6 tests) — its own scoped single-node
      `MongoMemoryReplSet` (real transaction support; standalone `mongodb-memory-server`
      can't run transactions at all). **`tests/setup.js` and the other 33 test files are
      untouched** — only this file pays the ~500ms replica-set startup cost (measured), the
      rest keep the fast standalone instance. Covers: a parts-only sale completes 201/sale
      persisted once/stock deducted (T30 regression); an underpaid sale rejected without
      touching stock; a mixed parts+products sale and a products-only sale (T31
      verification); insufficient product stock rejected cleanly; **two simultaneous sales
      against the same part both completing (201/201, not one 500)** — a direct regression
      test for the `withTransaction()` retry fix, proving it under real contention, not just
      absence-of-flakiness.
  - **Verified:** reproduced the original bug live against a real transaction-capable Mongo
    instance before fixing (confirmed both the 500-after-commit and the process-crashing
    second error), then confirmed the fix live (201, sale persisted once, stock correct).
    `tests/posSale.test.js` run 15+ times back-to-back with zero failures after the
    `withTransaction()` fix (vs. reproducible ~1-in-3 failures before it, using only test
    infrastructure changes — the flakiness only fully resolved once the production code was
    fixed, confirming this was a real bug and not a test-environment artifact). `npm run
    lint` 0 errors (37 pre-existing unrelated warnings, same shared-destructure pattern as
    every other `controllers/pos/*.js` file). Full suite via `npm test` (`--runInBand`) 34
    suites / 225 tests, all pass — confirms the other 33 files are unaffected by the new
    replica-set-backed file.

- [x] **T29 · Role-based landing pages after login** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T29 for the full Shipped/Verified notes
  - **Issue:** The frontend currently redirects admin/superadmin to `/dashboard/pos` /
    `/dashboard/pos/sell` after login instead of the Overview page.
  - **Fix (frontend):** admin/superadmin → **Overview** (`/dashboard`); staff → **Sell**
    (`/dashboard/pos/sell`); technician → `/dashboard/pos`; customer → `/`. Apply also after
    email/2FA verification.
  - **Location:** frontend — `frontend-eaz/src/app/auth/login/page.jsx`
  - **Note:** frontend-only redirect change; **no backend change required** (see
    `frontend-eaz/tasks.md` → T29).

- [x] **T28 · Admin order edits centralized on the detail page** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T28 for the full Shipped/Verified notes
  - **Issue:** The frontend admin orders list has inline status updates; all order editing
    should live on the order detail page. The POS orders list also uses card layout and should
    become a table.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/orders/page.jsx`,
    `frontend-eaz/src/app/dashboard/orders/[id]/page.jsx`,
    `frontend-eaz/src/app/dashboard/pos/orders/page.jsx` (card → table)
  - **Fix:** Frontend-only reorganization — make the list read-only with links to the detail
    page where all updates happen, and convert the POS orders cards to a table; **no backend
    change required** (see `frontend-eaz/tasks.md` → T28).

- [x] **T27 · Confirm product-review endpoints ready for order-page form** ✅ already resolved (audited 2026-08-21)
  - **Issue:** The customer order detail page needs a product review form. The backend
    endpoints already exist (`POST /api/v1/products/:productId/reviews`, `GET/PATCH
    …/reviews/mine`) — confirm they work for a product bought in an order and gate review
    submission to customers who actually ordered the item (optional).
  - **Location:** `routes/productRoutes.js`, `controllers/productReviewController.js`,
    `models/ProductReview.js`
  - **Fix:** Verify/complete review endpoints; optionally require a verified order of that
    product before allowing a review. Frontend form lives in `frontend-eaz/tasks.md` → T27.
  - **Already resolved:** confirmed `routes/productRoutes.js` has a full set —
    `POST /:productId/reviews`, `GET/PATCH …/reviews/mine`, `GET …/reviews`, plus
    `GET …/reviews/eligibility` — and `productReviewController.getReviewEligibility`
    already gates on `hasVerifiedPurchase(req.user, item._id)` before allowing a review
    (`canReview: verifiedPurchase && !alreadyReviewed`). This predates this session (part
    of the purchase-verified-reviews work logged before this session's commits began) —
    not something this session's tasks touched. The **frontend** half (T27 in
    `frontend-eaz/tasks.md`, the actual review form on `/dashboard/orders/[id]`) is still
    genuinely missing — confirmed no review-related code exists on that page — so
    MASTER_TASK_ORDER.md's T27 line stays unchecked; only this backend-side sub-task is
    resolved.

- [x] **T26 · Endpoint for the list of registered domains** ✅ done 2026-08-21
  - **Issue:** The frontend Domains page needs to show the list of **registered domains**
    (names the user owns + status/expiry), not just domain order records.
  - **Location:** `routes/domainRoutes.js`, `controllers/domainController.js`,
    `models/DomainOrder.js`
  - **Fix:** Add a registered-domains endpoint (e.g. `GET /api/v1/domains/my` returning owned/
    registered domains with name, status, expiry) or return registered-domain data from the
    existing orders endpoint. Frontend wiring lives in `frontend-eaz/tasks.md` → T26.
  - **Found while investigating:** the data source already existed and was already being
    populated — `webhookController.js`'s Paystack handler pushes `{ domain, orderId, years,
    registeredAt, expiresAt, status: 'active' }` onto `User.domains[]` the moment Namecheap
    registration succeeds (`models/User.js` already had the sub-schema). Nothing anywhere in
    the codebase ever read it back out. No new data model or webhook change needed — just an
    endpoint to expose what was already being written.
  - **Shipped:** `controllers/domainController.js` — new `getMyRegisteredDomains`:
    `User.findById(req.user._id).select('domains').lean()`, sorted soonest-expiring first
    (`expiresAt` ascending) so renewals-due surface at the top. `routes/domainRoutes.js` —
    `GET /domain/my`, `protect`-only (a customer's own domains, no admin variant needed).
    `tests/myRegisteredDomains.test.js` (new, 4 tests): empty list for no domains; sort order
    correct across two domains; scoped to the caller only, never another user's; 401 without
    auth.
  - **Verified:** 4/4 new tests pass; `npm run lint` 0 errors; full suite via `npm test`
    (`--runInBand`) 35 suites / 229 tests, all pass.

- [x] **T25 · Hosting page should only show hosting-account related content** ✅ already resolved (audited 2026-08-21) — frontend-only, see `frontend-eaz/tasks.md` → T25 for the full audit notes
  - **Issue:** The frontend Hosting page mixes content not strictly related to the user's
    hosting account(s).
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/hosting/page.jsx`
  - **Fix:** Frontend-only cleanup of the hosting list/detail pages to show only hosting-account
    content; **no backend change required** (see `frontend-eaz/tasks.md` → T25). Confirm the
    hosting API responses only return hosting-order data.
  - **Confirmed:** `useHostingOrders` hits the dedicated `GET /hosting/orders` endpoint only —
    no mixing with `DomainOrder` or any other resource.

- [x] **T24 · Merge "Marketplace" and "Inventory" into one page** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T24 for the full Shipped/Verified notes
  - **Issue:** The frontend has separate Marketplace and Inventory pages that should be one.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/commerce/page.jsx`,
    `frontend-eaz/src/app/dashboard/commerce/inventory/page.jsx`
  - **Fix:** Primarily a frontend merge (see `frontend-eaz/tasks.md` → T24). Confirm no
    backend endpoint change is needed (both views likely share `/api/v1/products`,
    `/api/v1/inventory`).
  - **Confirmed:** the merged page still calls the same existing `/pos/inventory` and
    `/products/all` endpoints throughout — no backend change needed.

- [x] **T23 · Remove "New Job" button from Overview dashboard** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T23 for the full Shipped/Verified notes
  - **Issue:** The frontend Overview page (`/dashboard`) shows a "New Job" button that should
    not be there; creating a repair job belongs in the POS/Jobs area.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/page.jsx`
  - **Fix:** Frontend-only removal of the Overview "New Job" button and empty-state create link;
    **no backend change required** (see `frontend-eaz/tasks.md` → T23).

- [x] **T22 · Integrate "My Repairs" and "My Jobs" into one page** ✅ done 2026-08-21 — frontend-only, see `frontend-eaz/tasks.md` → T22 for the full Shipped/Verified notes
  - **Issue:** Two overlapping views of repair jobs exist — customer "My Repairs"
    (`/dashboard/repairs`, `useMyRepairs`) and technician "My Jobs" (`/dashboard/pos`,
    `useJobs`). They should be one integrated page.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/repairs/page.jsx`,
    `frontend-eaz/src/app/dashboard/pos/page.jsx`
  - **Fix:** Primarily a frontend merge (see `frontend-eaz/tasks.md` → T22). Confirm the backend
    endpoints backing each (`GET /api/v1/pos/jobs?assignedTo=me` vs the repairs endpoint) and
    whether a single unified endpoint/hook is needed.
  - **Confirmed no backend unification needed:** the two endpoints have genuinely different
    scoping semantics — `GET /track/mine` matches by the caller's own phone/email (customer
    ownership), `GET /pos/jobs?assignedTo=me` matches by technician assignment. Collapsing
    them into one endpoint would conflate two different authorization models for no benefit;
    the frontend fix routes each role to the correctly-scoped one instead of showing a
    redundant third view.

- [x] **T21 · Technicians have NO hosting/domain access — backend + audit**
  - **Issue:** Technicians must have **zero** access to anything hosting- or domain-related.
    Confirm the backend routes (`/api/v1/hosting/*`, `/api/v1/domains/*`) return 401/403 for
    technicians, and that no technician-facing endpoint leaks hosting/domain data.
  - **Location:** `routes/hostingOrderRoutes.js`, `routes/domainRoutes.js`, `middleware/auth.js`
  - **Fix:** Audited every route in both files. `restrictTo(...)` routes already excluded
    technician. The `protect`-only routes (any logged-in role, including technician —
    customer-self-service endpoints) now also get a new `denyRoles('technician')` middleware
    added to `middleware/auth.js`, applied on: `domainRoutes.js` (`/payment`, `/my`, `/orders`,
    `/orders/:id`) and `hostingOrderRoutes.js` (`/orders` POST+GET, `/orders/by-reference/:reference`,
    `/orders/:id/invoice`, `/orders/:id/cpanel-login`, `/orders/:id/status`, `/orders/:id`,
    `/orders/:id/proof`, `/orders/:id/renew`, `/orders/:id/password`). Public lookup routes
    (`/check`, `/search`, `/suggest`, `/plans`) return no user data, left as-is. No other
    controllers reference `HostingOrder`/`DomainOrder`. Frontend nav/widget hiding for
    technicians lives in `frontend-eaz/tasks.md` → T21.
  - **Test verification:** initial `mongodb-memory-server` failures were a red herring — the
    `dyld: Symbol not found: __ZTVNSt3__13pmr25monotonic_buffer_resourceE` came from an ad-hoc
    diagnostic script that let the package default to mongod 8.x (needs macOS 14+; host is
    12.7.6). `tests/setup.js` already correctly pins to 7.0.14, which starts fine standalone —
    the real failure was 5 jest workers each launching mongod concurrently and timing out
    under sandbox resource contention. `--runInBand` fixed it. Added
    `tests/technicianHostingDomainAccess.test.js` (14 tests: 403 for technician on every
    newly-guarded route in both files, + 2 regression checks that a plain `user` still gets
    200). Full run: 6 suites / 52 tests passed.

- [x] **T20 · Hide repair/technician form when job is done or cancelled**
  - **Issue:** The Technician Update + Parts forms on the repair job detail page remain editable
    after the job is finished or cancelled.
  - **Location:** frontend — `frontend-eaz/src/app/dashboard/pos/jobs/[id]/page.jsx`
  - **Fix:** Frontend-only change — hide/make read-only for `ready`/`collected`/`cancelled`;
    **no backend change required** (see `frontend-eaz/tasks.md` → T20, implemented there).

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