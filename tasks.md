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