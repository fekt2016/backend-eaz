# EazWorld Backend — Issue & Fix Tracker

> This is the **backend-eaz** half of the issue tracker. Frontend items live in
> **`frontend-eaz/tasks.md`**. Cross-app tasks are listed in their primary repo and
> cross-referenced.
>
> Sources of truth: **`REVIEWFULL.md`** (full audit 2026-08-29 — 927 backend tests passing, build +
> lint clean; tasks T81-T100 come from it) and the earlier **`AUDIT.md`** (2026-08-18 — 112 backend + 31
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

> The app builds and all 927 tests pass; nothing below breaks local development.
> Both P0s are **production deployment** defects — they bite only once the app is
> served through `nginx.conf`. Added from `REVIEWFULL.md` (audit 2026-08-29).


---

## P1 — Important

- [ ] **T3 · Live E2E verification of external-service flows (the 🟣 items)**
  - **Issue:** 28 features have complete, correct-looking code but were **not** run against
    live third parties in the audit. Logic around them is test-backed; the round-trips are not.
  - **Impact:** Unknown until exercised; these are core revenue/ops paths.
  - **Sub-tasks (run each in sandbox, record result):**
    - [~] T3b · Paystack webhook delivery end-to-end (signature + fulfilment) — **CODE VERIFIED, NEEDS DEPLOY CONFIG**
      - `PAYSTACK_SECRET` (`sk_test_…`) confirmed as the webhook signing secret. `PAYSTACK_WEBHOOK_SECRET` env var is blank —
        the webhook controller reads `PAYSTACK_SECRET` directly (line 100 of `webhookController.js`).
      - **Verified in `tests/webhookE2E.test.js`** (10 tests): valid signature accepted, invalid/missing rejected,
        empty secret rejected, `charge.success` fulfils order (paid + stockDeducted), idempotent on retry,
        amount/currency mismatch rejected, `refund.processed`/`refund.failed` update order status.
      - **To complete live:** configure `POST /api/webhooks/paystack` as the webhook URL in the Paystack dashboard,
        then make a sandbox test payment and confirm the event appears. This is a deployment step, not a code change.
    - [~] T3c · WHM hosting provisioning + suspend/terminate/renew/cpanel-login — **BLOCKED ON CONFIG,
      not connectivity** (re-diagnosed 2026-08-31; CyberPanel dropped)
      - **The 2026-08-20 diagnosis below is superseded.** `WHM_HOST` then pointed at
        `18.133.107.249`, the decommissioned pre-migration EC2 box — which is why nothing answered on
        2087. It was never a firewall allow-list problem.
      - **Today `WHM_HOST` / `WHM_USER` / `WHM_TOKEN` are all BLANK**, so `whm.hasConfig()` is false
        and `utils/provisionHosting.js:41` marks every paid shared/wordpress order `skipped`. The
        customer pays and no cPanel account is created.
      - **To unblock:** generate a WHM API token on the Namecheap reseller server (WHM →
        Development → Manage API Tokens), fill the three vars, create the seven packages, then run
        `npm run check:whm` — it validates the config, authenticates, and names any missing package
        *before* a customer pays. See `docs/HOSTING.md` § Customer hosting provisioning.
      - **Historical note (2026-08-20, superseded):** this dev machine could not open a TCP
        connection to the then-configured `WHM_HOST:2087`; read at the time as a firewall
        allow-list issue.
      - **Not attempted:** account creation/suspend/terminate — these mutate a real hosting account on
        a live server and need explicit sign-off regardless of connectivity; out of scope for an
        unattended check even once reachable.
      - **To unblock:** allow-list this machine's current public IP in the WHM server's firewall
        (e.g. ConfigServer/CSF `csf -a <ip>` or equivalent), or run the check from a host that's
        already allow-listed (e.g. the production server itself).
    - [~] T3d · Namecheap domain search + registration + retry — **STILL UNVERIFIED END TO END**
      (re-checked 2026-09-01). Namecheap is the settled registrar (`services/namecheap.js`;
      `services/spaceship.js` is deleted) and, unlike the previous registrar, it has a **sandbox**
      (`NAMECHEAP_SANDBOX=true`) — so the round-trip is finally provable without spending money.
      Two things to confirm before selling a domain: that `NAMECHEAP_CLIENT_IP` is allow-listed on
      the Namecheap API key, and that the glue records for `ns1`/`ns2.eazworld.co` exist.
      ⚠️ `tests/setup.js` blanks the `NAMECHEAP_*` vars so a test run can never reach the sandbox —
      do not remove that.
  - **Location:** `services/*`, `controllers/*` charge/upload handlers
  - **Source:** AUDIT.md §13, §19, §28, §29 P1 (all 🟣 rows in §4)


## Ad-hoc fixes (found during work, outside the original audit)


- [~] **T85 · PARTLY APPLIED 2026-08-30 — backend warning committed; ecosystem.config.js fix is UNVERSIONED (T122)** (audit ref EZ-005)
  - **Issue:** `ecosystem.config.js:11-14` defines `NODE_ENV` only under `env_production`, which PM2
    applies **only** with `--env production`. Started any other way it is unset and `PROD` is false.
  - **Impact:** The auth cookie loses `Secure` and drops `sameSite` from `strict` to `lax`
    (`controllers/authController.js:44`), **and** the error handler starts returning `err.stack` to
    clients on every error (`middleware/errorHandler.js:1,70`). Both silently, together.
  - **Repro:** `pm2 start ecosystem.config.js` (no `--env`), trigger any handled error, observe a
    `stack` field in the JSON; inspect the login cookie for a missing `Secure` flag.
  - **Fix:** Put `NODE_ENV: "production"` in the default `env` block too, and have `validateEnv.js`
    refuse to boot (or log loudly) when `NODE_ENV` is unset on a non-local host. Document the command.
  - **Location:** `ecosystem.config.js:11-14` (repo root); `controllers/authController.js:44`;
    `middleware/errorHandler.js:1,70`
  - **Acceptance:**
    - [x] Starting with or without `--env production` yields `NODE_ENV=production`  ← done in the repo-root file, which is NOT in git (T122)

  ### Implementation Notes (2026-08-30 — backend commit `a5f6a20`)

  - **`utils/validateEnv.js` (committed):** warns loudly at boot when `NODE_ENV` is unset,
    naming both controls that silently switch off — the auth cookie's `Secure`/`sameSite=strict`
    and `err.stack` in responses. Verified: 1 warning when unset, 0 when production.
  - **`ecosystem.config.js` (edited, NOT committable):** `NODE_ENV: "production"` now sits in the
    default `env` block as well as `env_production`, for both apps, so a plain
    `pm2 start ecosystem.config.js` no longer silently drops to non-production. Verified by
    reading the parsed config. **This file lives at the monorepo root, which is not a git repo,
    so the change cannot be committed or pushed — see T122.** A backup of the original is in the
    session scratchpad.
    - [ ] No stack traces in production API responses
    - [ ] Auth cookies carry `Secure` and `SameSite=Strict`
    - [ ] Startup fails loudly if the environment is ambiguous


---

## P2 — Improvements


- [~] **T96 · SUPERSEDED 2026-09-01 — premise no longer holds; the surviving risk moved** (audit ref EZ-020)
  - **Original issue:** renewal, reminder, scheduled-publish and refund-reconcile ran via in-process
    `setInterval`, correct only at PM2 `instances: 1` and wrong the moment the API scaled.
  - **What changed:** PM2 and `deploy/ecosystem.config.js` were deleted in `0097e7b`. The jobs moved
    to cPanel cron via `scripts/runJob.js`, and `server.js:113` gates the in-process timers behind
    `IN_PROCESS_JOBS` (default on, so local dev is unchanged; the cPanel host sets it to `false`).
    Cron runs a job once regardless of how many web processes Passenger spawns, so the
    duplicate-charge scenario this task described is closed.
  - **⚠️ What replaced it, and it is NOT hypothetical:**
    1. **`IN_PROCESS_JOBS` is absent from `.env`** — it exists only in `.env.example`. The default is
       `true`. If the production env does not explicitly set `IN_PROCESS_JOBS=false` while cron is
       also configured, **every reminder and reconciliation runs twice** — the exact failure this
       task was filed about, arriving by a different door. *Verify on the server; not checkable
       from this repo.*
    2. **Five pieces of module-scoped state assume one process** — the 11 rate limiters
       (`app.js:151`, per-process MemoryStore, so every limit becomes N×), the shipping cache, the
       location cache, the pickup cache, and the Namecheap price cache. Passenger must be pinned to
       one process in cPanel → Setup Node.js App. Full table in `docs/HOSTING.md` § Open items 4.
  - **Fix:** (1) confirm `IN_PROCESS_JOBS=false` on the production host; (2) pin the Passenger
    process count to 1. Both are host configuration, not code. A leader-election lock is only
    needed if the app is ever genuinely scaled out, at which point the rate limiters need Redis too.
  - **Location:** `server.js:105-141`; `ecosystem.config.js:8` (repo root)
  - **Acceptance:**
    - [ ] Jobs run once per interval with >1 instance, or the single-instance constraint is documented
          and enforced
    - [ ] No duplicate renewal charges or reminder emails
    - [ ] Job behaviour unchanged at one instance

---

## Missing Features (new work — ⚪ in the audit)

Not defects; product features that don't exist yet. Scope separately before building.


---

## Final production re-audit (2026-08-29) — new findings


---

## Ad-hoc fixes (found during work, outside the original audit)

_Shipped on request during the 2026-08-29 session, tracked here after the fact so the log is
complete:_ **T110** marketplace parts/accessories/other filter (backend `kind` param) ·
**T112** Part Orders tab removed, order updates moved to the detail page · **T113** staff record
expenses, visibility scoped by recorder · **T114** same-day cutoff noon → 5 PM ·
**T116** `/shipping/methods` legacy branch reads the zone's `speedTiers`. All merged to `main`.

  ### Implementation Notes (2026-08-30 — commit pending, covers T81/T82/T95/T122)

  **Owner decision:** deployment config lives in **`backend-eaz/deploy/`**. `nginx.conf` and
  `ecosystem.config.js` were moved there from the monorepo root and are now tracked, reviewable
  and pushable for the first time. The root copies are gone — there is one authoritative copy,
  not two that drift.

  **The deploy command changes:**
  `pm2 start backend-eaz/deploy/ecosystem.config.js --env production`

  **A latent deployment bug was found while moving it.** PM2 paths are now resolved from
  `__dirname` rather than the caller's working directory, and in doing that the old `cwd: "./"`
  turned out to be wrong: `server.js:7` and `app.js:14` both call
  `dotenv.config({ path: "./.env" })`, which resolves against **`process.cwd()`**, and the only
  `.env` is `backend-eaz/.env`. Measured:

  | cwd | dotenv result |
  |---|---|
  | monorepo root (the old `cwd: "./"`) | **ENOENT — 0 variables** |
  | `backend-eaz` (the new cwd) | loaded 45 variables |

  So as written the config started the API in a directory where its own `.env` is invisible,
  leaving `MONGO_URL`/`JWT_SECRET`/`PAYSTACK_SECRET` unset and `validateEnv` exiting 1. Whatever
  production is doing today, it is not what this file said.

  **In `deploy/nginx.conf`:** `client_max_body_size 6m` (T81 — above multer's 5MB and
  `express.json`'s 5mb so the APP owns the error); real `server_name eazworld.co
  www.eazworld.co` and the dead `location /api/v1/domain/webhook` deleted (T82 — that route does
  not exist; the live one is `/api/webhooks/paystack`, and `/api/` already proxies to the same
  upstream); TLS 1.2/1.3 with modern ciphers, OCSP stapling and HSTS (T95). Two additions beyond
  the tasks: an ACME challenge location, so certbot's webroot renewal still works behind the
  HTTPS redirect, and `X-Forwarded-Proto`, which was missing although `app.js:58` sets
  `trust proxy 1`.

  **HSTS is deliberately WITHOUT `preload`** — preloading is baked into browsers and painful to
  reverse; make it a separate deliberate step once renewals have proven themselves.

  ### ⚠️ Two things still need a human before this deploys

  - [ ] **Confirm the TLS certificate paths.** They follow Let's Encrypt's usual layout for
        `eazworld.co`, but the real lineage name is whatever certbot chose at first issue. Run
        `sudo certbot certificates` and make `ssl_certificate`/`ssl_certificate_key` match. A
        wrong path means the site does not serve at all. A warning to this effect is at the top
        of the file.
  - [ ] **Run `nginx -t` on the server.** Nginx is not installed on this machine and Docker was
        unavailable, so the config was only verified structurally (braces balanced, 2 server
        blocks, 5 locations, every directive terminated, no `yourdomain.com` remaining). That is
        not a substitute for `nginx -t`.


- [~] **T108 · CONNECTION FLAKE — root cause never reproduced; classification tool shipped 2026-09-01 · RE-OPENED 2026-08-30 · connection-level flake in the full serial run — an unexplained 426 and "socket hang up"** (found during T83 verification, 2026-08-29)
  - **Issue:** in `npx jest --runInBand`, "Paystack webhook — refund.processed / refund.failed ›
    completes a processing refund on refund.processed" (`tests/refunds.test.js:175`) gets
    **426 Upgrade Required** where it expects 200. Run on its own the file is **19/19 green**, on
    both `main` and the T83 branch. So it is ordering/pollution, not a code regression.
  - **Impact:** the full suite is not a trustworthy gate — it went 74/74 green earlier the same
    day, then 12 failed on a stalled run, now 1. Until this is understood, a red full run cannot
    be told apart from a real break.
  - **Notable:** `426` appears **nowhere in the source** — not in `app.js`, the middleware, the
    webhook route or any controller — so it originates in a dependency under some state the
    preceding tests leave behind. Worth finding: a 426 from the Paystack webhook in production
    would silently drop refund callbacks.
  - **Repro:** `npx jest --runInBand` (fails) vs `npx jest tests/refunds.test.js --runInBand`
    (passes). Adding an unrelated test file changed the ordering enough to surface it.
  - **Fix:** bisect by running `refunds.test.js` after progressively larger prefixes of the suite
    to find the polluting file; check for shared state left in `app`-level middleware or a module
    -scope cache. `tests/setup.js` wipes collections per test but nothing resets module state.
  - **Location:** `tests/refunds.test.js:175`; `tests/setup.js`

  ### Re-opened 2026-08-30 (during T93/T125 verification)

  **T120 recorded this as superseded — that was wrong.** T120 fixed the per-file mongod churn,
  and the failing run below had **zero** `Instance failed to start` / `buffering timed out`
  errors. So the 426 has a different cause and is still live.

  Evidence, two identical back-to-back full runs on the same commit:

  | Run | Result |
  |---|---|
  | 9  | **2 failed** — `cart` "socket hang up", T84 phone case got **426**, expected 409 |
  | 10 | 84/84 suites, 1028/1028 tests, exit 0 |

  Both failing tests pass in isolation. Both failures are **connection-level, not assertions**.
  There is no `426` anywhere in this codebase or in `express-rate-limit`, so it is not the app
  choosing that status — something is dropping or mangling the connection late in a long serial
  run (superagent surfacing an aborted socket is the leading hypothesis).

  **Why it matters:** the suite is now fast (~7.8 min) and usually green, so this is the last
  thing stopping it being a trustworthy gate. A red run still has to be hand-inspected to tell
  this flake from a real break.

  - **Repro:** `npx jest --runInBand` repeatedly; it does not reproduce every run.
  ### A FOURTH face, 2026-08-30 (during the address-restriction verification)

  A clean full run — nothing else on the machine — failed one test with **401 instead of 200**:
  `hosting.test.js` › "uses the Namecheap price for a known TLD". It passes in isolation (24/24).

  That makes four symptoms of what is almost certainly one bug:

  | Symptom | Meaning |
  |---|---|
  | `426 Upgrade Required` | Node's HTTP parser reading a non-response as a status line |
  | `socket hang up` | connection closed mid-exchange |
  | `Parse Error: Expected HTTP/, RTSP/ or ICE/` | the client received bytes that are not an HTTP response |
  | **`401` on an authenticated request** | the auth cookie did not arrive or did not parse |

  All four are **connection-level, never assertion-level**; all appear ONLY in the full serial
  run; all pass in isolation. The 401 is the most informative yet: it means a request that
  carried a valid cookie reached the server without one, which is what a **desynchronised
  keep-alive socket** looks like — request and response boundaries drifting out of step, so one
  exchange reads another's bytes.

  Note the earlier grep signature (`Instance failed to start|buffering timed out|socket hang
  up|Parse Error`) returns **0** for this run — a 401 is invisible to it. Any future check for
  "is T108 happening" must look at the failure list, not just that grep.

  ### Keep-alive / socket reuse: TESTED AND RULED OUT (2026-08-30)

  The leading hypothesis was socket reuse. Node 19 changed `http.globalAgent` to
  `keepAlive: true` (confirmed here — Node v20.20.2, keepAlive true, keepAliveMsecs 1000,
  maxFreeSockets 256), supertest starts an ephemeral server per request, and the OS recycles
  ephemeral ports over a long run. A pooled socket from a closed server handed to a later request
  on the same host:port would explain all four faces at once.

  **It is not the cause.** Two independent pieces of evidence:

  1. `tests/setup.js` was given `http.globalAgent = new http.Agent({ keepAlive: false })` and a
     full run still failed with **426** — `technicianHostingDomainAccess` › "403s POST
     /domain/payment", expecting 403. Same symptom, keep-alive off.
  2. That override could never have mattered: `superagent/lib/node/index.js:162` sets
     `this._agent = false` and line 736 passes `options.agent = this._agent`. In Node,
     `agent: false` means "build a one-off agent for this request" — `globalAgent` is never
     consulted. And a fresh `new http.Agent()` defaults to `keepAlive: **false**` (only
     `globalAgent` is special-cased to true). So supertest was ALREADY not pooling sockets.

  The change was reverted rather than left in place: a no-op behind a confident comment claiming
  to fix T108 is worse than nothing, because the next person reads it as solved.

  **Also worth recording:** the signature grep used earlier
  (`socket hang up|Parse Error|Instance failed to start|buffering timed out`) reported **0 hits**
  on this failing run, because the failure logs the numeric `426` rather than "Upgrade Required".
  Judge T108 from the FAILURE LIST, never from that grep.

  **Frequency, measured so far:** roughly 1 failing test per full run, in maybe a third of runs,
  and **never the same test twice** — refunds, cart, phone-change, supplier logs, hosting price,
  technician domain access, and now `usersPagination` ("walks pages without repeating or dropping
  anyone", *socket hang up*, 2026-08-30 17:46) have each done it exactly once. Seven distinct
  tests, seven different suites, no repeat.

  That non-repetition is itself evidence: a real defect would cluster. This picks a different
  victim each run, which is what a shared-resource fault looks like rather than a code fault.

  **Cost, concretely:** on 2026-08-30 a T126 change was pushed and the following full run came
  back red on this flake. Ten minutes went into proving the failure was unrelated to the change —
  re-running the suite in isolation (11/11) and reading the error text — before the push could be
  called safe. That is the tax on every change until this is fixed.

  ### Shared-server fix: MECHANISM CONFIRMED, FIX FAILED (2026-08-30/31)

  **The mechanism is real and worth keeping.** `supertest/lib/test.js` does
  `http.createServer(app)` in the Test constructor (:32-41), `serverAddress()` then calls
  `app.listen(0)` (:63), and `end()` closes it again (:143). So **every HTTP request binds a fresh
  ephemeral port and tears it down** — several thousand listen/close cycles in a full run, with the
  OS recycling the port range throughout. That is a plausible source of connection-level failures
  and it is a fact about the code, not a theory.

  **The obvious fix does not work.** Patching `Test.prototype.serverAddress` to return one
  per-file server's address (so supertest never calls `listen(0)`, never sets `this._server`, and
  `end()` therefore never closes anything) was measured to work at small scale — a probe showed
  10 requests using **1** port instead of 10, and 3 suites / 35 tests passed normally.

  At FULL-SUITE scale it is catastrophic. Individual tests begin hitting the 30s jest timeout and
  suites take hours:

  | Suite | Normal | With the shared server |
  |---|---|---|
  | `chatMonitoring` | seconds | **6,487 s** |
  | `addressCustomerOnly` | seconds | **6,487 s** |
  | `sessionInvalidation` | seconds | **3,308 s** |
  | `shippingEndpoints` | seconds | **3,244 s** |

  7 suites in ~7 hours, all failing, before it was killed. Reverted; the same suites pass in
  seconds again. **Why sharing the server makes requests hang is NOT understood** — that is the
  open question, not whether it is slow.

  **Process note for whoever picks this up:** the small-scale check (3 suites, 35 tests) said the
  change was fine. It is not enough. Every T108 attempt must be judged on a FULL run — this is now
  the third time in one day that targeted suites passed while the full run disagreed.

  - **Next hypotheses, in order:** (a) supertest leaks the ephemeral server between files — each
    `request(app)` binds a new port and nothing closes it, so late in a run the process holds
    hundreds of listening sockets; check the fd count as the run progresses. (b) an unhandled
    rejection from one suite lands during another's request. (c) Express `trust proxy` plus a
    recycled port confusing keep-alive on the SERVER side (`server.keepAliveTimeout`), which is a
    different setting from the client agent ruled out above.

  - **Next step:** capture whether the Express server or the supertest agent closes first —
    an unhandled rejection or an exhausted ephemeral-port range are both consistent with the
    symptom.

  ### 2026-09-01 (during the T83/T84 security close-out) — two more faces

  Three full serial runs (each ~18 min, nothing else on the machine):

  | Run | Result | Cause |
  |---|---|---|
  | 1 | **6 failed** — `variants.test.js` all rejected | **not a flake** — a real T126 regression (order schema rejected `deliveryZoneId: null`); fixed and logged as **T137** |
  | 2 | **2 failed** — suite unknown, noted below | flake |
  | 3 | **2 failed** — `usersPagination` + `seedCatalog` | flake — both 16/16 green in isolation |

  `usersPagination` ("walks pages without repeating or dropping anyone", *socket hang up*) and
  `seedCatalog` ("seeds idempotently…") join the victim list — the eighth and ninth distinct
  suites. The important lesson from run 1 stands: **read the failure, don't assume flake** —
  this time the first non-flake in a while was a genuine committed regression that hid because
  it had been assumed to be T108. Run 2's two failures were not captured before run 3; treat
  "which tests" as unreliable memory and rely on the next full run's output.

  ### 2026-09-01 investigation — three hardware theories falsified; classifier shipped

  The reinvestigation explicitly measured the three standing hardware hypotheses and ruled
  each one out with mechanics, not vibes:

  - **fd/descriptor exhaustion — RULED OUT.** `ulimit -n` is 1,048,576; 200 sequential
    supertest requests leaked **0** fds (`/dev/fd` 17 → 17). No accumulation.
  - **Ephemeral-port recycling — RULED OUT.** supertest's per-request `listen(0)` resolved to
    **30 distinct ports over 30 sequential bind/close cycles with zero repeats** (`max
    repeats: 1`). The OS does not hand the same port straight back, so a
    recycled-port-collision race cannot be the mechanism on this host.
  - **keep-alive — RULED OUT** (already, 2026-08-30): superagent uses `agent: false` (one-off
    socket per request), never `globalAgent`; the same 426 reproduces with keep-alive off.
  - **426 provenance — NONE in the stack.** `grep 426` across `express/`, `supertest/`,
    `superagent/`, `send/`, `finalhandler/` returns nothing; express has no upgrade handler
    and no socket.io is mounted in tests (`server.js` only, never truthy in supertest). A
    426 therefore cannot be produced by anything loaded in a supertest request — it is
    surfaced by superagent when the HTTP parser misreads a status line off a desynchronised
    connection, which is the true connection-level signature, not an app response.
  - **posSale disconnect is NOT the cause for early victims.** `posSale.test.js` disconnects
    the shared mongoose to run its replset (pos: 53 of ~100) and reconnects after. Victims
    appear **before and after** it (cart@12, hosting@31, refunds@64, seedCatalog@74,
    usersPagination@93) and the exact posSale→seedCatalog→usersPagination interleave ran
    3/3 clean. No single-file culprit explains the earliest victims.

  Verdict: every *concrete, mechanically-checkable* theory is now exhausted; what remains is
  an order/load-dependent connection flake whose victim is essentially random and which
  cannot be provoked in isolation. No app defect has ever been shown to cause it. **This is
  not an app bug to chase further** — it is a gate-reliability problem to route around.

  **Shipped: `npm run test:ci` → `scripts/classifyTestFlakes.js`.** Runs the full suite, then
  independently re-runs each failing file ALONE and prints `FLAKE` vs `FAIL`. Exit 0 only
  when every initial failure is green in isolation. This is the 10-minute manual verdict
  (the recurring cost from 2026-08-30) reduced to one command: a red full run now tells you
  in seconds whether to investigate or release. Log new flaked suites here as they appear.


---

## Reconciliation with the cPanel migration (2026-09-01)

Moving to the Namecheap cPanel reseller plan deleted `deploy/nginx.conf` and
`deploy/ecosystem.config.js` (commit `0097e7b`), and several tasks still described the world as
it was before. **A task list that overstates what is outstanding is as misleading as one that
understates it** — a reader cannot tell which of the open items are real. Reconciled:

| Task | Was | Now |
|---|---|---|
| T81 | acceptance needed a production-like Nginx deploy | **N/A** — no proxy; the app owns its own 5MB/8MB limits and the error message |
| T82 | acceptance needed `nginx -t` | **mostly N/A** — only "webhook deliveries arrive" survives, and that is T3b |
| T95 | acceptance needed TLS/cipher config | **N/A** — belongs to LiteSpeed now. **HSTS was NOT lost** — `app.js:82` sets it via helmet |
| T96 | `setInterval` + PM2 `instances: 1` | **superseded** — cron drives the jobs; two *new* single-process assumptions replace it, one of them live |
| T3c | WHM unreachable, read as a firewall block | **re-diagnosed** — the host pointed at a decommissioned EC2 box; the vars are now simply blank |
| T3d | registrar churn | **settled on Namecheap**, which has a sandbox, so the round-trip is finally provable |

Also true of the *closed* items: T80n/T80o and four of T92's five controls were already covered by
tests written after those tasks were filed, and were ticked on 2026-09-01 after checking each one
rather than writing duplicates.

**The one thing that got worse, not better:** T96's replacement risk #1. `IN_PROCESS_JOBS` is
absent from `.env` and defaults to `true`, so if the production host has cron configured without
setting it to `false`, every reminder and reconciliation runs twice. That is the original T96
failure arriving through a different door, and it is not checkable from this repo.

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
