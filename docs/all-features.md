# EazWorld — All Features

**EazWorld is a Ghana-based online business platform.** It lets customers shop for products,
register domains, buy web hosting, and hire the agency for digital services (web design, SEO,
ads, branding) — while the team runs the whole business from one dashboard, including an
in-store phone-repair shop (POS).

A complete map of what the platform does, grouped by area, follows below.

---

## 1. Accounts & Authentication
- User registration, login, logout (JWT in httpOnly cookie)
- Email verification (`/auth/verify`)
- Two-factor authentication (2FA) login (`/auth/verify-2fa`)
- Forgot / reset password (`/auth/forgot-password`, `/auth/reset-password/[token]`)
- Role-based access — customer vs. admin (`protect` / `restrictTo`)
- Backend: `authController`, `authRoutes`, `User` model

## 2. Online Shop (E-commerce)
- Product catalog with categories (`/shop`, `/shop/category/[category]`, `/shop/[slug]`)
- Shopping cart (`/cart`) and checkout (`/checkout`)
- Order placement, confirmation, and payment success pages
- Delivery zones (region-based delivery pricing)
- Backend: `productController`, `orderController`, `deliveryZoneController`; models `Product`, `Order`, `DeliveryZone`

## 3. Order Tracking
- Track by order reference / tracking number (`/track-order`, `/track/order/[trackingNumber]`)
- Track repair job by token (`/track/[token]`)
- Order confirmation pages (`/order-confirmation/[reference]`)
- Backend: `trackRoutes`

## 4. Domain Registration
- Domain search, pricing, and registration (`/domains`, `/domains/checkout`)
- Customer domain dashboard (`/dashboard/domains`)
- Admin domain-orders management (`/dashboard/(admin)/domain-orders`)
- Backend: `domainController`, `DomainOrder` model; **Namecheap** integration

## 5. Web Hosting
- Hosting plans and checkout (`/hosting`, `/hosting/checkout`)
- Bank-transfer payment flow (`/hosting/bank-transfer/[orderId]`)
- Order confirmation and customer hosting dashboard (`/dashboard/hosting`, `/dashboard/hosting/[orderId]`)
- Admin hosting-orders management (`/dashboard/(admin)/hosting-orders`)
- Backend: `hostingOrderController`, `HostingOrder` model; **WHM** & **CyberPanel** provisioning

## 6. Digital Agency Services
- Marketing/landing pages: Web Design, SEO, Paid Ads, Branding, Social Media, Email, Phone Repair (`/services/*`)
- Dynamic per-service detail route (`/services/[slug]`)
- Service order intake — `serviceOrderController`, `serviceOrderRoutes`, `ServiceOrder` model

## 7. Consultations
- Public booking (`/book-consultation`)
- Admin consultations management (`/dashboard/(admin)/consultations`)

## 8. POS — In-Store Device Repair
- POS dashboard (`/dashboard/pos`, `/dashboard/pos/dashboard`)
- Repair jobs: list, create, detail (`/dashboard/pos/jobs`, `/jobs/new`, `/jobs/[id]`)
- Point-of-sale selling (`/dashboard/pos/sell`) and POS orders (`/dashboard/pos/orders`)
- Suppliers & parts (`/dashboard/pos/suppliers`, `/suppliers/[id]`)
- Expenses tracking (`/dashboard/pos/expenses`)
- Warranty management (`/dashboard/pos/warranty`)
- Reports (`/dashboard/pos/reports`)
- Customer-facing repair pages (`/repair`, `/dashboard/repairs`)
- SMS status notifications (**Hubtel**) + uncollected-device reminder job
- Thermal receipt printing (`lib/printReceipt.js`)
- Backend: `posController`; models `RepairJob`, `RepairOrder`, `Part`, `PartOrder`, `PosCustomer`, `PosPayment`, `Sale`, `Supplier`, `Expense`

## 9. Payments
- **Paystack** — card + Mobile Money (GH₵)
- Signed webhook verification + idempotent fulfilment (`webhookController`, `webhookRoutes`)
- Bank-transfer flow for hosting orders

## 10. Content — Blog & Portfolio
- Blog with posts and detail pages (`/blog`, `/blog/[slug]`)
- Admin blog management (`/dashboard/(admin)/blog`)
- Portfolio / project showcase (`/portfolio`, `/portfolio/[slug]`)
- Backend: `postController` (`Post`), `projectController` (`Project`)

## 11. Reviews
- Public reviews page (`/reviews`)
- Admin reviews moderation (`/dashboard/(admin)/reviews`)
- Backend: `reviewController`, `Review` model

## 12. Contact & Chat
- Contact form (`/contact`) — `contactController`, `Contact` model
- Live chat / admin chats (`/dashboard/(admin)/chats`) — `chatController`, `ChatSession` model

## 13. Admin Dashboard
- Users management (`/dashboard/(admin)/users`)
- Email logs (`/dashboard/(admin)/emails`, `EmailLog` model)
- Domain orders, hosting orders, consultations, reviews, blog, chats (see above)
- Commerce management: products (CRUD), inventory, orders, delivery zones
  (`/dashboard/commerce/*`)
- Site settings (`/dashboard/settings`) — `settingsController`, `Settings` model

## 14. Customer Dashboard
- My orders (`/dashboard/orders`, `/dashboard/orders/[id]`)
- My domains, my hosting, my repairs
- Account settings

## 15. Media & Uploads
- Server-mediated image upload via **Cloudinary** (`uploadController`, `uploadRoutes`)

## 16. Transactional Email
- **Resend** for order/hosting/domain/auth emails — hand-written HTML templates in
  `utils/email.js`, not a React renderer; logged via `EmailLog`

## 17. Site Infrastructure Features
- Maintenance mode gate + JWT verification in `middleware.js`
- Static/legal pages: About, Contact, Privacy, Terms, Resources, Visit Us, SEO landing
- Dark mode (Tailwind `class` strategy) and theming (`ThemeContext`)
- Security middleware: helmet + CSP, xss-clean, mongo-sanitize, hpp, rate-limiting, CORS

---

## Backend at a glance

**Routes:** admin, auth, chat, contact, deliveryZone, domain, hostingOrder, order, pos, post,
product, project, review, serviceOrder, settings, track, upload, webhook

**Models:** User, Product, Order, DeliveryZone, DomainOrder, HostingOrder, ServiceOrder,
Project, Post, Review, Contact, ChatSession, Settings, EmailLog, RepairJob, RepairOrder, Part,
PartOrder, PosCustomer, PosPayment, Sale, Supplier, Expense

**Integration services** (`backend-eaz/services/`): Namecheap (domains), WHM & CyberPanel
(hosting), Hubtel `notify` (SMS) + `reminderJob`. Plus Paystack (payments), Cloudinary (uploads),
Resend (email) wired elsewhere.
