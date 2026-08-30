# EazWorld — Dead Code Audit (Phase A: report only)

**Date:** 2026-08-29 · **Branch:** `chore/dead-code-audit` in both repos
**Nothing was deleted or edited.** Both trees were clean before starting.

## Method and its limits

Reference detection was done with literal module-specifier matching across `src/` and root configs,
**validated with sanity checks** before being trusted: a run is only accepted if known-live modules
(`lib/api.js`, `ui/Button.jsx`) come back as *referenced*. Two earlier passes were discarded for
failing exactly that check — one flagged 118 files, another 274, including the entire `ui/` library.
Both were tooling bugs (a zsh glob failure silencing grep, then a quoting error), not findings.
**Any list that says a component library is unused is wrong**, and it is worth stating that here
because two of three attempts produced one.

App Router files (`page`, `layout`, `route`, `sitemap`, `robots`, `opengraph-image`, `middleware`, …)
are reached by convention with zero imports and were excluded from "unreferenced" by name, not by
guesswork.

---

## Scope summary

| | Count |
|---|---|
| Confirmed dead | **4** (1 file, 1 exported function, 2 prod dependencies) |
| Dependencies to remove | **4** (2 backend prod, 2 frontend dev) |
| Duplicate implementations | **2** |
| Dead routes/endpoints | **0** — every route file in `routes/` is mounted in `app.js` |
| DB code needing review | **0 fields flagged for deletion** (per the rule) |
| Uncertain | **5** |
| Deprecated but live | **2** |

**Rough scope if everything approved:** ~7 files touched, **~600 LoC removed** (491 of them one file),
4 dependencies dropped. No route, model field, or security control is proposed for deletion.

---

## 1. Confirmed Dead

| Item | Location | Why unused | Verification performed |
|---|---|---|---|
| `useConsultations` hook (whole module) | `frontend-eaz/src/hooks/queries/useContacts.js` | Its only plausible consumer, the admin consultations page, calls `api.get("/contacts?…")` directly instead | Literal specifier search across `src` (sanity-checked); word-search on the export name → **0** references outside its own file; no dynamic import; no test; no string reference |
| `@react-email/components` | `backend-eaz/package.json` (**prod**) | All transactional email is hand-written HTML template literals passed to Resend | `grep -rli "react-email"` over the repo matches only `package.json`, the lockfile, and docs. Backend contains **no `.jsx`/`.tsx` files at all**. `utils/email.js` uses `html:` template strings |
| `@react-email/render` | `backend-eaz/package.json` (**prod**) | Same | Same |
| `services/cyberpanel.js` (103 lines) | `backend-eaz/services/` | Provisioning goes only through WHM; there is no CyberPanel fallback | `grep -rln cyberpanel` matches **only the file itself**. `utils/provisionHosting.js` requires `services/whm` and nothing else; `whm.hasConfig()` failing routes to the manual queue, not to CyberPanel. CLAUDE.md records it as retired (T64) |

**Answering the five required questions for `cyberpanel.js`** — the one with a security dimension:
*What:* a CyberPanel hosting-provisioning client. *Why unused:* WHM replaced it. *Checked:* whole-repo
grep for the name and for `CYBERPANEL_*`; the provisioning util's imports; the manual-queue fallback
path. *Ruled out:* no dynamic require, no config-array mounting, no env-driven provider switch.
*Could affect:* nothing at runtime — but it reads `CYBERPANEL_HOST`/`PASS`/`USER`, so **treat its
deletion as also retiring those secrets**. *Test coverage:* none references it; the hosting
provisioning tests exercise the WHM path only.

---

## 2. Dependencies to Remove

| Package | Location | Reason |
|---|---|---|
| `@react-email/components` | backend, **prod** | Zero references; email is hand-written HTML |
| `@react-email/render` | backend, **prod** | Zero references |
| `@playwright/test` | frontend, dev | **No `playwright.config.*`, no `*.spec.js`, no `e2e/` directory** anywhere in the repo |
| `playwright` | frontend, dev | Same. Also pulls browser binaries on install |

**Explicitly NOT flagged** — checked and found genuinely used, despite looking unreferenced to a naive
scan: `nodemon` (the `dev` script), `@eslint/js` and `globals` (`eslint.config.js`),
`@testing-library/jest-dom` (`vitest.setup.js`), `eslint-config-next` (`.eslintrc.json`),
`axios` (spaceship, whm, googleDistance).

`xml2js` is **not** listed above: it is required only by the retired `services/namecheap.js`, so it can
only go when that file does. See §7.

---

## 3. Duplicate Implementations

| Old | Replacement | Which is live | Reason |
|---|---|---|---|
| Direct `api.*` calls in page components | `@/hooks/queries/*` react-query hooks | **Both** — 50 files use hooks, 21 call `api.*` directly, **5 use both in the same file** | CLAUDE.md documents the coexistence and says to prefer react-query for new work. The `useContacts.js` orphan in §1 is a symptom: the hook was written, the page kept the old pattern |
| `services/namecheap.js` (491 lines) | `services/spaceship.js` | **Spaceship** | Namecheap is wired to nothing. See §7 — it is retained deliberately, not by accident |

---

## 4. Dead Routes / Endpoints

**None found.** Every file in `backend-eaz/routes/` is mounted in `app.js` — checked by name, not by
literal `app.use` matching, so config-array mounting would still have been caught.

One item worth naming even though it is not a route: `nginx.conf` proxies
`location /api/v1/domain/webhook`, **an endpoint that does not exist** in the Express app. It is dead
proxy configuration, not dead application code, and is already covered by audit task **T82**.

> **Caveat kept deliberately:** a route being uncalled by this frontend does not make it dead — it may
> serve an external consumer. No endpoint is recommended for removal on frontend-usage grounds.

---

## 5. Database Code Requiring Review

**No schema field is recommended for deletion.** Per the rule, this section is migration-planning only.

| Item | Reason to review |
|---|---|
| `models/Part.js` | Orphaned by the parts→products merge — nothing requires it. The migration deliberately **left the `parts` collection intact for rollback**, so the model file is the code half of a rollback path that still exists in data. Do not remove either half independently |
| `Order.customer` (`name`/`phone`/`email`/`address`) | No `maxlength`, no email-format validation — already logged as **T125**. A migration would need to decide what to do with any oversized values already stored |
| 20 of 40 models declare no `maxlength` on any string field | Same class, whole-schema scope |

---

## 6. Uncertain / Needs Manual Confirmation

| Item | Why uncertain |
|---|---|
| `scripts/normalizePhones.js` | Unregistered in `package.json`, but a one-off ops script run manually. **Not** a duplicate of `normalizeUserPhones.js` — that one targets `users`, this targets `poscustomers`. Recommend registering it as an npm script rather than deleting |
| `scripts/resanitizePostContent.js` | Same shape. Header documents it as an idempotent T42 hygiene pass. Historical ops tooling |
| 5 more unregistered scripts (`mergeCashierToStaff`, `mergeCustomerDuplicates`, `seedRoleAccounts`, `setUserAdmin`, `verifyUser`) | Reachable via `node scripts/x.js`; several are clearly deliberate admin tooling. Absence from `package.json` is a discoverability gap, not death |
| 16 env vars read by backend code but absent from `.env` | `ANTHROPIC_API_KEY`, `COOKIE_SECRET`, `CYBERPANEL_*`, `HOSTING_GRACE_DAYS`, `HOSTING_NAMESERVERS`, `HOSTING_SUSPEND_TO_TERMINATE_DAYS`, `LOG_LEVEL`, `MONGO_URI`, `NODE_OPTIONS`, `REFUND_RECONCILE_AFTER_MINUTES`, `WAREHOUSE_*`, `WHM_PACKAGE_PREFIX`. Most have code-side defaults, so absence is intentional — but the set has never been documented, and `CYBERPANEL_*` should retire with §1 |
| `.eslintrc.json` extends `next/typescript` | A TypeScript preset in a JavaScript-only project. Harmless today; may mask or misapply rules. Verify before changing — lint is currently clean |

---

## 7. Deprecated but Still Live

| Item | Recommendation |
|---|---|
| `services/namecheap.js` (491 lines) + `xml2js` | **Keep for now.** Its header states it is retained as the rollback path off Spaceship and is "wired to nothing". That rollback still has value: audit task **T3** records that the Spaceship live registration round-trip has **never been verified**, and Spaceship has no sandbox. Delete once T3 closes successfully — then `xml2js` goes with it. The header also warns its price table is below cost, so it must not be re-wired without repricing |
| Two data-fetching patterns | Migrate page-by-page to react-query as files are touched, per CLAUDE.md. Not a deletion task |

---

## 8. Debug Artifacts and Stale Markers

| Finding | Verdict |
|---|---|
| 15 `console.log` in backend `controllers`/`services`/`utils` | **Keep all.** Every one is intentional operational logging — webhook processing decisions, `[WHM] AutoSSL triggered`, the `utils/logger.js` wrapper itself, `validateEnv`'s success line, `dbTarget`'s connection banner |
| 0 `console.log` in `frontend-eaz/src` | Already clean |
| 0 `debugger` statements in either repo | Clean |
| 9 backend + 5 frontend `TODO`/`FIXME`/`HACK`/`XXX` markers | Low priority; review individually when the surrounding file is next touched |

No test credentials, temporary auth bypasses, or commented-out code blocks of consequence were found.

---

## 9. Frontend Environment Drift

| Direction | Variables |
|---|---|
| Read by code, undocumented in `.env.local.example` | `NEXT_PUBLIC_CPANEL_OPEN_IN_NEW_TAB` (commented out in the example), `NODE_ENV` (framework-provided) |
| Documented but never read | `NEXT_PUBLIC_CPANEL_URL`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` |

`NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` is worth a look: payments currently redirect via the server-created
authorization URL rather than Paystack inline JS, which is why the public key is unused. If inline
checkout is planned, this is scaffolding; if not, it is documentation for a variable nobody sets.

---

## Phase A ends here

Awaiting sign-off on specific rows before any deletion. My own recommendation, if useful: approve
§1 and §2 (the four dependencies and two files, ~600 LoC), and **hold `services/namecheap.js` until
T3 proves the Spaceship round-trip** — the rollback path is worth more than the 491 lines it costs.

---

## Phase B — executed 2026-08-29

All four Confirmed Dead rows were approved and applied. `services/namecheap.js` was held back, as
recommended, until T3 verifies the Spaceship live round-trip.

| Row | Status | Commit |
|---|---|---|
| `services/cyberpanel.js` (103 lines) | **Done** | `T128 (1/3)` |
| `@react-email/components` + `@react-email/render` (prod) | **Done** | `T128 (2/3)` |
| Docs claiming react-email is in use | **Done** | `T128 (3/3)` |
| `src/hooks/queries/useContacts.js` + `qk.consultations` | **Done** | `T129 (1/2)` |
| `@playwright/test` + `playwright` (dev) | **Done** | `T129 (2/2)` |
| `services/namecheap.js` + `xml2js` | **Held** — blocked on T3 (see backend T130) | — |
| `CYBERPANEL_*` secrets | **Partial** — absent from local `.env`; retire wherever deployment sets them | — |

**Verification after each batch:** backend eslint 0 errors, `app.js` loads, 44/44 hosting +
spaceship, 51/51 email + notification, `npm audit` 0 vulnerabilities. Frontend eslint clean,
357/357 tests, `next build` compiles and generates all 78 static pages.

**Actual scope removed:** 2 files, ~117 lines, 4 packages — smaller than the ~600 estimated, because
the 491-line `namecheap.js` was deliberately kept.

**Not verified:** the admin consultations page was not opened in a browser. It fetches via
`api.get("/contacts?…")` and never referenced the deleted hook, so nothing it uses changed — but that
is reasoning, not observation.

**Worth noting:** `docs/code_review.md:316` flagged the two react-email packages as unused on
**2026-07-16**. They shipped in production dependencies for six more weeks.
