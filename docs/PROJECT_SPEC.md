# EazWorld — Project Specification

Authoritative description of **what** EazWorld is and the rules every change must respect.
`CLAUDE.md` covers **how** to work in the repo; the `.claude/skills/eaz-*` skills cover per-domain detail.
When this spec and a skill disagree, this spec wins.

---

## 1. Product

EazWorld is a Ghana-based digital-agency platform with an online storefront and an in-store POS.
One backend API serves a Next.js web client (public site + admin/seller dashboard + POS UI).

Audience: Ghanaian consumers and businesses. Currency **GH₵ (Ghana Cedi)**. Payments via **Paystack**
(card + Mobile Money).

## 2. Domains (modules)

| Domain          | Backend surface (models / controllers)                     | What it does |
|-----------------|-------------------------------------------------------------|--------------|
| **Auth**        | `User`, `authController`                                     | Register/login/logout, password reset, JWT cookie, roles (`user`/`admin`) |
| **Domains**     | `DomainOrder`, `domainController`, `services/namecheap`      | Domain search/suggestions + registration via Namecheap; Paystack checkout |
| **Hosting**     | `HostingOrder`, `hostingOrderController`, `services/whm`, `services/cyberpanel`, `utils/provisionHosting`, `config/hostingPlans` | Sell hosting plans; provision cPanel/CyberPanel accounts; renewals |
| **Shop**        | `Product`, `Order`, `DeliveryZone`, `product`/`order`/`deliveryZone` controllers | E-commerce catalog, cart→checkout, delivery zones, Paystack payment |
| **POS**         | `PosCustomer`, `PosPayment`, `RepairJob`, `Part`, `Supplier`, `Sale`, `Expense`, `posController` | In-store device-repair POS: jobs, parts, customers, payments, thermal receipts |
| **Consultations/Chat** | `ChatSession`, `chatController`, `contactController`, `Contact` | Book consultations, contact form, chat sessions |
| **Content**     | `Post`, `Project`, `Review`, `post`/`project`/`review` controllers | Blog posts, portfolio projects, customer reviews |
| **Platform**    | `Settings`, `EmailLog`, `settingsController`, `webhookController`, `uploadController` | Site settings incl. maintenance mode, email log, Paystack webhooks, Cloudinary uploads |

## 3. Architecture

- **Backend** — Express + plain JS (CommonJS), MVC: `routes → controllers → models (Mongoose)`.
  External integrations live in `services/`. All routes mount under `/api/v1`. Entry `server.js` → `app.js`.
- **Frontend** — Next.js 14 App Router (JS/JSX), styled-components driven by CSS variables in
  `styles/GlobalStyles.js`, TanStack Query over an axios client (`lib/api.js`), `middleware.js` gate.
- Deployment: both apps on Spaceship Essential (shared cPanel/LiteSpeed, Passenger, 512MB heap on the API); deploys via `.cpanel.yml` + cPanel Git Version Control. See `docs/HOSTING.md`.

## 4. Cross-cutting rules

1. **Money in pesewas.** Integer minor units everywhere in storage and transport; format `GH₵x.xx` only at the UI edge.
2. **Response envelope.** Success: `{ success: true, data }`. Errors flow through `middleware/errorHandler.js`.
3. **Auth.** JWT in an httpOnly cookie. `protect` guards authenticated routes; `restrictTo('admin')` guards admin. Identity from `req.user.id` only.
4. **Validation.** Zod schemas in `validation/`. New endpoints validate input; reject unknown fields.
5. **Pagination.** List endpoints clamp `page`/`limit` in the controller (sensible default, hard max).
6. **Payments.** Paystack initialize → redirect → **webhook verifies signature** → idempotent fulfilment. Never fulfil on client callback alone.
7. **Security.** Keep the `app.js` middleware stack (helmet/CSP, xss-clean, mongo-sanitize, hpp, rate-limit, cors). `trust proxy` = 1.
8. **Performance.** `lean()` for reads; index new filter/sort fields; keep memory low (512MB heap).
9. **Secrets** live in `.env` (backend) / `.env.local` (frontend). Never commit them; keep `.env.example` current.

## 5. Definition of Done

- [ ] Feature works end-to-end against the real API (not only unit tests).
- [ ] Input validated; errors typed and routed through the central handler.
- [ ] Money handled in pesewas; currency rendered as GH₵.
- [ ] Auth/authorization correct (`protect` / `restrictTo`), identity from `req.user`.
- [ ] List endpoints paginated; new query fields indexed.
- [ ] Frontend styling uses CSS variables (no `theme.*`, no hardcoded values).
- [ ] `.env.example` updated if new config was added.
- [ ] Docs updated (README / CLAUDE.md / relevant skill) when behavior or setup changed.

## 6. Open decisions

Track unresolved design questions here; an `architect` decision closes each one.

- **A1 — Service layer.** Controllers currently hold business logic. Extract a `services/`-style layer for the shop/POS domains, or keep thin-controller MVC? (Default: keep MVC unless a controller exceeds ~200 lines.)
- **A2 — Automated tests/CI.** `mongodb-memory-server` is installed but there is no test runner or CI. Adopt Jest + Supertest and a GitHub Actions workflow? (Default: add Jest for new business logic; CI deferred.)
- **A3 — Swagger/OpenAPI.** No API docs generator today. Introduce one, or keep the README API table as the contract? (Default: README table.)
- ~~**A4 — README stack drift.**~~ **Decided (2026-08-10):** root `README.md` corrected — frontend documented as JS/JSX, real directory names (`backend-eaz`/`frontend-eaz`), full API surface, and accurate env vars.
- **A5 — Shared validation.** Zod schemas exist only for auth/contact/domain. Backfill schemas for shop/POS/hosting endpoints? (Default: add on touch.)

## 7. Non-goals (for now)

Mobile (React Native) app, end-to-end encrypted messaging, real-time sockets, and a separate marketplace
platform are **not** part of EazWorld. If a request implies one of these, confirm scope before building.
