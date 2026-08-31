# backend-eaz / docs

Project documentation, moved here 2026-08-29 from the workspace root
(`/Users/mac/Desktop/eazworld/`), which is **not a git repository** — so nothing in
it was version-controlled, reviewed, or backed up. `reviewfull.md` and its dated
archive were lost from that directory during the same session, which is what
prompted the move. See **T122** in `../tasks.md`.

## Shared with `frontend-eaz/docs/`

Both repos are cloned and deployed independently, so neither can reference the
other's files. These are duplicated on purpose:

| File | What it is |
|---|---|
| `monorepo-CLAUDE.md` | Project instructions for both apps (renamed so it cannot clobber this repo's own `CLAUDE.md`) |
| `monorepo-README.md` | Top-level readme (same reason) |
| `PROJECT_SPEC.md` | Product spec |
| `all-features.md` | Feature inventory |
| `howthesystemwork.md` | End-to-end narrative of how the system works |
| `roles.md` | The role matrix — **enforced** by `routes/posRoutes.js` and `middleware/auth.js` |
| `FINAL-PRODUCTION-AUDIT.md` | Final pre-deployment audit, 2026-08-29 |

> **Duplication warning.** `roles.md` is a live document — it was edited three
> times on 2026-08-29 as role decisions were made. Two copies will drift. Treat
> **this** copy as canonical (the backend is what enforces the matrix) and pull
> the frontend copy from it, or collapse to one location.

## Backend-only

| File | What it is |
|---|---|
| `AUDIT.md` | 2026-08-18 audit |
| `REFACTORING_AUDIT.md` | Duplication / structure review |
| `PHASE7_MONEY_MIGRATION_PLAN.md` | Money → integer pesewas migration |
| `HOSTING.md` | Namecheap domain + reseller hosting: DNS, deploy, provisioning |
| `shipping.md`, `shipping-expansion-plan.md`, `pr-*.md` | Pre-existing notes |
