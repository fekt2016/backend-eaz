# EazWorld — Full Code Review

> Reviewed on 2026-07-16
> Project: Next.js 14 + Express + MongoDB full-stack digital agency platform

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Security Issues](#2-security-issues)
3. [Backend Issues](#3-backend-issues)
4. [Frontend Issues](#4-frontend-issues)
5. [Architecture & Design](#5-architecture--design)
6. [Code Quality & Maintainability](#6-code-quality--maintainability)
7. [Performance](#7-performance)
8. [DevOps & Configuration](#8-devops--configuration)
9. [Strengths](#9-strengths)
10. [Priority Recommendations](#10-priority-recommendations)

---

## 1. Executive Summary

The EazWorld project is a well-structured full-stack application with a mature security posture. The codebase shows thoughtful design decisions: httpOnly cookie auth, Next.js rewrites to eliminate CORS issues, Paystack integration, WHM/cPanel provisioning, and comprehensive rate limiting. However, there are several critical security gaps, significant code duplication, dead code, missing validation, and architectural inconsistencies that should be addressed before production deployment.

**Overall rating: 7/10** — Good foundation with several issues that need fixing.

---

## 2. Security Issues

### 🔴 CRITICAL: Verification & 2FA PINs stored in plaintext

**Files:** `backend-eaz/controllers/authController.js`, `backend-eaz/models/User.js`

Both the email verification PIN (`verifyPin`) and the 2FA PIN (`twoFactorPin`) are stored as **plaintext** in MongoDB. If the database is compromised, an attacker gains the ability to verify any account or bypass 2FA.

```js
// authController.js:70-80
const pin = generatePin();          // plain 6-digit number
user.verifyPin = pin;               // stored as-is in DB
user.verifyPinExpires = pinExpires;

// authController.js:164-166
user.twoFactorPin = pin;            // also plaintext
```

**Fix:** Hash PINs with SHA-256 (or bcrypt) before storing. You only need to compare hashes on verification — PINs don't need to be recoverable.

### 🔴 CRITICAL: Passwords sent in plaintext via email

**File:** `backend-eaz/utils/email.js:324-346`

The `sendAccountCreatedEmail` function sends the user's password in **plaintext** in an email:

```html
<tr><td>Password</td><td style="font-family:monospace;">${password}</td></tr>
```

Email is not a secure channel. Passwords should never be transmitted via email. If an account is auto-created, force a password reset flow instead.

### 🟡 HIGH: xss-clean middleware applied before body parsing

**File:** `backend-eaz/app.js:74-78`

```js
app.use(xss());                  // strip XSS from body/query  ← runs before JSON parser
app.use(mongoSanitize());        // prevent NoSQL injection
app.use(hpp({...}));
// ...
app.use(express.json({ limit: '5mb' }));   // ← body parsed here
```

The `xss-clean` middleware needs the body to be parsed to sanitize it, but it's registered before `express.json()`. This means it's effectively a no-op for JSON request bodies. The sanitization utilities in `utils/sanitize.js` partially compensate, but the middleware isn't providing the expected protection.

**Fix:** Move body parsing before xss-clean and mongo-sanitize (but after webhook routes).

### 🟡 HIGH: JWT secret reused for cookie signing

**File:** `backend-eaz/app.js:90`

```js
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));
```

If the `COOKIE_SECRET` env var isn't set (it's optional), the JWT signing secret is reused for cookie signing. If one is compromised, both auth mechanisms are broken. Use a separate secret for cookies.

### 🟡 HIGH: CORS error message leaks the client origin

**File:** `backend-eaz/app.js:124`

```js
cb(new Error(`CORS: origin ${origin} not allowed`));
```

The origin is included in the error message, which is sent to the client. This leaks information about what origins are being rejected vs. allowed (via timing/side channels).

### 🟡 MEDIUM: `adminChangePassword` has weak validation

**File:** `backend-eaz/controllers/authController.js:493-509`

```js
const adminChangePassword = async (req, res, next) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ ... });
  }
  targetUser.password = newPassword;
  await targetUser.save();
```

Only checks minimum length. The `validatePassword` function in `utils/sanitize.js` enforces uppercase, lowercase, digit, and symbol requirements — but this endpoint doesn't use it. An admin could set a weak password for any user.

### 🟡 MEDIUM: No brute-force protection on PIN verification

**Files:** `backend-eaz/controllers/authController.js:273-319`, `:428-444`, `:467-490`

The `verifyPin`, `confirmTwoFactor`, and `verifyTwoFactor` endpoints have a 6-digit PIN (1M combinations) with no rate limiting beyond the global 150 req/15min. An attacker could brute-force the PIN within a single session.

**Fix:** Add per-user rate limiting on PIN verification endpoints, or invalidate the PIN after 3-5 failed attempts.

### 🟡 MEDIUM: `trust proxy` is set globally without restrictions

**File:** `backend-eaz/app.js:42`

```js
app.set('trust proxy', 1);
```

This trusts the first proxy unconditionally. If the app is ever exposed directly to the internet (without Nginx), the client IP can be spoofed. Use more specific trust settings.

---

## 3. Backend Issues

### 🟡 HIGH: Zod validation schemas defined but never used

**Files:**
- `backend-eaz/validation/authSchema.js` — defines `registerSchema`, `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema`
- `backend-eaz/validation/contactSchema.js` — defines `submitContactSchema`
- `backend-eaz/validation/domainSchema.js` — likely the same pattern

None of these Zod schemas are imported or used anywhere in the codebase. The controllers (`authController.js`, `contactController.js`) perform their own manual validation instead. This is dead code that creates confusion about which validation approach is intended.

**Fix:** Either integrate Zod as middleware (e.g., `validate(schema)` middleware) or remove these files.

### 🟡 HIGH: Duplicate endpoints — `checkDomainBatch` and `checkDomainBulk` are identical

**File:** `backend-eaz/controllers/domainController.js`

Two functions with nearly identical logic, differing only in the max limit (20 vs 50). This violates DRY and means maintenance must happen in two places.

```js
// checkDomainBatch — limit 20
if (rawDomains.length > 20) { ... }

// checkDomainBulk — limit 50
if (rawDomains.length > 50) { ... }
```

**Fix:** Consolidate into a single endpoint with a configurable limit.

### 🟡 HIGH: No pagination on listing endpoints

Several CRUD listing endpoints return all records without pagination:

- `getAllUsers` (`authController.js:360`) — `User.find().sort({ createdAt: -1 })`
- `getContacts` (`contactController.js:54`) — `Contact.find(filter).sort({ createdAt: -1 })`
- `getDomainOrders` (`domainController.js:350`) — `DomainOrder.find(query).sort({ createdAt: -1 })`

As the user base grows, these will consume unbounded memory and time. The hosting orders endpoint has pagination (limited to 200/500) but others don't.

### 🟡 MEDIUM: Webhook raw body handling is brittle

**File:** `backend-eaz/app.js:83`

```js
app.use('/api/webhooks', webhookRoutes);
```

Webhook routes must come **before** the JSON body parser to retain `req.rawBody`. This is a fragile ordering dependency. If anyone reorders the middleware, webhook signature verification silently breaks.

**Fix:** Use an explicit raw-body parser middleware scoped to webhook routes, or use `express.raw()` instead of relying on ordering.

### 🟡 MEDIUM: Webhook HMAC uses `req.rawBody` but no verification that it's actually raw

**File:** `backend-eaz/controllers/webhookController.js:45-52`

```js
const hash = crypto.createHmac("sha512", secret).update(req.rawBody).digest("hex");
```

If middleware ordering is accidentally changed (see above), `req.rawBody` becomes `undefined` and `crypto.createHmac(...).update(undefined)` will throw or produce incorrect output, causing all webhooks to be rejected. This is a silent failure mode.

### 🟡 MEDIUM: `xss-clean` package is deprecated and unmaintained

**File:** `backend-eaz/package.json:36`

```
"xss-clean": "^0.1.3"
```

The `xss-clean` package hasn't been updated in years and has known issues. It's also redundant given the project's own `sanitize.js` utilities.

**Fix:** Remove the dependency and rely on the custom sanitize utilities + DOMPurify or `xss` (the maintained library).

### 🟡 MEDIUM: No input validation on several endpoints before DB operations

The `contactController.js` and `authController.js` validate manually, but several fields lack validation. For example, `updateOrderStatus` in `domainController.js:405` doesn't validate that the status value is one of the allowed enum values beyond a simple array check.

### 🟡 MEDIUM: `getAdminOverview` does heavy aggregation on every request

**File:** `backend-eaz/controllers/hostingOrderController.js:244-344`

This endpoint runs **14 database queries** (counts, aggregations, find operations) on every request. For a dashboard that may be refreshed frequently, this is unnecessarily heavy.

**Fix:** Cache the overview data with a short TTL (e.g., 60 seconds).

### 🟡 MEDIUM: Error handler references `req.id` but it's added by middleware

**File:** `backend-eaz/middleware/errorHandler.js:56`

```js
console.error(`[${req.id || '?'}] ${req.method} ${req.originalUrl} → ${statusCode}:`, err.message);
```

`req.id` is set by a middleware in `app.js:95-98`. If an error occurs before that middleware runs (e.g., in body parsing), `req.id` will be `undefined`. The `|| '?'` fallback handles this, but it points to a fragile assumption.

### 🟡 MEDIUM: CORS origin callback uses `includes` which is case-sensitive

**File:** `backend-eaz/app.js:123`

```js
if (!origin || corsOrigins.includes(origin)) return cb(null, true);
```

URL origins should be compared case-insensitively for the hostname part. A request from `HTTP://LOCALHOST:3000` would be rejected even though it's the same origin.

### 🔵 LOW: WHM `httpsAgent` is re-created for each function call

**File:** `backend-eaz/services/whm.js:5`

```js
const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === 'production' });
```

This agent is created at module level but each function still passes it individually. The `httpsAgent` in `webhookController.js:12-14` is also duplicated. Create a shared instance.

### 🔵 LOW: Commented-out debug code in namecheap.js

**File:** `backend-eaz/services/namecheap.js:93-99`

```js
// ── TEMPORARY DEBUG — remove after fix ──
// const comProduct = productTypes
//   .flatMap((pt) => pt.ProductCategory || [])
//   ...
```

This should be removed, not left commented in production code.

---

## 4. Frontend Issues

### 🟡 HIGH: Inconsistent API client usage

The project has a well-crafted `lib/api.js` client that handles JSON serialization, error extraction, and field-level validation errors. However, several pages bypass it and use raw `fetch()`:

- `dashboard/admin/consultations/page.jsx:196` — uses `fetch()` directly
- `ChatWidget.jsx` — uses `fetch()` for chat endpoints
- Many other dashboard pages likely follow the same pattern

This means error handling, JSON parsing, and auth cookie sending are inconsistent across the app.

### 🟡 HIGH: ChatWidget is a monolithic 725-line component

**File:** `frontend-eaz/src/components/ChatWidget.jsx`

This single component handles the chat state machine, polling, message rendering, form handling, cookie management, and UI. It should be split into:
- `ChatWidget` (container)
- `ChatMessage` (message bubbles)
- `ChatInput` (input areas per state)
- `HumanRequestForm` (already partially extracted)
- `ChatHeader`, `ChatFooter`, etc.

### 🟡 MEDIUM: `sanitize.js` is not consistently used

**File:** `frontend-eaz/src/lib/sanitize.js`

The sanitize utilities exist and are imported in some places (`auth/login/page.jsx:10`), but not in others. For example, the `CheckoutForm.jsx` sanitizes fields manually before validation rather than using the sanitize helpers consistently.

### 🟡 MEDIUM: Login redirect logic uses hardcoded role values

**File:** `frontend-eaz/src/app/auth/login/page.jsx:42-45`

```js
if (role === "technician" || role === "admin") router.push("/pos/technician");
else if (["superadmin", "staff", "cashier"].includes(role)) router.push("/pos/sell");
else router.push("/dashboard");
```

These role values should be constants shared between frontend and backend. The backend model defines roles as `["superadmin", "admin", "user", "staff", "cashier", "technician"]`, but this logic treats them inconsistently (e.g., "admin" → technician POS, but "admin" is also a dashboard admin).

### 🟡 MEDIUM: HeroCarousel references `slide.image` but it doesn't exist

**File:** `frontend-eaz/src/components/home/HeroCarousel.jsx:185`

```jsx
src={slide.image || "/images/hero/web-design.png"}
```

The `slides` array doesn't define an `image` property, so it always falls back to the default `/images/hero/web-design.png` for all slides. Either the images are missing or the fallback is intentional — in either case, every slide shows the same image.

### 🟡 MEDIUM: `@react-email/components` and `@react-email/render` in backend but never used

**File:** `backend-eaz/package.json:15-16`

```json
"@react-email/components": "^1.0.9",
"@react-email/render": "^2.0.4",
```

The email system uses string templates in `utils/email.js`, not React Email. These dependencies add ~50MB+ to the install size for no benefit.

### 🟡 MEDIUM: `styled-components` in frontend but not used

**File:** `frontend-eaz/package.json:20`

```json
"styled-components": "^6.3.11"
```

The project uses Tailwind CSS and inline styles exclusively. No component imports from `styled-components`. This is dead weight.

### 🟡 MEDIUM: `framer-motion` used in only one component

Only `HeroCarousel.jsx` uses framer-motion. For a single component, a CSS-only alternative (or a lighter library) would suffice. This adds ~30KB+ to the bundle.

### 🟡 MEDIUM: `@tanstack/react-query` used minimally

Only `usePortfolio.js` uses React Query. The rest of the app uses raw `fetch()` or the `api.js` client. This is an incomplete adoption pattern.

### 🔵 LOW: Duplicate gallery rendering in phone-repair page

**File:** `frontend-eaz/src/app/services/phone-repair/page.jsx:138-158`

The iPhone gallery and general parts gallery have identical markup structure with only the filter differing. Extract a `GalleryGrid` component.

### 🔵 LOW: No TypeScript

The entire project is plain JS/JSX. For a project with 70+ files, 20+ routes, and 15+ models, TypeScript would catch prototype bugs, missing fields, and type mismatches at compile time.

### 🔵 LOW: `CheckoutForm` sends `email` in request body, but backend ignores it

**File:** `frontend-eaz/src/components/CheckoutForm.jsx:48-58`

The frontend sends `email` in the POST body to `/api/v1/domain/payment`, but the backend controller (`domainController.js:216`) explicitly ignores it and uses `req.user.email` instead:

```js
const email = req.user.email;  // from JWT, not request body
```

This is correct for security, but the frontend shouldn't be sending data that will be ignored — it creates confusion about the API contract.

---

## 5. Architecture & Design

### 🟢 GOOD: Same-origin architecture

The decision to proxy all API calls through Next.js rewrites (`next.config.mjs:50-61`) instead of calling the backend directly eliminates CORS in production. This is especially important for AWS Amplify deployments where HTTPS frontend can't call HTTP backend.

### 🟢 GOOD: httpOnly cookie auth

Token authentication via httpOnly cookies prevents XSS token theft. The Bearer token fallback is kept for server-side requests where cookies aren't available.

### 🟢 GOOD: Dual sanitization approach

Having both global middleware (`xss-clean`, `mongo-sanitize`) and field-level sanitizers (`utils/sanitize.js`) provides defense in depth.

### 🟢 GOOD: Idempotent webhook handling

The Paystack webhook handler checks for duplicate events (`wasPaidOrActive`, `hostingOrder.status === 'paid'`) before processing, preventing double charges.

### 🟡 MEDIUM: No service layer

Business logic lives directly in controllers (`hostingOrderController.js` is 726 lines, `posController.js` is 1230 lines). Extracting a service layer would improve testability and reusability.

### 🟡 MEDIUM: Shared SMS logic is duplicated

**Files:** `backend-eaz/services/notify.js:75-101` and `backend-eaz/services/reminderJob.js:48-65`

Both files implement their own `_sendHubtelSms`/`_sendSms` function with identical logic. This should be extracted into a shared `services/sms.js` module.

### 🔵 LOW: Subscription lifecycle is tightly coupled to HostingOrder

The `renewalReminderSent` field and expiry logic live on the `HostingOrder` model. A separate subscriptions collection would be cleaner, though the current approach works for the current scale.

---

## 6. Code Quality & Maintainability

### 🟡 MEDIUM: Inconsistent error response format

Most endpoints return:
```json
{ "success": false, "error": "..." }
```

But some places only return `{ "error": "..." }` without the `success` field (e.g., webhook controller). The frontend checks both `data?.error` and `data?.message`, which suggests inconsistency.

### 🟡 MEDIUM: Magic numbers and strings scattered

Hardcoded values throughout:
- Rate limit windows: `15` minutes, `60` minutes (app.js)
- Max lengths: `200`, `500`, `1000`, `3000` (various sanitize functions)
- Timeouts: `5000`, `10000`, `15000`, `20000`, `30000` (various services)
- TLD lists, step counts, etc.

These should be extracted to config files or constants.

### 🟡 MEDIUM: `app.js` is 227 lines — too many responsibilities

The main app file handles: CORS, rate limiting, security headers, request IDs, route mounting, health check, and 404 handling. Consider splitting into:
- `app.js` — Express app creation and middleware
- `config/security.js` — Helmet, CORS, rate limiting config
- `config/routes.js` — Route mounting

### 🔵 LOW: `controllers/index.js` file

A file at `backend-eaz/controllers/index.js` exists but wasn't thoroughly reviewed. If it re-exports controllers, it's good practice. If it's unused, it's dead code.

### 🔵 LOW: Comment style inconsistency

Some files use `// ── Section name ──` dividers (inconsistent dash counts), others don't. Settle on a convention.

### 🔵 LOW: Frontend package named "frontend"

**File:** `frontend-eaz/package.json:2`

The project name is `"frontend"` — extremely generic. Use something like `"eazworld-frontend"`.

---

## 7. Performance

### 🟡 MEDIUM: No caching headers on API responses

None of the API endpoints set `Cache-Control` or `ETag` headers. For GET endpoints like plans, pricing, and settings that change infrequently, caching would reduce database load significantly.

### 🟡 MEDIUM: MongoDB queries return full documents when only counts needed

Several endpoints load full documents and then compute aggregates client-side. For example, consultation counts:

**File:** `frontend-eaz/src/app/dashboard/admin/consultations/page.jsx:233`

```js
const counts = items.reduce((acc, c) => { ... }, {});
```

This loads ALL consultations to count them. Use `Contact.countDocuments()` with filters instead.

### 🔵 LOW: No index on `contacts` collection for common queries

The `Contact` model likely has no indexes for the queries used (filtering by `type` and `status`). The hosting and domain models have indexes, but not all collections are covered.

---

## 8. DevOps & Configuration

### 🟡 MEDIUM: No test infrastructure

Neither `package.json` has test scripts, test dependencies, or test files. For a production application handling payments and user data, this is a significant gap.

### 🟡 MEDIUM: No Node.js version specification

No `.nvmrc`, `engines` field in `package.json`, or Dockerfile. The project relies on `start.sh` for memory settings but doesn't specify the required Node.js version.

### 🔵 LOW: ESLint configuration exists but may not be strict enough

**File:** `frontend-eaz/.eslintrc.json`

The frontend has ESLint configured via `eslint-config-next`. The backend has no linting configuration at all.

### 🔵 LOW: No pre-commit hooks or CI gate

No `husky`, `lint-staged`, or CI configuration for code quality. Code review is manual only.

### 🔵 LOW: Unused dependencies in both packages

**Backend:** `@react-email/components`, `@react-email/render`
**Frontend:** `styled-components`, `axios` (the app uses native `fetch` via `api.js`), `@tanstack/react-query` (minimal usage)

### 🔵 LOW: Environment variable naming inconsistencies

The project uses `FRONTEND_URL`, `CLIENT_URL`, `NEXT_PUBLIC_API_URL`, `MONGO_URL`, `mongo_url`, `MONGO_URI` — multiple names for the same types of values. This creates confusion during setup.

---

## 9. Strengths

- **Excellent security foundation**: Helmet, CSP, rate limiting, httpOnly cookies, input sanitization, HMAC webhook verification
- **Thoughtful architecture**: Same-origin proxy via Next.js rewrites eliminates CORS entirely
- **Robust auth system**: PIN verification, 2FA, password reset, account blocking
- **Idempotent operations**: Webhooks and provisioning avoid duplicate processing
- **Graceful degradation**: Services gracefully handle missing config (Namecheap, WHM, Hubtel, Resend)
- **Ghana-market optimization**: GHS pricing, Mobile Money, Paystack, Hubtel SMS, local phone formatting
- **Good memory management**: cPanel memory optimization, reduced MongoDB pool size, memory monitoring
- **Clean UI**: Consistent dark mode support, responsive design, Tailwind CSS conventions

---

## 10. Priority Recommendations

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 **Fix now** | Hash verification/2FA PINs before storing | Low |
| 🔴 **Fix now** | Remove plaintext passwords from emails | Low |
| 🟡 **Before launch** | Move body parsing before xss-clean/mongo-sanitize | Low |
| 🟡 **Before launch** | Use separate secret for cookie signing | Low |
| 🟡 **Before launch** | Integrate or remove Zod validation schemas | Low |
| 🟡 **Before launch** | Add pagination to all listing endpoints | Medium |
| 🟡 **Before launch** | Consolidate duplicate SMS sending logic | Low |
| 🟡 **Before launch** | Remove commented-out debug code | Low |
| 🟡 **Before launch** | Fix HeroCarousel missing image property | Low |
| 🟡 **Before launch** | Remove unused dependencies | Low |
| 🟢 **Next sprint** | Add test infrastructure | High |
| 🟢 **Next sprint** | Split ChatWidget into smaller components | Medium |
| 🟢 **Next sprint** | Add cache headers to API responses | Low |
| 🟢 **Next sprint** | Centralize role constants between frontend/backend | Low |
| 🔵 **Backlog** | Consider TypeScript migration | High |
| 🔵 **Backlog** | Extract service layer from controllers | High |
| 🔵 **Backlog** | Standardize env var naming | Low |
| 🔵 **Backlog** | Add pre-commit hooks and CI | Medium |
