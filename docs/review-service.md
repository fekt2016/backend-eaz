# EazWorld — A Plain-Language Review of the Platform

> Written 2026-08-10. This is a human-readable tour of what EazWorld is, how it works, what it does well, and what deserves attention. It reflects the project as it exists today.

---

## 1. What EazWorld Is

EazWorld is a full-service digital agency website with an online shop bolted on. It is two applications working together:

- **A marketing + e-commerce website** (the frontend) where visitors learn about services, buy hosting, search/register domains, and shop for products.
- **An API server** (the backend) that handles accounts, payments, orders, and the admin side of the business.

It is built for the Ghanaian market: prices are shown in GHS (₵), payments go through Paystack (cards + Mobile Money), and SMS notifications go out via Hubtel.

```
Visitors / Customers
        │
        ▼
Next.js website  ────►  Express API  ────►  MongoDB
 (frontend-eaz)        (backend-eaz)          (database)
        │                    │
        ▼                    ▼
   Google/Ads            Paystack (payments)
        │                    │
        ▼                    ▼
                      Namecheap (domains)
                      cPanel/WHM (hosting)
                      Cloudinary (images)
```

---

## 2. The Two Halves

### Frontend — Next.js 14 website (`frontend-eaz`)

A modern React app with the App Router. It uses Tailwind CSS for styling and serves every page a visitor needs:

- **Marketing pages** — home, about, services, portfolio, blog, reviews, contact, visit us
- **Product pages** — hosting plans, domain search, and a shop with cart + checkout
- **Account pages** — login/register, a user dashboard, and an admin dashboard
- **Tracking** — visitors can look up their repair order or shop order without logging in

The frontend never talks to the backend directly from the browser; it routes API calls through Next.js rewrites, which keeps everything on the same origin and avoids CORS headaches.

### Backend — Express API (`backend-eaz`)

A straightforward Node.js/Express server with MongoDB via Mongoose. It provides:

- **Accounts** — registration with email verification (a 6-digit PIN), login with optional 2FA, password reset, admin controls for users
- **Services** — contacts/consultations, portfolio projects, image uploads, domain search & orders, hosting plans & orders, shop products & orders, delivery zones
- **Payments** — Paystack integration for domains, hosting, and shop orders
- **Webhooks** — Paystack calls back after a payment succeeds; the server verifies it with a signature and marks the order paid
- **Jobs** — scheduled reminders for expiring hosting and uncollected repairs

---

## 3. Services Offered (Customer-Facing)

| Area | What it does |
|------|--------------|
| **Web design & development** | Custom websites — responsive, modern stack |
| **SEO & content marketing** | Search optimisation, content strategy |
| **Paid advertising** | Facebook & Google Ads management |
| **Branding & identity** | Logos, brand guidelines, visual strategy |
| **Social media marketing** | Management, content, audience growth |
| **Email marketing** | Campaigns, automation, newsletters |
| **Phone repair** | Screens, batteries, board-level work, water damage |
| **Web hosting** | cPanel plans — shared, VPS, cloud, WordPress, email |
| **Domain registration** | Search, checkout, registration via Namecheap |
| **Online shop** | Product catalogue, cart, checkout, delivery zones, order tracking |
| **Consultations** | Free 30-minute strategy call booking |

---

## 4. How It Works Under the Hood

- **Logging in.** Accounts use email + password. Verification and 2FA use short PINs sent by email. Login state is kept in a secure, http-only cookie (so browser scripts can't steal the token).
- **Buying a domain.** The visitor searches, the API asks Namecheap for real availability + prices (no hardcoded guesswork), payment goes to Paystack, and when Paystack confirms the payment the order is marked paid.
- **Buying hosting.** Same payment flow, plus an invoice PDF and the ability to upload a bank-transfer receipt as proof of payment.
- **Buying from the shop.** Items go into a cart, checkout collects the details, payment is made, and the customer gets an order reference they can track.
- **Being safe.** The server sets security headers, sanitises incoming data, rate-limits logins and public endpoints, and verifies webhook signatures so nobody can fake a "payment received".

---

## 5. What's Going Well

- **Security is taken seriously.** Helmet headers, rate limiting, input sanitisation, http-only auth cookies, verified webhooks. This is well above the typical small-agency website.
- **Good payment hygiene.** Webhooks check for duplicate events, so a single payment can't be processed twice. Callbacks are validated by signature.
- **Real, live data.** Domain availability and prices come from Namecheap rather than a static price list — customers see truthful numbers.
- **Graceful when integrations are missing.** If Namecheap, WHM, Hubtel, or Resend isn't configured, the app degrades instead of crashing.
- **Thoughtful for the local market.** GHS pricing, Mobile Money, Hubtel SMS, local phone formatting, delivery zones.
- **Clean front-end.** Consistent dark-mode support, responsive design, reusable components.

---

## 6. What Deserves Attention

These are honest concerns, ordered roughly by how much they matter.

### Security

1. **PINs stored in plain text.** The email-verification and 2FA PINs are stored in the database as-is. If the database leaks, attackers can verify accounts or bypass 2FA. They should be stored hashed — you only ever need to *compare*, never read them back.
2. **Passwords sent in plain text email.** When an account is auto-created, the password is emailed to the user. Email is not a secure channel. A "set your password" link is the safer pattern.
3. **Little protection against PIN guessing.** The verification/2FA PIN endpoints have no per-user attempt limits beyond the global one, so a 6-digit code is brute-forceable.

### Reliability & maintainability

4. **No automated tests.** Neither app has a test suite. For a system that moves real money, that's a real gap.
5. **No pagination on some admin lists.** Users, contacts, and domain orders are returned in full. Fine today; a scaling problem later.
6. **Some duplicate logic.** Domain batch/bulk checks are near-identical; the two apps are still separate repositories with no shared code, so things like role names and validation rules can drift out of sync.
7. **Dead weight in dependencies.** A few libraries are installed but barely used (e.g. React Email packages, styled-components, React Query), which bloats installs and builds.

### Housekeeping

8. **Docs are out of date.** The existing review and service docs describe features (blog admin, live chat, a POS system, repairs tracking) that no longer match the code. Anyone reading them today gets the wrong picture.
9. **Generic package name.** The frontend package is just called `"frontend"`.
10. **No pinned Node version** (no `.nvmrc` or `engines` field), so "works on my machine" risk.

---

## 7. Recommended Priorities

| Priority | Action | Why |
|----------|--------|-----|
| **Do now** | Hash the verification/2FA PINs | Cheap fix, closes a real data-leak hole |
| **Do now** | Stop emailing plaintext passwords | Replaces it with a secure reset link |
| **Do now** | Add per-user limits on PIN verification | Blocks brute force |
| **Soon** | Add a basic test suite (auth + payments at least) | Confidence before touching money flows |
| **Soon** | Make both apps one repository (monorepo) | Shared validation, one `npm install`, one history |
| **Soon** | Paginate admin list endpoints | Keeps the dashboard fast as data grows |
| **Soon** | Refresh the docs to match the actual code | Saves the next person (and you) real confusion |
| **Later** | Trim unused dependencies, pin the Node version | Smaller installs, reproducible builds |

---

## 8. Verdict

EazWorld is in good shape for a business website of this size. It has a real security posture, sensible architecture, a clean front-end, and it's genuinely tailored to its market. The gaps are the usual ones for a project that has grown quickly: scattered validation, no tests, duplicated logic, and docs that fell behind the code. None of it is hard to fix — it's mostly discipline, not surgery.
