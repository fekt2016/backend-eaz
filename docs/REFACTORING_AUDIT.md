# EazWorld — Refactoring & Readability Audit

_Generated 2026-08-16. Read-only assessment — no code was changed._

This report ranks concrete refactoring opportunities across both apps. Every item is
**behavior-preserving** unless flagged otherwise. Priority = impact × how often the code is
touched; effort and risk are called out so you can sequence the work.

Legend — **P0** highest value · **P1** high · **P2** medium · **P3** nice-to-have.

> **Progress (updated 2026-08-16):**
> - ✅ **P0-1** — `posController.js` split into `controllers/pos/*` (barrel keeps routes unchanged; exports verified identical; POS tests pass).
> - ✅ **P1-1** — shared backend utils created (`utils/regex.js`, `phone.js`, `money.js`, `logger.js`); `escapeRegex`/`normalizePhone` duplication removed.
> - ✅ **P0-2** — frontend `formatGhs` upgraded to `GH₵1,234.56` and adopted across ~30 inline sites (26 files now import it).
> - 🟡 **P1-3** — in progress on the POS job page (1,135 → **838 lines**):
>   - payment logic → `hooks/useMomoCharge.js` + `useCardCharge.js`;
>   - presentational sections → `_components/JobHeader.jsx`, `CustomerDeviceCard.jsx`, `JobInvoice.jsx` (+ shared `jobStatus.js`).
>   - Remaining (state-coupled, best done with the app running): the Technician form, Parts editor, Record-payment form, and the MoMo/Card payment panels. Other large components (ChatWidget, users/chats pages) untouched.
> - 🟡 **P2-1** (logger) — wired `utils/logger` into the background-job/integration files (`services/reminderJob`, `notify`, `namecheap`; `utils/renewalJob`, `provisionHosting`) — 50 `console.*` calls mapped to `logger.info/warn/error`. **Deliberately skipped** the Paystack webhook (payment hot path) and startup files (`server.js`, `app.js`, `validateEnv.js`), where `console` is conventional.
> - 🟡 **P2-2** (money) — wired `utils/money`'s `formatGhs` into 6 safe activity-log/fulfilment **description strings**. **Deliberately skipped** the cedis↔pesewas conversions in the webhook / order-amount path — those belong to `PHASE7_MONEY_MIGRATION_PLAN.md`, not a mechanical refactor.
> - ✅ **P1-2** — resolved as **dead-code removal, not a migration**: `caseStudyStyles.js` (1,213 lines) had zero importers; the case-study UI already uses Tailwind in `PortfolioDetail.jsx`. Deleted the file and dropped `styled-components` from `package.json` (it was the only consumer) — build clean, styled-components fully gone. The original audit assumed a migration; the reality was an orphan left behind after the Tailwind rewrite.
> - Note: the "react-query installed but unused" claim in CLAUDE.md is **stale** — `hooks/queries/*` are in active use.

---

## Executive summary

The architecture is sound (clean MVC on the backend, App Router on the frontend). The debt is
**concentrated in a handful of oversized files and a few missing shared helpers** that are
copy-pasted instead. Fixing the top 5 items removes the bulk of the readability pain with low risk.

| # | Item | App | Effort | Risk | Status |
|---|------|-----|--------|------|--------|
| P0-1 | Split `posController.js` (2,683 lines, 9 domains) | Backend | L | Low | ✅ Done — barrel + 8 controllers, exports verified, tests pass |
| P0-2 | Add a shared currency formatter (47 files do `/100` inline) | Frontend | M | Low | ✅ Done — `formatGhs` upgraded + adopted across ~30 sites |
| P1-1 | Extract duplicated helpers (`generatePassword` ×5, `escapeRegex` ×4, `normalizePhone` ×2) | Backend | S | Low | ✅ Done — `regex`/`phone`/`money`/`logger` utils; `escapeRegex`/`normalizePhone` deduped. `generatePassword` intentionally NOT merged (divergent, security-sensitive) |
| P1-2 | `caseStudyStyles.js` styled-components | Frontend | L | Med | ✅ Done — was **dead code**; deleted file + dropped `styled-components` dep |
| P1-3 | Break up the largest page components (POS job `[id]` 1,134 lines, etc.) | Frontend | M | Low | 🟡 Partial — job page 1,135→838 (2 hooks + 3 components); interactive sections + other big components remain |
| P2-1 | Central logger to replace scattered `console.*` | Backend | S | Low | 🟡 Partial — 5 job/integration files (50 calls); webhook + startup intentionally skipped |
| P2-2 | Money helper (`toPesewas`/`fromPesewas`/`formatGhs`) on backend | Backend | S | Low | 🟡 Partial — `formatGhs` in 6 display strings; payment/PHASE7 path skipped |
| P2-3 | Consolidate data-fetching: 19 files call `fetch` directly instead of the `lib/api` fetch wrapper / react-query hooks | Frontend | M | Low | ⬜ Open |
| P3-1 | Hoist inline `require()` calls | Backend | S | None | ⬜ Open |
| P3-2 | Remove unused `axios` dependency (imported nowhere in `src`; `lib/api.js` uses `fetch`) | Frontend | S | Low | ⬜ Open — flagged during the P1-2/docs pass |

---

## Backend (`backend-eaz/`)

### P0-1 — `controllers/posController.js` is a 2,683-line god controller
The single biggest issue. One file owns **9+ unrelated domains** and imports **16 models**:

- Customers (`createCustomer`, `getCustomers`, `updateCustomer`, …)
- Repair jobs (`createJob`, `createPublicJob`, `updateJob`, photos, tokens, …)
- Parts / inventory (`createPart`, `updatePart`, `scanLookup`, `getParts`, …)
- Staff / technicians (`createStaff`, `getTechnicians`, …)
- Reports & analytics (`getOverview`, `getReportsAnalytics` — ~240 lines alone)
- Sales (`createSale`, `voidSale`, …)
- Expenses & suppliers (full CRUD for each)
- Paystack payments (`initiateMomoCharge`, `initiateCardCharge`, `checkMomoCharge`, …)

**Refactor:** split by domain into thin controllers that re-export through a barrel so routes
barely change:

```
controllers/pos/
├── customerController.js
├── jobController.js
├── inventoryController.js   (parts, part orders, scan)
├── staffController.js
├── salesController.js
├── expenseController.js     (expenses + suppliers)
├── reportsController.js
├── paymentController.js      (momo/card/balance)
└── index.js                  (re-exports for existing route imports)
```

Move the file-local helpers (`computeJobBalancePesewas`, `deductJobPartsOnce`, `normalizePhone`,
`generatePassword`, `escapeRegex`, `normalizeProduct`) into `utils/` (see P1-1). **Zero behavior
change** — pure code movement + updated imports. This is the highest-ROI change in the repo.

### P1-1 — Duplicated helper functions across controllers
Same logic is redefined in multiple files:

| Helper | Duplicated in |
|--------|---------------|
| `generatePassword` | `posController`, `hostingOrderController`, `services/whm`, `services/cyberpanel`, `utils/provisionHosting` (**×5**) |
| `escapeRegex` | `posController`, `productController`, `activityLogController`, `hostingOrderController` (**×4**) |
| `normalizePhone` | `posController`, `orderController` (**×2**) |

**Refactor:** one home each — `utils/password.js`, `utils/regex.js` (`escapeRegex`),
`utils/phone.js` (`normalizePhone`). Low risk; shrinks 5 files at once. Note the `generatePassword`
copies may differ subtly (length/charset) — reconcile to one spec, which is itself a latent-bug fix.

### P2-1 — Scattered `console.*` instead of a logger
`console.log/error` appears throughout (`webhookController` ×24, `renewalJob` ×13,
`reminderJob` ×10, `notify` ×10, `namecheap` ×10, …). On a 512 MB cPanel heap with PM2 this makes
log levels and noise impossible to control.

**Refactor:** thin `utils/logger.js` (level-aware; can wrap `console` initially) and swap call
sites. Mechanical, low risk, big operability win.

### P2-2 — Money math scattered, no helper
`Math.round(Number(...))`, `* 100`, `/ 100` are inlined in ~11 backend files (`posController`
lines 596–831, `productController` 204–237, `domainController` USD conversion, …). Per the golden
rule money is pesewas; a `utils/money.js` (`toPesewas`, `fromPesewas`, `formatGhs`) centralizes the
rounding rules and prevents float drift. Aligns with `PHASE7_MONEY_MIGRATION_PLAN.md`.

### P3-1 — Inline `require()` inside functions
Mid-function requires should be hoisted to the top require block:
- `posController.js:1382` (`validatePassword`), `:2068` (`runReminderJob`)
- `hostingOrderController.js:247–248` (`User`, `DomainOrder`)
- `serviceOrderController.js:96`, `domainController.js:307` (`frontendUrl` inlined into template strings)

Trivial and removes hidden dependencies from function bodies.

### Secondary large controllers (single-domain — extract, don't split)
- `authController.js` (917) and `hostingOrderController.js` (866): mostly cohesive. Win here is
  extracting repeated blocks (token/cookie helpers in auth; provisioning + email steps in hosting)
  into named functions, not splitting the file.

---

## Frontend (`frontend-eaz/`)

### P0-2 — Inconsistent currency formatting (47 files format money inline)
47 files reference `/100` / `GH₵`. A `formatGhs(pesewas)` helper **already existed** in `lib/shop.js`
but was only partially adopted (19 files) and inconsistently formatted (`GH₵ 12.50`, no separators),
while others inlined `(x/100).toLocaleString()`. Result: the pesewas→`GH₵` conversion diverges per page
— a correctness risk (rounding/separators handled differently).

**Refactor (done):** made `lib/shop.js`'s `formatGhs` the single source of truth, standardized on
`GH₵1,234.56`, and migrated the inline pesewas sites to it. Form-input/cart-math `/100` calcs and the
thermal-`Receipt` layout were intentionally left alone (not display strings).

### P1-2 — `styles/caseStudyStyles.js` (1,213 lines) violates the STYLE_GUIDE
It is the **only** file in `src/` importing `styled-components` (124 `styled.*`/`keyframes` uses).
The STYLE_GUIDE bans styled-components in favor of Tailwind. It also hardcodes colors
(`#0a0a14`, `#fafaf8`) instead of design tokens.

**Refactor (Med risk — visual):** port these components to Tailwind utility classes + tokens from
`tailwind.config.js`, move keyframe animations into the Tailwind config. Do it behind a visual diff
since it touches rendered output. Removes the last styled-components dependency entirely.

### P1-3 — Oversized page components
Several route components are 500–1,134 lines doing data-fetching, state, and full markup inline:

| File | Lines |
|------|-------|
| `app/dashboard/pos/jobs/[id]/page.jsx` | 1,134 (39 hooks) |
| `components/ChatWidget.jsx` | 725 |
| `app/dashboard/(admin)/users/page.jsx` | 686 |
| `app/dashboard/page.jsx` | 660 |
| `components/portfolio/PortfolioDetail.jsx` | 631 |

**Refactor:** extract presentational sub-components (e.g. the POS job page → `JobHeader`,
`JobTimeline`, `PaymentPanel`, `PartsList`) and lift data logic into hooks. Start with the POS job
page — it's the worst and 39 hooks in one component is hard to reason about.

### P2-3 — Mixed data-fetching: raw `fetch` vs the shared `lib/api` wrapper
44 files use the shared `lib/api` **fetch** wrapper (not axios — the `axios` dep is unused, see P3-2);
**19 still call `fetch()` directly**. Mixed conventions
mean inconsistent error handling, auth-cookie handling, and base-URL logic.

**Refactor:** route the 19 raw-`fetch` call sites through `lib/api`. Separately, `@tanstack/
react-query` is installed but unused (56 files hand-roll `useEffect` + loading/error state) —
adopting it, or a shared `useFetch` hook, would delete a lot of boilerplate. Treat react-query
adoption as its own decision (bigger scope), noted in `REACT_QUERY.md`.

---

## Suggested sequencing

1. **P1-1 helpers + P2-1 logger + P2-2 money helper** (backend, small, low-risk) — creates the
   shared utils the next step depends on.
2. **P0-1 split `posController.js`** — now the extracted helpers already have a home.
3. **P0-2 currency formatter** (frontend) — highest-reach frontend change, low risk.
4. **P1-3 break up the POS job page** and other large components.
5. **P1-2 caseStudyStyles → Tailwind** — do last / standalone; it's the only one needing a visual
   review.

Each step is independently shippable and behavior-preserving (except P1-2, which needs a visual
diff). I can start on any of these on your go-ahead — recommend beginning with step 1 + 2, or the
currency formatter if you'd rather see a frontend win first.
