# EazWorld Application Audit

> **Read-only audit.** Nothing in the application was modified. Every status below is
> based on **actual code inspection** and, where noted, **actual test/build runs**
> executed on 2026-08-18. No feature is marked "working" purely because a UI or a
> route exists.
>
> **Verification legend**
> | Icon | Meaning |
> |------|---------|
> | 🟢 | FULLY WORKING — traced end-to-end **and** covered by a passing automated test, or fully traced with no external dependency |
> | 🟣 | IMPLEMENTED BUT NOT VERIFIED — complete code + wired frontend, but depends on a live external service (Paystack / WHM / Namecheap / Cloudinary / Hubtel / Resend) or a browser session that was not exercised in this audit |
> | 🟡 | PARTIALLY WORKING |
> | 🔵 | UI ONLY / MOCK DATA |
> | 🔴 | BROKEN |
> | ⚪ | NOT IMPLEMENTED |

---

## 1. Executive Summary

EazWorld is a **mature, production-oriented monorepo** (two independent git apps: an
Express/Mongoose backend and a Next.js 14 frontend). The code quality is high:
consistent MVC structure, a uniform `{ success, data }` envelope, integer-pesewas money
discipline, HMAC-verified idempotent payment webhooks, IDOR ownership checks, an
immutable append-only audit log, and real server-side aggregation for reports.

**Automated validation actually run in this audit — all green:**

| Check | Command | Result |
|-------|---------|--------|
| Backend tests | `cd backend-eaz && npm test` | ✅ **19 suites / 112 tests passed** (176 s, `mongodb-memory-server`) |
| Frontend tests | `cd frontend-eaz && npm test` | ✅ **3 files / 31 tests passed** (vitest) |
| Frontend build | `cd frontend-eaz && npm run build` | ✅ **Compiled + all routes generated** |
| Frontend lint | `cd frontend-eaz && npm run lint` | ✅ **No ESLint warnings or errors** |
| Backend lint / typecheck | — | ⚪ No lint or typecheck script exists (plain JS, no config) |

Because much of the system depends on **live external services** (Paystack payments,
WHM/CyberPanel provisioning, Namecheap registration, Cloudinary uploads, Hubtel SMS,
Resend email), those flows are marked 🟣 — the code is complete and wired, but a live
end-to-end run was out of scope for a read-only audit. The webhook/fulfilment **logic**
around them *is* test-covered and therefore 🟢.

**Feature tally (68 discrete features assessed):**

| Status | Count |
|--------|-------|
| 🟢 Fully working (traced + test-backed) | **32** |
| 🟣 Implemented, not runtime-verified | **28** |
| 🟡 Partially working | **3** |
| 🔵 UI only / mock | **0** |
| 🔴 Broken | **0** |
| ⚪ Not implemented | **5** |

No broken features and no fake/mock backends were found. Gaps are **missing** features
(in-app notifications, AI chat, broad business settings) rather than deceptive ones.

---

## 2. Technology Stack

| Layer | Technology (verified in code) |
|-------|-------------------------------|
| **Frontend** | Next.js 14.2.35 (App Router), React 18, JavaScript/JSX (no TypeScript) |
| **Styling** | Tailwind CSS 3.4 (`darkMode: "class"`, `brand` token scale) — no styled-components |
| **Frontend state** | React Context (`AuthContext`, `CartContext`, `ThemeContext`) + **@tanstack/react-query v5** (`hooks/queries/*`) |
| **Data fetching** | Thin `fetch` wrapper `lib/api.js` (relative `/api/v1`, `credentials: 'include'`); `axios` is a listed dep but effectively unused on the client |
| **Backend** | Node + Express 4, **plain JavaScript (CommonJS)** |
| **Database** | MongoDB via **Mongoose 8** |
| **ORM/ODM** | Mongoose (25 models) |
| **Auth** | JWT (`jsonwebtoken`) in an **httpOnly cookie**; bcryptjs hashing; optional email-PIN 2FA |
| **Authorization** | `protect` + `restrictTo(...roles)` middleware (backend) + Next.js `middleware.js` route guard (edge, `jose` JWT verify) |
| **API architecture** | REST under `/api/v1/<resource>`, `{ success, data }` envelope, central error handler |
| **Storage/media** | Cloudinary (server-mediated via multer memory storage + streamifier) |
| **Payments** | Paystack (card + Mobile Money, GH₵) — SDK init + HMAC-verified webhook |
| **Email** | Resend + `@react-email` (transactional); `EmailLog` model records sends |
| **SMS** | Hubtel (repair status notifications) |
| **Domains/Hosting** | Namecheap (register/search) + WHM/CyberPanel (cPanel provisioning) |
| **Security middleware** | helmet+CSP, xss-clean, express-mongo-sanitize, hpp, express-rate-limit, cors, cookie-parser |
| **Background jobs** | `setInterval` in `server.js`: renewal job (24h), uncollected-device reminders (12h) |
| **Deployment** | Backend: PM2 (`ecosystem.config.js`) + Nginx on cPanel/EC2 (512 MB heap), `render.yaml`; Frontend: `next build` → AWS Amplify (`amplify.yml`) |

---

## 3. Route Map (Frontend)

App Router pages under `frontend-eaz/src/app`. Role enforced by `middleware.js` (edge)
**and** backend `restrictTo` on the APIs each page calls.

### Public / customer routes

| Route | Purpose | Role | Status |
|-------|---------|------|--------|
| `/` | Marketing home | Public | 🟢 |
| `/about`, `/services`, `/services/*`, `/seo`, `/resources`, `/visit-us`, `/privacy`, `/terms` | Static marketing/content | Public | 🟢 |
| `/portfolio`, `/portfolio/[slug]` | Portfolio (projects API) | Public | 🟣 |
| `/blog`, `/blog/[slug]` | Blog posts | Public | 🟣 |
| `/reviews` | Approved reviews + submit | Public | 🟣 |
| `/contact`, `/book-consultation` | Contact / consultation intake | Public | 🟣 |
| `/shop`, `/shop/[slug]`, `/shop/category/[category]` | Online shop catalog | Public | 🟢 (list/detail test-backed) |
| `/cart`, `/checkout` | Cart + guest checkout | Public | 🟢 order create test-backed; 🟣 Paystack redirect |
| `/order-confirmation/[reference]`, `/payment-success` | Post-payment confirmation (polls by reference) | Public | 🟢 lookup logic; 🟣 live pay |
| `/track-order` | Guest order lookup (orderNumber+phone) | Public | 🟢 |
| `/track/order/[trackingNumber]` | Shop-order tracking timeline | Public | 🟢 |
| `/track/[token]` | Repair-job public tracking + part ordering | Public | 🟣 |
| `/repair` | Self-serve repair booking | Public | 🟣 |
| `/domains`, `/domains/checkout` | Domain search + purchase | Public/auth | 🟢 search/pay logic test-backed; 🟣 live Namecheap |
| `/hosting`, `/hosting/checkout`, `/hosting/order-confirmation`, `/hosting/bank-transfer/[orderId]` | Hosting purchase | Public/auth | 🟢 order test-backed; 🟣 live WHM |
| `/auth/login`, `/auth/register`, `/auth/verify`, `/auth/verify-2fa`, `/auth/forgot-password`, `/auth/reset-password/[token]` | Auth flows | Public | 🟢 login/authz test-backed; 🟣 email PIN/reset delivery |
| `/maintenance` | Maintenance gate | Public | 🟢 |

### Dashboard routes (staff-side; `middleware.js` + backend gated)

| Route | Purpose | Role | Status |
|-------|---------|------|--------|
| `/dashboard` | Role-routed dashboard (customer/staff/admin) | All authed | 🟢 wiring traced |
| `/dashboard/orders`, `/dashboard/orders/[id]` | Customer's own shop orders | user | 🟢 |
| `/dashboard/domains`, `/dashboard/hosting`, `/dashboard/hosting/[orderId]`, `/dashboard/hosting/new-account` | Customer domain/hosting mgmt | user/staff | 🟣 |
| `/dashboard/commerce`, `/dashboard/commerce/orders`, `/dashboard/commerce/orders/[id]` | Shop orders admin/staff | admin/staff | 🟢 |
| `/dashboard/commerce/products`, `/products/new`, `/products/[id]/edit`, `/commerce/inventory` | Product catalog + shop inventory | admin/staff | 🟢 CRUD test-backed |
| `/dashboard/commerce/delivery-zones` | Delivery zones | admin | 🟣 |
| `/dashboard/repairs` | Repairs overview | staff+ | 🟣 |
| `/dashboard/settings` | Profile / password / 2FA / maintenance | All authed | 🟢 profile; 🟣 2FA live |
| `/dashboard/(admin)/users` | User/staff management | admin | 🟣 |
| `/dashboard/(admin)/activity-logs` | Audit log viewer | admin/superadmin | 🟢 authz+API test-backed |
| `/dashboard/(admin)/blog`, `/reviews`, `/chats`, `/consultations`, `/domain-orders`, `/hosting-orders`, `/emails` | Admin content/ops | admin | 🟣 |

### POS routes (`/dashboard/pos/*`, roles superadmin/admin/staff/technician)

| Route | Purpose | Status |
|-------|---------|--------|
| `/dashboard/pos` | Shop-wide POS overview | 🟢 aggregation logic; 🟣 render |
| `/dashboard/pos/jobs`, `/jobs/new`, `/jobs/[id]` | Repair jobs list / create / detail | 🟢 parts+stock test-backed; 🟣 photo upload |
| `/dashboard/pos/sell` | Point-of-sale checkout | 🟣 |
| `/dashboard/pos/orders` | Online part/repair orders review | 🟢 logic |
| `/dashboard/pos/inventory` | Parts inventory (dir exists; note below) | 🟢 API test-backed |
| `/dashboard/pos/suppliers`, `/suppliers/[id]` | Suppliers | 🟣 |
| `/dashboard/pos/expenses` | Expenses | 🟣 |
| `/dashboard/pos/warranty` | Warranty buckets | 🟣 |
| `/dashboard/pos/reports` | Consolidated BI reports | 🟢 analytics test-backed |

> Note: `/dashboard/pos/inventory` **directory** exists but has no `page.jsx` (inventory
> is served under `/dashboard/commerce/inventory`). Not a bug — just a dangling empty dir.

---

## 4. Feature Map

| Feature | Frontend | API | Backend logic | Database | Status |
|---------|----------|-----|---------------|----------|--------|
| Login / session cookie | ✅ | `POST /auth/login` | ✅ | User | 🟢 |
| Logout | ✅ | `POST /auth/logout` | ✅ | — | 🟢 |
| Register + email-PIN verify | ✅ | `/auth/register`,`/verify-pin`,`/resend-pin` | ✅ | User | 🟣 (email delivery) |
| Password reset | ✅ | `/auth/forgot-password`,`/reset-password/:token` | ✅ | User | 🟣 (email delivery) |
| Two-factor (email PIN) | ✅ | `/auth/2fa/*` | ✅ | User | 🟣 |
| Session persistence | ✅ (`/auth/me`) | `GET /auth/me` | ✅ | User | 🟢 |
| User/staff CRUD + block | ✅ | `/auth/users*` | ✅ | User | 🟣 |
| POS customers | ✅ | `/pos/customers*` | ✅ | PosCustomer | 🟣 |
| Shop order creation (guest) | ✅ | `POST /orders` | ✅ server-priced | Order | 🟢 |
| Shop order status/tracking | ✅ | `/orders/:id`,`/:id/tracking` | ✅ forward-only FSM | Order | 🟢 |
| Order tracking (public) | ✅ | `/orders/track/:tn` | ✅ | Order | 🟢 |
| Product CRUD + variants | ✅ | `/products*` | ✅ | Product | 🟢 |
| Product search/filter/sort | ✅ | `/products?q&sort&limit` | ✅ ReDoS-safe | Product | 🟢 |
| Inventory (parts) CRUD | ✅ | `/pos/inventory*` | ✅ | Part | 🟢 |
| Inventory/parts search | ✅ | `/pos/inventory?q` | ✅ name/sku/barcode | Part | 🟢 |
| Repair job create/update | ✅ | `/pos/jobs*` | ✅ | RepairJob | 🟢 (parts+stock) |
| Repair→inventory part link | ✅ | (job parts) | ✅ snapshot+deduct | Part/RepairJob | 🟢 |
| Repair payments (cash) | ✅ | `/pos/jobs/:id/payments` | ✅ | PosPayment | 🟣 |
| Repair payments (MoMo/card) | ✅ | `/pos/jobs/:id/momo-charge`,`card-charge` | ✅ | PosPayment | 🟣 (live Paystack) |
| Public repair part ordering | ✅ | `/track/:token/part-orders`,`/orders` | ✅ | PartOrder/RepairOrder | 🟢 fulfilment logic; 🟣 pay |
| Job balance payment | ✅ | `/track/:token/balance-payment` | ✅ | RepairJob | 🟢 logic; 🟣 pay |
| POS sales (counter) | ✅ | `/pos/sales*` | ✅ | Sale | 🟣 |
| Barcode/IMEI scan lookup | ✅ | `/pos/scan/:code` | ✅ | Part/RepairJob | 🟣 |
| Suppliers | ✅ | `/pos/suppliers*` | ✅ | Supplier | 🟣 |
| Expenses | ✅ | `/pos/expenses*` | ✅ | Expense | 🟣 |
| Warranty tracking | ✅ | `/pos/warranty` | ✅ | RepairJob | 🟣 |
| Reports & analytics | ✅ | `/pos/reports/analytics` | ✅ real aggregation | multi | 🟢 |
| POS overview | ✅ | `/pos/overview`,`/my-overview` | ✅ | multi | 🟢 logic |
| Payment webhook (all types) | n/a | `POST /api/webhooks/paystack` | ✅ HMAC+idempotent | multi | 🟢 (logic test-backed) |
| Shop order fulfilment | n/a | (webhook + verify) | ✅ atomic stock | Order/Part/Product | 🟢 |
| Domain search/check | ✅ | `/domain/search`,`/check*` | ✅ | — | 🟣 (live Namecheap) |
| Domain purchase + register | ✅ | `/domain/payment`,`/orders/:id/retry-registration` | ✅ | DomainOrder/User | 🟢 pay+retry logic; 🟣 live reg |
| Hosting plans/purchase | ✅ | `/hosting/*` | ✅ | HostingOrder | 🟢 order test-backed |
| Hosting provisioning (WHM) | ✅ | webhook → `provisionHostingAccount` | ✅ idempotent | HostingOrder | 🟢 logic test-backed; 🟣 live WHM |
| Hosting lifecycle (suspend/terminate/renew/cpanel-login) | ✅ | `/hosting/orders/:id/*` | ✅ | HostingOrder | 🟢 authz test-backed; 🟣 live WHM |
| Service order (web-design deposit) | ✅ | `/services/payment`,`/orders` | ✅ | ServiceOrder | 🟣 |
| Image/video upload | ✅ | `POST /uploads` | ✅ Cloudinary | — | 🟣 |
| Repair job photos | ✅ | `/pos/jobs/:id/photos` | ✅ Cloudinary | RepairJob | 🟣 |
| Reviews (service) | ✅ | `/reviews*` | ✅ moderation | Review | 🟣 |
| Product reviews | ✅ | `/products/:id/reviews`,`/product-reviews*` | ✅ | ProductReview | 🟢 (API test-backed) |
| Blog posts | ✅ | `/posts*` | ✅ | Post | 🟣 |
| Portfolio/projects | ✅ | `/projects*` | ✅ | Project | 🟣 |
| Contact / consultations | ✅ | `/contacts*` | ✅ | Contact | 🟣 |
| Delivery zones | ✅ | `/delivery-zones*` | ✅ | DeliveryZone | 🟣 |
| Live chat widget | ✅ | `/chat*` | ✅ rule-based | ChatSession | 🟡 (AI hook is a stub) |
| Email logs (admin) | ✅ | `/admin/email-logs` | ✅ | EmailLog | 🟣 |
| Activity log viewer | ✅ | `/activity-logs` | ✅ | ActivityLog | 🟢 |
| Maintenance mode | ✅ | `/settings` | ✅ | Settings | 🟢 |
| SMS notifications (Hubtel) | n/a | (status change) | ✅ graceful | — | 🟣 |
| Email notifications (Resend) | n/a | (status change) | ✅ | EmailLog | 🟣 |
| Background jobs (renewal/reminder) | n/a | `setInterval` | ✅ | multi | 🟣 |
| In-app notifications / alerts | ❌ | — | — | — | ⚪ |
| AI chat responses | (hook) | — | stub returns null | — | ⚪ |
| General business settings (tax/shop profile) | ❌ | only maintenance | — | Settings | ⚪ |
| Refunds | ❌ | — | — | — | ⚪ |
| Order/product cancellation as dedicated flow | partial | via status=cancelled | ✅ | Order | 🟡 |

---

## 5. API Map (selected — full contract verified in `routes/*`)

| Method | Endpoint | Purpose | Auth | Role | Frontend consumer | Status |
|--------|----------|---------|------|------|-------------------|--------|
| POST | `/api/v1/auth/login` | Login (issues cookie, 2FA branch) | No | — | `AuthContext.login` | 🟢 |
| GET | `/api/v1/auth/me` | Current user | Cookie | any | `AuthContext.fetchMe` | 🟢 |
| POST | `/api/v1/auth/users` | Create staff/user (Zod-validated) | Cookie | admin | `useUsers` | 🟣 |
| POST | `/api/v1/orders` | Guest checkout (server-priced) | No | — | checkout | 🟢 |
| GET | `/api/v1/orders?limit=` | Recent shop orders | Cookie | admin/staff | `useRecentOrders` | 🟢 |
| GET | `/api/v1/orders/mine` | Customer's own orders | Cookie | any | `useMyOrders` | 🟢 |
| GET | `/api/v1/orders/track/:tn` | Public tracking timeline | No | — | `useOrderTracking` | 🟢 |
| PATCH | `/api/v1/orders/:id` | Status change (FSM) | Cookie | admin/staff | `useUpdateOrderStatus` | 🟢 |
| POST | `/api/v1/orders/:id/tracking` | Append tracking event | Cookie | admin/staff | `useAddTrackingEvent` | 🟢 |
| GET | `/api/v1/products` | Public catalog (paginated) | No | — | `useProducts` | 🟢 |
| POST/PUT/PATCH/DELETE | `/api/v1/products*` | Product CRUD | Cookie | admin/staff | `useProducts` | 🟢 |
| GET | `/api/v1/pos/inventory?q=` | Parts search | Cookie | POS roles | `useInventorySearch`, job form | 🟢 |
| POST/PATCH | `/api/v1/pos/jobs*` | Repair jobs | Cookie | POS roles | `usePosJobs` | 🟢 |
| GET | `/api/v1/pos/reports/analytics` | Consolidated BI | Cookie | superadmin/admin/staff | `useReportsAnalytics` | 🟢 |
| POST | `/api/webhooks/paystack` | Payment webhook (raw body, HMAC) | Signature | — | Paystack | 🟢 |
| GET | `/api/v1/activity-logs` | Audit log | Cookie | admin/superadmin | `useActivityLogs` | 🟢 |
| GET | `/api/v1/settings` | Site settings (maintenance) | No | — | middleware, `useSettings` | 🟢 |

**Cross-check:** every distinct `api.*()` path used in the frontend (extracted from
`frontend-eaz/src`) resolves to a mounted backend route. **No frontend calls to
nonexistent endpoints were found. No duplicate/conflicting mounts found.** One
intentional dual-verb: `products/:id` accepts both `PUT` and `PATCH` (documented in the
route).

---

## 6. Database Map

**25 Mongoose models.** All monetary fields are integer pesewas with `min: 0` (and
integer validators on `Part`). `timestamps: true` is standard.

Core relationships:
- **User** (`superadmin|admin|user|staff|technician`) → embeds `shippingAddresses[]`, `domains[]`; indexes on `role`, `isBlocked`; unique `email`.
- **Order** → `items[]` reference `Product`/`Part`, optional structured `variant`; ref `DeliveryZone`; embedded `customer` snapshot + `phoneDigits`; `trackingHistory[]`; unique `orderNumber`/`trackingNumber`; indexes on `paystackReference`, `createdAt`.
- **Product** → `variants[]` (per-SKU stock), soft-delete via `isActive`, slug unique.
- **Part** (repair inventory) → ref `Supplier`; `compatibleWith[]`; text index (`name/sku/barcode`), partial-unique `sku`, sparse `barcode`; `allowNegativeStock` override.
- **RepairJob** → ref `PosCustomer`, `assignedTo`(User), `createdBy`(User); embedded `parts[]` (each optionally ref `Part`, with `priceAtTime`/`costAtTime` snapshots + `stockDeducted` flag); `photos[]`, `balancePayments[]`, `trackingToken`.
- **PartOrder / RepairOrder** → ref `RepairJob`/`Part`; `paystackReference`; drive online part fulfilment.
- **PosPayment** → ref `RepairJob`, `receivedBy`(User); `reference` used for idempotency.
- **Sale** → ref `cashier`(User); `items[]`; `voided`.
- **HostingOrder / DomainOrder / ServiceOrder** → ref `User`; `paystackReference`; provisioning state.
- **ActivityLog** → append-only, denormalized actor snapshot, `changes[]`, 7 indexes matching admin query patterns.
- **Settings** → singleton (`key: 'global'`) with `maintenanceActive` virtual.
- Others: **Contact, ChatSession, EmailLog, Expense, Supplier, Post, Project, Review, ProductReview, DeliveryZone**.

**Cascade/integrity notes:** No DB-level cascades (MongoDB). Deletes are localized
(e.g. `deletePart` is a hard delete; products use soft-delete via `isActive`). Money
snapshots on job parts intentionally decouple historical price from live inventory.

**Frontend↔DB field consistency:** money arrives in pesewas everywhere and is divided by
100 only at the display edge (`formatGhs`/inline). No `imageUrl`-vs-`image` style
mismatches were found; images are stored as `images[]` (parts/products) or `photos[]`
(jobs) and rendered accordingly.

---

## 7. Role / Permission Matrix

Roles: **user (customer), staff, technician, admin, superadmin.** `superadmin` implicitly
satisfies every `restrictTo` check (see `middleware/auth.js`). Enforcement is on the
**backend** (`restrictTo`) with a secondary **edge guard** in `middleware.js`.

| Feature | Customer (user) | Technician | Staff | Admin | SuperAdmin |
|---------|:---:|:---:|:---:|:---:|:---:|
| Shop (browse/checkout) | ✓ | – redirected to dashboard | – | – | – |
| Own orders / repairs / domains / hosting | ✓ | ✓(assigned) | ✓ | ✓ | ✓ |
| POS dashboard (personal) | ✗ | ✓ (no money) | ✓ | ✓ | ✓ |
| Repair jobs (create/update) | ✗ | ✓ | ✓ | ✓ | ✓ |
| Inventory read | ✗ | ✓ | ✓ | ✓ | ✓ |
| Inventory create/update | ✗ | ✗ | ✓ | ✓ | ✓ |
| Inventory delete | ✗ | ✗ | ✗ | ✓ | ✓ |
| POS sales | ✗ | ✓ | ✓ | ✓ | ✓ |
| Sale void | ✗ | ✗ | ✗ | ✗ | ✓ |
| Suppliers read | ✗ | ✗ | ✓ | ✓ | ✓ |
| Suppliers write | ✗ | ✗ | ✗ | ✗ | ✓ |
| Expenses read | ✗ | ✗ | ✓ | ✗* | ✓ |
| Expenses write | ✗ | ✗ | ✗ | ✗* | ✓ |
| Reports & analytics | ✗ | ✗ | ✓ | ✓ | ✓ |
| Shop-wide overview (money) | ✗ | ✗ | ✗ | ✓ | ✓ |
| Shop orders (commerce admin) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Product CRUD | ✗ | ✗ | ✓ | ✓ | ✓ |
| Delivery zones | ✗ | ✗ | ✗ | ✓ | ✓ |
| Users/staff management | ✗ | ✗ | ✗ | ✓ | ✓ |
| Hosting create (staff-create) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Hosting suspend/terminate | ✗ | ✗ | ✗ | ✓ | ✓ |
| Activity logs | ✗ | ✗ | ✗ | ✓ | ✓ |
| Blog / reviews / chat / contacts / emails admin | ✗ | ✗ | ✗ | ✓ | ✓ |
| Settings (maintenance) | ✗ | ✗ | ✗ | ✓ | ✓ |

> \* Expenses write is `restrictTo('superadmin')` and read is `('superadmin','staff')` —
> `admin` is **not** listed for expenses (superadmin still passes via the implicit
> override). This looks intentional but is worth confirming as a product decision — it's
> an inconsistency with the otherwise admin-inclusive pattern. **Not a security hole**
> (it's *more* restrictive, not less).

**Authorization verdict:** enforced on the backend for every sensitive route (verified by
reading each `routes/*` file and by the `activity-logs` + `hosting lifecycle` +
`customer isolation` tests, which assert 401/403 for the wrong role). The edge
`middleware.js` is a UX convenience layer, **not** the sole gate — good.

---

## 8. Authentication Flow (actual)

```
Login (email or phone + password)
  → authController.login: User.findOne($or lookups).select('+password ...')
  → comparePassword (bcrypt)
  → blocked? → 403 + AUTH_LOGIN_FAILED audit
  → unverified (isVerified=false AND verifyPin set)? → 403 requiresVerification
  → 2FA enabled? → generate PIN, email it, return { requiresTwoFactor } (no cookie yet)
  → else sendTokenResponse: jwt.sign({id,email,role}) → res.cookie('token', httpOnly)
       • token is NEVER placed in the JSON body (anti-XSS)
  → AUTH_LOGIN audit record

Authenticated request
  → api.js sends cookie (credentials:'include')
  → middleware/auth.protect: read cookie/Bearer → jwt.verify → User.findById(-password)
  → blocked check → attach req.user
  → restrictTo(...roles) → superadmin bypass OR role ∈ roles

Session persistence  → GET /auth/me on app load (AuthContext)
Logout               → clears cookie (reuses cookieOptions), AUTH_LOGOUT audit
Password reset       → hashed token + expiry, single-use
Cookie flags         → httpOnly always; secure + sameSite:strict in prod (lax in dev)
```

Rate limits: login 10/15min, register 5/60min, forgot-password 5/60min, verify 10/15min.
**Status: 🟢** for login/logout/authz (test-backed); **🟣** for the email-dependent
verify/reset/2FA delivery.

---

## 9. Orders — Detailed

- **Creation (🟢):** `POST /orders` is guest-friendly, **recomputes every price
  server-side** from the DB (never trusts client prices), validates stock (incl. variant
  stock), computes delivery fee from `DeliveryZone`, initializes Paystack, persists a
  `pending` order with `trackingHistory[0]`. Test-backed (`customerPurchase`, `variants`).
- **Confirmation (🟢 logic / 🟣 live):** `GET /orders/by-reference/:ref` actively verifies
  with Paystack when still pending and fulfils idempotently — does not rely on the webhook
  alone. Frontend polls every 4 s until `paid`.
- **Fulfilment (🟢):** `fulfilShopOrder` does an **atomic** `pending→paid` transition and
  guarded per-item stock decrement (never oversells; variant-aware). Idempotent.
- **Status/tracking (🟢):** forward-only FSM (`canTransition`), terminal `delivered`/
  `cancelled`, every change appended to `trackingHistory` + audit log. `addTrackingEvent`
  keeps status and history in sync. Test-backed (`orderTracking`).
- **Customer isolation (🟢):** `/orders/mine[/:id]` match by email/normalized phone, never
  a client id — no IDOR.
- **Search:** guest `POST /orders/track` requires orderNumber **and** matching phone
  (prevents order-number enumeration).

---

## 10. Inventory — Detailed

- **Parts CRUD (🟢):** create/update/delete with activity logging; stock adjustments emit
  `INVENTORY_STOCK_ADJUSTED` with before/after (test-backed).
- **Search (🟢):** `getParts` regex-matches `name/sku/barcode` (ReDoS-safe via
  `escapeRegex`); optional `includeProducts` merges shop products; `lowStock` via `$expr`.
- **Stock safety (🟢):** `deductPartStock` uses an **atomic guarded decrement**
  (`quantity >= amount`) and only goes negative when `allowNegativeStock` is set — 4
  dedicated tests confirm it never oversells.
- **Indexes:** text index + partial-unique SKU + sparse barcode. `check:duplicate-skus`
  script exists to run before the unique index builds.

---

## 11. Repairs — Detailed

- **Create/update (🟢):** `createJob`/`updateJob` resolve `partId`s against the **Part
  inventory**, snapshot `priceAtTime`/`costAtTime` in pesewas, and support custom (non-
  inventory) part lines. Auto-assign to least-loaded technician available.
- **Repair ↔ inventory integration (🟢):** selecting a part in the job form calls
  `GET /pos/inventory?q=` (the real Part collection) — confirmed traced from the form input
  through to `createJob`. Stock is deducted **once** via `deductJobPartsOnce` (guarded,
  flagged `stockDeducted` to prevent double-count). `applyPaidPartToJob` (online orders)
  snapshots real cost and reserves stock once — 4 tests cover the cost/reserve/no-double/
  no-negative cases.
- **Public tracking + online part ordering (🟢 logic / 🟣 pay):** `/track/:token` returns a
  safe subset; customers can order parts (`PartOrder`) or a combined repair order
  (`RepairOrder`) or pay an outstanding balance — all via Paystack, all fulfilled
  idempotently by the webhook.
- **Balance math (🟢):** `computeJobBalancePesewas` = diagnosis + Σ(parts×qty) + labor −
  Σ(payments), all pesewas.
- **Notifications (🟣):** status changes trigger SMS (Hubtel) + email (Resend).

---

## 12. Shipping / Tracking — Detailed

```
Order (has trackingNumber, generated at creation)
  → staff append events via POST /orders/:id/tracking (status/note/location)
  → trackingHistory[] persisted on the order
  → order detail page renders link → /track/order/{trackingNumber}
  → tracking page → GET /orders/track/:trackingNumber (public)
      returns { status, destination, sorted history, latestEvent }  (no PII/money leak)
```

**Verified (🟢):**
- The tracking **link on the order detail page** points at `/track/order/${trackingNumber}`
  (confirmed in `dashboard/commerce/orders/[id]/page.jsx`).
- The **tracking detail page** consumes `useOrderTracking` → the public endpoint and
  renders the sorted timeline (test-backed: returns minimal data, sorted, case-insensitive,
  404 on unknown).
- `latestEvent` is exposed so an order page can show the most recent update from the same
  cache entry.

Repair-job tracking is a separate `trackingToken` flow under `/track/:token` (🟣).

---

## 13. Payments — Detailed

- **Provider:** Paystack (card + Mobile Money, GH₵). SDK guarded — only initialized when a
  real `sk_...` secret is present, otherwise endpoints return a clear 503/500.
- **Webhook (🟢):** `POST /api/webhooks/paystack` mounted **before** the JSON parser with
  `express.raw`; verifies HMAC-SHA512 signature against the raw body; ignores non
  `charge.success`. Routes the reference across **7 payment types** (hosting, domain, shop
  order, part order, repair order, job balance, service). Each path: amount/currency
  reconciliation (`amountMismatch`, test-backed), **atomic idempotent** state transition,
  audit log, and side-effect fulfilment. Duplicate webhooks are no-ops.
- **Money discipline:** integer pesewas end-to-end; major-unit models (hosting/domain/
  service) convert with `×100` before comparing to Paystack's pesewas.
- **In-store charges (🟣):** MoMo/card charge init + poll endpoints exist for the POS.
- **Refunds (⚪):** not implemented anywhere.

**Status:** fulfilment/reconciliation **logic** is 🟢 (test-backed via `webhook`,
`paidPartFulfilment`, `customerPurchase`); actual money movement requires live Paystack →
🟣 for the interactive charge flows.

---

## 14. Dashboards — Detailed

- **Role routing (🟢 traced):** `/dashboard` renders `MyDashboard` (staff/technician),
  `FullDashboard` (admin/superadmin), or `CustomerOverview` (user) based on `user.role`.
- **Staff "Recent Orders" (🟢 traced — explicitly requested):** `MyDashboard` calls
  `useRecentOrders(5)` → `GET /orders?limit=5` (admin/staff-gated, newest-first, test-
  backed) **and** `usePartOrders('all')` → `GET /pos/part-orders`, rendered by
  `RecentOrdersList`. Technicians are excluded (`enabled: !isTech`) because the orders API
  is not authorized for them. The data path is real, not a placeholder.
- **Personal stats (🟢 logic):** `getMyOverview` scopes counts to jobs created/assigned and,
  for non-technicians, the sales they rang up + low-stock count. Technicians never see money.
- **Admin overview (🟢 logic / 🟣 render):** `getOverview` aggregates jobs, payments, daily
  revenue, payment methods, top parts, technician performance, expenses.

---

## 15. Reports — Detailed

**🟢 REAL backend reports — not mock, not client-side math.** `getReportsAnalytics`
(`GET /pos/reports/analytics`) runs server-side MongoDB aggregation over `PosPayment`
(repair revenue), `Sale` (counter sales), `Order` (online, revenue-bearing statuses only),
`RepairJob`, `Part`, `Product`, `Expense`:
- KPIs: revenue (split repair/POS/shop), orders (total/paid/pending/cancelled/AOV),
  repairs (open/completed/parts used), inventory (counts/units/low/out/value), payments,
  expenses/net profit.
- A **stacked daily revenue series** with zero-filled gaps.
- **Previous-period comparison** with `pctChange` when a bounded range is supplied.
- Payment-method and product/parts leaderboards.
- Expenses + net profit gated to admin/superadmin only.

Test-backed (`reportsAnalytics.test.js`): correct totals for a known range and 403 for
unauthorized roles. Money stays pesewas; the browser only divides by 100 at render.

---

## 16. Activity Logs — Detailed

- **Model (🟢):** append-only, immutable — **no create/update/delete route exists**
  anywhere; writes go only through `activityLogService.log`/`logFromRequest`. Denormalized
  actor snapshot survives user deletion. 7 indexes matching query patterns.
- **API (🟢):** `GET /activity-logs`, `restrictTo('admin')` (superadmin passes via
  override). Pagination (limit clamped 1–100), free-text search across actor/description/
  resource, filters (action/resourceType/actor/role/status/resourceId/date range), sort.
- **Backend-enforced access (🟢, explicitly checked):** tests assert **401** for
  unauthenticated, **403** for `staff`/`user`, **200** for `admin`/`superadmin` — the
  guard is on the API, not just a hidden nav link.
- **Privacy (🟢):** a dedicated test asserts no passwords/tokens/card values ever land in
  audit records across a realistic workflow.

---

## 17. Forms

| Form | Validation | API | DB write | Status |
|------|-----------|-----|----------|--------|
| Login | client + server | `/auth/login` | — | 🟢 |
| Register | client + server (+PIN) | `/auth/register` | User | 🟣 (email) |
| Password reset | server (token+expiry) | `/auth/reset-password/:token` | User | 🟣 (email) |
| Staff/User create | **Zod** (`createUserSchema`) | `/auth/users` | User | 🟣 |
| Product create/edit | server | `/products` | Product | 🟢 |
| Inventory (part) | server (required name/cost/sell) | `/pos/inventory` | Part | 🟢 |
| Repair job (new) | server; live parts search | `/pos/jobs` | RepairJob | 🟢 |
| Shop checkout | server (re-priced, stock-checked) | `/orders` | Order | 🟢 |
| POS sell | server | `/pos/sales` | Sale | 🟣 |
| Contact / consultation | server (+rate limit) | `/contacts` | Contact | 🟣 |
| Review / product review | server (+rate limit, moderation) | `/reviews`,`/products/:id/reviews` | Review/ProductReview | 🟣 / 🟢(API) |
| Domain checkout | server (amount re-derived) | `/domain/payment` | DomainOrder | 🟢 (tamper test) |
| Hosting checkout | server | `/hosting/orders` | HostingOrder | 🟢 |
| Settings (maintenance) | server (allow-list fields) | `/settings` | Settings | 🟢 |

Forms sanitize input on submit (`lib/sanitize.js` client, `utils/sanitize.js` server).
Validation is predominantly server-side; **Zod is only applied to a few endpoints**
(`authSchema`, `contactSchema`, `domainSchema`) — most controllers hand-validate (noted in
CLAUDE.md as intentional legacy).

---

## 18. Search

| Search | Frontend | API | Backend query | Status |
|--------|----------|-----|---------------|--------|
| Product catalog | shop pages | `/products?q&sort` | regex name (ReDoS-safe) + filters | 🟢 |
| **Repair parts (inventory)** | job form + `useInventorySearch` | `/pos/inventory?q` | regex `name/sku/barcode` on **Part** | 🟢 |
| Public orderable parts | `/track` / repair page | `/track/parts?q` | regex `name/sku/barcode/compatibleWith`, price>0 | 🟢 |
| Barcode/IMEI scan | POS scan | `/pos/scan/:code` | exact barcode → IMEI job → SKU → product | 🟣 |
| Customer lookup | POS | `/pos/customers?q` | phone/name | 🟣 |
| Activity log free-text | admin | `/activity-logs?q` | multi-field regex | 🟢 |
| Email logs | admin | `/admin/email-logs?q` | `to` regex | 🟣 |

**Repair parts search — explicitly verified (🟢):** the job-creation form's part search
calls `GET /pos/inventory?q=` which queries the **Part inventory** collection (not a static
list), returning name/SKU/price/stock/images; selection stores `{ partId, quantity }` which
`createJob` resolves back to inventory for price/cost snapshots and stock deduction. The
public parts catalog additionally matches `compatibleWith` (device model). Both the
`shopFulfilAndPartsSearch` and `partDetail` tests exercise the parts path.

---

## 19. File / Image Handling

- **Mechanism (🟣):** server-mediated. `multer` memory storage → `streamifier` →
  Cloudinary `upload_stream` (folder `eazworld`, transform to ≤1200px). Two upload paths:
  admin `POST /uploads` (image/video, 5 MB) and `POST /pos/jobs/:id/photos` (image, 8 MB).
- **Validation:** MIME allow-list + size limits on both.
- **Storage/reference:** Cloudinary `secure_url` is stored in `images[]`/`photos[]`; no
  local disk writes.
- **Rendering:** `next.config.mjs` whitelists `res.cloudinary.com` (+ a few demo hosts) for
  `next/image`; CSP `img-src` allows Cloudinary + data/blob.
- **No hardcoded image domains** beyond the documented Cloudinary/demo allow-list. `FRONTEND_URL` is resolved via `utils/frontendUrl.js` (env-driven, localhost fallback in dev).

Marked 🟣 because the actual Cloudinary round-trip requires live credentials and was not
exercised.

---

## 20. React Query / Data Fetching

- **Setup:** `QueryProvider` + `queryClient.js`; centralized query keys in `lib/queryKeys.js`
  (`qk.*`) — no stringly-typed keys scattered around.
- **Queries:** all list/detail hooks set sensible `staleTime` (10–60 s by volatility),
  `keepPreviousData`/`placeholderData` for smooth paging/search, and `enabled` gates
  (e.g. search disabled until a term; order hooks disabled for technicians).
- **Mutations & invalidation (correct):** `useUpdateOrderStatus`/`useAddTrackingEvent`
  invalidate `qk.orders.all`; `useUpdatePosOrderStatus` invalidates `['pos','part-orders']`.
  Scoped invalidation, not a blanket cache nuke.
- **Loading/error states:** hooks expose `isLoading`/`error`; dashboards and tracking pages
  render spinners + error messages (verified in components).
- **Coexistence:** some older pages still use raw `useEffect` + `api.js` (e.g. the repair
  job form's part search), which is fine and documented as the transitional pattern.

**Problems found:** none material. Minor: the job-form part search uses a manual
`useEffect` debounce instead of the shared `useInventorySearch` hook — duplication, not a
bug.

---

## 21. Security Findings

No secrets are printed below. Nothing destructive was attempted.

**CRITICAL:** none found.

**HIGH:** none found. Payment webhooks verify HMAC + amount/currency and are idempotent;
uploads are type/size-restricted; auth token is httpOnly and never in the body; CORS is an
allow-list; sensitive routes are backend-gated; IDOR is prevented on orders/domains/hosting
by ownership checks (test-backed for hosting customer isolation).

**MEDIUM:**
1. **`User.phone` is not unique** (only `sparse`). Login looks up by `$or` including phone;
   if two accounts share a phone, the wrong account could be selected. Email is unique, so
   email login is unaffected. *Location:* `models/User.js`, `authController.login`.
2. **Global rate limit is broad** (150 req / 15 min per IP) — fine for a small shop, but
   there is no distributed store, so limits reset per process/instance. *Location:*
   `app.js`.
3. **Secrets live in `.env` files** (`backend-eaz/.env`, `frontend-eaz/.env.local`, and a
   top-level `.env`). `.gitignore` covers `.env*`, and no secret values were found in
   tracked source. Confirm none of these are committed in the two app repos.

**LOW:**
4. **Chat `getAIResponse` is a stub** returning `null` (rule-based fallback). No security
   issue; flagged for completeness.
5. **`JWT_SECRET` is consumed by both backend (sign/verify) and the Next.js edge
   middleware (verify).** Ensure both environments receive the same secret; a mismatch
   silently downgrades signed-in staff to "guest" at the edge (fails safe, but confusing).
6. **CSP allows `'unsafe-inline'`/`'unsafe-eval'` in the frontend script-src** (needed for
   Next.js + Paystack inline). Standard for this stack; note for hardening later.

**Positive security controls observed:** helmet+CSP, xss-clean, mongo-sanitize, hpp,
per-route rate limits (auth/contact/review/chat/domain/track), `escapeRegex` on all
user-supplied search terms, forward-only order FSM, append-only audit log with a
no-secret-leak test, `trust proxy: 1` for correct client IPs.

---

## 22. Broken Features

**None found.** No feature was observed to be non-functional at the code level, and the
full automated suite (112 backend + 31 frontend) passes. Items that cannot be *confirmed*
working without live third-party credentials are listed as **Partial/Unverified** below,
not "broken."

---

## 23. Partial Features

| Feature | Expected | Actual | Likely cause | Files | Severity |
|---------|----------|--------|--------------|-------|----------|
| Live chat | Assistant answers questions | Rule-based keyword engine answers; AI path returns `null` | `getAIResponse` is an intentional stub (`// TODO: replace with AI call`) | `controllers/chatController.js` | Low |
| Expenses access | Admin can manage expenses | `admin` role omitted from expense read/write (only superadmin + staff-read) | Route role lists | `routes/posRoutes.js` | Low (confirm intent) |
| Order cancellation | Dedicated cancel action | Achieved via status → `cancelled` (no stock restock on cancel) | No restock logic | `orderController.updateOrderStatus`, `fulfilShopOrder` | Low–Med |

---

## 24. Missing Features (⚪)

1. **In-app notifications / alert center** — no `Notification` model, API, or UI. Only SMS
   (Hubtel) + email (Resend) exist.
2. **AI chat responses** — hook present, implementation absent (rule-based only).
3. **General business settings** — `Settings` holds only maintenance fields. No shop
   profile, tax/VAT config, currency, or business-hours settings (some constants are
   hardcoded in `services/notify.js`/`chatController.js`).
4. **Refunds** — no refund endpoint or Paystack refund call anywhere.
5. **Stock restock on order/repair cancellation** — cancelling does not return reserved
   stock.

---

## 25. UI-Only Features

**None.** Every page inspected is backed by a real, mounted API and a real DB operation.
The only "mock" strings in the codebase are decorative CSS mockups on the marketing
`/services` page (a fake dashboard illustration) and Figma-mention copy — not data stubs.

---

## 26. Hardcoded / Mock Data

- **Decorative only:** `app/services/page.jsx` renders a CSS "mock dashboard" illustration
  (comments literally say "Mock browser bar / Mock product grid"). No data implication.
- **Business constants (not mock, but hardcoded):** chat `KNOWLEDGE` price list & contact
  info (`controllers/chatController.js`); `SHOP_NAME`/`SHOP_PHONE` defaults and pricing
  copy in `services/notify.js`. These should ideally live in settings/env.
- **Demo image hosts** whitelisted in `next.config.mjs` (`picsum.photos`, `unsplash`,
  `placehold.co`, `clearbit`, `microlink`) — used for placeholder imagery.
- **No fake API responses, no mock data arrays feeding real screens, no placeholder
  statistics** were found. Dashboard/report numbers are real aggregations.

---

## 27. Technical Debt

1. **Two data-fetching patterns coexist** (react-query hooks vs. raw `useEffect`+`api.js`).
   Intentional/transitional but worth consolidating.
2. **Validation is inconsistent** — Zod on a few endpoints, manual parsing on most.
3. **`axios` is a dependency on both apps but effectively unused on the client** (fetch
   wrapper is used) — dead dependency (already noted in `REFACTORING_AUDIT.md`).
4. **`*Ghs` field names now carry pesewas** (post money-migration) — accurate but
   misleading names (`unitPriceGhs`, `amountGhs`).
5. **Empty `/dashboard/pos/inventory` route directory** with no page.
6. **Business config hardcoded** in services/controllers instead of `Settings`.
7. **No backend lint/typecheck tooling** (plain JS by design, but no ESLint config).
8. **Rate limiting is in-process** (no shared store) — fine at current scale.

---

## 28. Test Results (actually executed 2026-08-18)

| Check | Command | Result |
|-------|---------|--------|
| **Backend tests** | `cd backend-eaz && npm test` | ✅ **19 suites, 112 tests, all passed** (176 s). Covers: deductPartStock, health, hosting purchase+staff-create+lifecycle, domain purchase+retry, part detail, activity-log authz+privacy+pagination, products listing/status/variants, paid-part fulfilment, provisioning, order tracking, webhook amount reconciliation, customer purchase, POS money migration, seed catalog, shop fulfil + parts search. |
| **Frontend tests** | `cd frontend-eaz && npm test` | ✅ **3 files, 31 tests, all passed** (vitest): `lib/shop`, `lib/activityLog`, `context/CartContext`. |
| **Frontend build** | `cd frontend-eaz && npm run build` | ✅ Compiled successfully; all ~90 routes generated (static/dynamic mix); middleware bundle 33 kB. |
| **Frontend lint** | `cd frontend-eaz && npm run lint` | ✅ No ESLint warnings or errors. |
| **Backend lint** | — | ⚪ No lint script. |
| **Backend typecheck** | — | ⚪ N/A (plain JS). |

Frontend test coverage is **thin** (3 files) relative to the app's size — the backend is
far better covered. This is a coverage gap, not a failure.

---

## 29. Priority Fix List

> Fixes are for a **later** task — this document only records them.

### P0 — Critical / Blocking
- **None.** No broken or insecure feature blocks use. (The app builds, all tests pass.)

### P1 — Important
| Issue | Impact | Location | Recommended fix (later) |
|-------|--------|----------|--------------------------|
| `User.phone` not unique but used for login lookup | Wrong account could match if phones collide | `models/User.js`, `authController.login` | Enforce unique+sparse on phone (after de-duping) or restrict phone-login to verified-unique numbers |
| No stock restock on cancellation | Inventory drifts when paid orders/jobs are cancelled | `orderController.updateOrderStatus`, `fulfilShopOrder` | Add guarded re-increment on `→ cancelled` for already-decremented orders |
| Confirm live third-party flows (Paystack charge, WHM provision, Namecheap register, Cloudinary, Hubtel, Resend) | These are 🟣 — logic is sound but never run E2E | `services/*`, charge/upload controllers | Run a sandbox E2E pass per integration and record results |
| Thin frontend test coverage | Regressions in UI/hooks may go unnoticed | `frontend-eaz` | Add component/integration tests for checkout, dashboard recent-orders, tracking, parts search |

### P2 — Improvements
| Issue | Impact | Location | Recommended fix (later) |
|-------|--------|----------|--------------------------|
| Expense role list excludes `admin` | Possible unintended access model | `routes/posRoutes.js` | Confirm intent; align with admin-inclusive pattern if needed |
| Hardcoded business config | Hard to change shop name/prices/contact | `chatController.js`, `notify.js` | Move to `Settings`/env |
| Two fetching patterns + unused axios | Inconsistency, dead dep | frontend hooks/pages | Standardize on react-query; drop axios |
| `*Ghs` misnomer fields | Confusing for new devs | POS models/controllers | Rename to `*Pesewas` in a migration |
| In-app notifications, refunds, broader settings, AI chat | Missing product features | — | Scope as new features |
| Empty `/dashboard/pos/inventory` dir | Dead route | frontend app dir | Remove |

---

## Appendix — Method & Confidence

- **Every route file** in `backend-eaz/routes` was read to map endpoints + auth.
- **Controllers read in full or in depth:** order, webhook (+`fulfilShopOrder`,
  `deductPartStock`), POS inventory/reports/common/job, auth, activity-log, upload,
  settings, domain (IDOR paths), chat, plus the notify/namecheap/whm services and job
  schedulers.
- **Models read:** User, Order, Part, ActivityLog, Settings (others mapped via
  references/usage).
- **Frontend:** `middleware.js`, `lib/api.js`, `AuthContext`, all 22 `hooks/queries/*`
  reviewed for the key domains, dashboard role routing + recent-orders wiring, tracking
  pages, and the repair-job part-search path traced end-to-end. All `api.*()` call paths
  extracted and cross-checked against backend routes.
- **Runtime:** backend jest, frontend vitest, `next build`, and `next lint` were actually
  executed; results transcribed above verbatim.
- **Confidence:** 🟢 items are backed by a passing test or a fully traced dependency-free
  path. 🟣 items have complete, correct-looking code and correct wiring but depend on live
  external services or a browser session not exercised here — they are *expected* to work
  but were not runtime-confirmed, per the "don't say working unless verified" rule.
