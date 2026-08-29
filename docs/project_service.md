# EazWorld — Service Inventory

> All services, features, API endpoints, and integrations available in the EazWorld platform.

---

## 1. Customer-Facing Services (Frontend Pages)

These are the public-facing service pages a visitor can browse and purchase.

| # | Service | Frontend Route | Description |
|---|---------|---------------|-------------|
| 1 | **Web Design & Development** | `/services/web-design` | Custom websites & web apps — responsive design, modern stack |
| 2 | **SEO & Content Marketing** | `/services/seo` | Search engine optimisation, content strategy, Google ranking |
| 3 | **Paid Advertising** | `/services/paid-ads` | Facebook & Google Ads campaign management |
| 4 | **Branding & Identity** | `/services/branding` | Logo design, brand identity, visual strategy |
| 5 | **Social Media Marketing** | `/services/social-media` | Social media management, content creation, audience growth |
| 6 | **Email Marketing** | `/services/email` | Campaigns, automation, newsletter management |
| 7 | **Phone Repair** | `/services/phone-repair` | In-store phone repair — screens, batteries, board-level, water damage |
| 8 | **Web Hosting** | `/hosting` | cPanel hosting plans (shared, VPS, cloud, WordPress, email) |
| 9 | **Domain Registration** | `/domains` | Domain search, checkout, registration via Namecheap |
| 10 | **Book a Consultation** | `/book-consultation` | Free 30-minute strategy consultation |
| 11 | **Portfolio** | `/portfolio` | Case studies of past projects |
| 12 | **Blog** | `/blog` | Content marketing articles |
| 13 | **Contact** | `/contact` | General contact form |

---

## 2. Backend API Services

### 2.1 Authentication — `POST /api/v1/auth`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/register` | POST | Public | Create new account (sends 6-digit PIN for email verification) |
| `/verify-pin` | POST | Public | Verify email with PIN code |
| `/resend-pin` | POST | Public | Resend verification PIN |
| `/login` | POST | Public | Log in with email + password (supports 2FA flow) |
| `/2fa/verify` | POST | Public | Verify 2FA PIN during login |
| `/logout` | POST | Any | Clear auth cookie |
| `/forgot-password` | POST | Public | Send password reset email |
| `/reset-password/:token` | PATCH | Public | Reset password with token |
| `/me` | GET | Any | Get current user profile |
| `/me` | PATCH | Any | Update profile (name, phone) |
| `/change-password` | PATCH | Any | Change own password |
| `/2fa/enable` | POST | Any | Enable 2FA (sends confirmation PIN) |
| `/2fa/confirm` | POST | Any | Confirm 2FA enable with PIN |
| `/2fa/disable` | POST | Any | Disable 2FA (requires password) |
| `/users` | GET | Admin | List all users |
| `/users/:id` | PATCH | Admin | Update any user |
| `/users/:id/block` | PATCH | Admin | Block/unblock a user |
| `/users/:id/password` | PATCH | Admin | Change any user's password |

### 2.2 Contacts / Consultations — `POST /api/v1/contacts`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | POST | Public | Submit contact/consultation form |
| `/` | GET | Admin | List all contacts (filter by type/status) |
| `/:id` | GET | Admin | Get single contact |
| `/:id` | PATCH | Admin | Update status / admin note |
| `/:id` | DELETE | Admin | Delete contact |

### 2.3 Projects / Portfolio — `POST /api/v1/projects`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | Public | List portfolio projects |
| `/:id` | GET | Public | Get single project |
| `/` | POST | Admin | Create project |
| `/:id` | PUT | Admin | Update project |
| `/:id` | DELETE | Admin | Delete project |

### 2.4 File Uploads — `POST /api/v1/uploads`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | POST | Admin | Upload image to Cloudinary |

### 2.5 Domain Services — `POST /api/v1/domain`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/check` | GET | Public | Check single domain availability |
| `/check/batch` | POST | Public | Batch check domains (max 20) |
| `/check-bulk` | POST | Public | Bulk check domains (max 50) |
| `/search` | GET | Public | Search domain with TLD suggestions |
| `/suggest` | GET | Public | Suggest domain names based on query |
| `/payment` | POST | Any | Initialize domain payment via Paystack |
| `/orders` | GET | Any | List domain orders (own or all for admin) |
| `/orders/:id` | GET | Any | Get single domain order |
| `/orders/:id/status` | PATCH | Admin | Update domain order status |

### 2.6 Hosting Services — `POST /api/v1/hosting`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/plans` | GET | Public | List all hosting plans with pricing |
| `/orders` | POST | Any | Create hosting order (with Paystack or bank transfer) |
| `/orders` | GET | Any | List orders (own or all for admin, with search) |
| `/orders/admin-overview` | GET | Admin | Dashboard stats: revenue, counts, recent orders |
| `/orders/admin-summary` | GET | Admin | Lightweight status counts |
| `/orders/by-reference/:ref` | GET | Any | Get order by Paystack reference |
| `/orders/:id` | GET | Any | Get single order |
| `/orders/:id/invoice` | GET | Any | Download invoice PDF |
| `/orders/:id/proof` | POST | Any | Upload bank transfer proof |
| `/orders/:id/renew` | POST | Any | Create renewal payment |
| `/orders/:id/cpanel-login` | GET | Any | Get cPanel SSO login URL |
| `/orders/:id` | PATCH | Admin | Update order status (mark paid, cancel, etc.) |
| `/orders/:id` | DELETE | Admin | Delete order |

### 2.7 Admin — `POST /api/v1/admin`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/email-logs` | GET | Admin | View email delivery logs with filtering + pagination |

### 2.8 Reviews — `POST /api/v1/reviews`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | POST | Public | Submit a client review |
| `/` | GET | Public | Get approved reviews |
| `/all` | GET | Admin | List all reviews (pending + approved) |
| `/:id/approve` | PATCH | Admin | Approve/reject review |
| `/:id` | DELETE | Admin | Delete review |

### 2.9 Blog — `POST /api/v1/posts`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | Public | List published posts |
| `/:slug` | GET | Public | Get single post by slug |
| `/admin/all` | GET | Admin | List all posts (including drafts) |
| `/admin/:id` | GET | Admin | Get post by ID |
| `/` | POST | Admin | Create blog post |
| `/:id` | PATCH | Admin | Update blog post |
| `/:id` | DELETE | Admin | Delete blog post |

### 2.10 Chat — `POST /api/v1/chat`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | POST | Public | Send message (triggers bot or stores for live support) |
| `/sessions` | GET | Admin | List all chat sessions |
| `/sessions/:sessionId` | GET | Admin | Get session details |
| `/sessions/:sessionId/messages` | GET | Public | Get messages (widget polling) |
| `/sessions/:sessionId` | PATCH | Admin | Update session (resolve, etc.) |
| `/sessions/:sessionId` | DELETE | Admin | Delete session |
| `/sessions/:sessionId/accept` | POST | Admin | Accept chat (goes live) |
| `/sessions/:sessionId/reply` | POST | Admin | Send admin reply |

### 2.11 Settings — `POST /api/v1/settings`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | Public | Get site settings (maintenance mode status) |
| `/` | PATCH | Admin | Update site settings (toggle maintenance mode, etc.) |

### 2.12 Service Orders — `POST /api/v1/services`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/payment` | POST | Public | Initialize payment for a service (e.g. web design deposit) |
| `/orders` | GET | Admin | List all service orders |
| `/orders/:id` | PATCH | Admin | Update service order status |

### 2.13 POS — `POST /api/v1/pos`

All POS endpoints require authentication + POS role (`superadmin`, `admin`, `staff`, `cashier`, `technician`).

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| **Overview** | | | |
| `/overview` | GET | Staff+ | POS dashboard stats (daily sales, top parts, etc.) |
| **Scanner** | | | |
| `/scan/:code` | GET | All POS | Barcode lookup — find part or customer by code |
| **Customers** | | | |
| `/customers` | GET | All POS | List/search POS customers (paginated) |
| `/customers` | POST | All POS | Create customer (dedup by phone) |
| `/customers/:id` | GET | All POS | Get customer |
| `/customers/:id` | PATCH | All POS | Update customer |
| **Repair Jobs** | | | |
| `/jobs` | GET | All POS | List jobs with filters (status, date range, search) |
| `/jobs` | POST | All POS | Create repair job |
| `/jobs/:id` | GET | All POS | Get job details |
| `/jobs/:id` | PATCH | All POS | Update job (status, parts used, notes) |
| `/jobs/:id/photos` | POST | All POS | Upload job photo (multipart) |
| `/jobs/:id/photos/:photoId` | DELETE | Staff+ | Delete job photo |
| `/jobs/:id/payments` | POST | Staff+ | Add payment to a job |
| `/jobs/:id/momo-charge` | POST | Staff+ | Initiate Mobile Money charge via Paystack |
| `/jobs/:id/momo-charge/:ref` | GET | Staff+ | Check Mobile Money charge status |
| **Sales** | | | |
| `/sales` | GET | All POS | List sales |
| `/sales` | POST | All POS | Create sale |
| `/sales/:id` | GET | All POS | Get sale |
| `/sales/:id/void` | PATCH | Superadmin | Void a sale |
| **Inventory (Parts)** | | | |
| `/inventory` | GET | All POS | List parts inventory |
| `/inventory` | POST | Staff+ | Create part |
| `/inventory/:id` | PATCH | Staff+ | Update part |
| `/inventory/:id` | DELETE | Superadmin | Delete part |
| **Suppliers** | | | |
| `/suppliers` | GET | Staff+ | List suppliers |
| `/suppliers/:id` | GET | Staff+ | Get supplier |
| `/suppliers` | POST | Superadmin | Create supplier |
| `/suppliers/:id` | PATCH | Superadmin | Update supplier |
| `/suppliers/:id` | DELETE | Superadmin | Delete supplier |
| **Expenses** | | | |
| `/expenses` | GET | Staff+ | List expenses |
| `/expenses` | POST | Superadmin | Create expense |
| `/expenses/:id` | PATCH | Superadmin | Update expense |
| `/expenses/:id` | DELETE | Superadmin | Delete expense |
| **Reminders** | | | |
| `/reminders/uncollected` | GET | Admin+ | List uncollected repair jobs |
| `/reminders/trigger` | POST | Admin+ | Manually trigger reminder SMS |
| **Warranty** | | | |
| `/warranty` | GET | Staff+ | List jobs under warranty |
| **Staff** | | | |
| `/staff` | GET | Superadmin | List staff accounts |
| `/staff` | POST | Superadmin | Create staff account |

### 2.14 Repair Tracking (Public) — `GET /api/v1/track`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/:token` | GET | Public | Get repair job status by tracking token (no auth required) |

### 2.15 Webhooks — `POST /api/webhooks`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/paystack` | POST | HMAC | Paystack payment webhook (handles hosting, domain, and service payments) |

---

## 3. Scheduled Jobs (Cron)

| Job | Schedule | Description |
|-----|----------|-------------|
| **Renewal Reminder** | Every 24h | Sends renewal reminder emails at 30d, 7d, and 1d before hosting expiry. Suspends cPanel accounts past expiry. |
| **Uncollected Device Reminder** | Every 12h | Sends SMS reminders for repair jobs marked "ready" but uncollected after 3 days. Max 3 reminders per job. |

---

## 4. Dashboard & Admin Pages (Frontend)

| Page | Route | Description |
|------|-------|-------------|
| **User Dashboard** | `/dashboard` | User's orders, hosting, domains overview |
| **Dashboard Settings** | `/dashboard/settings` | Update profile, change password, 2FA settings |
| **Hosting Detail** | `/dashboard/hosting/:orderId` | View/renew a specific hosting order |
| **Admin Overview** | `/dashboard/admin` | Full admin dashboard with revenue stats, order counts |
| **Admin — Consultations** | `/dashboard/admin/consultations` | Manage consultation bookings (status, notes, reply) |
| **Admin — Reviews** | `/dashboard/admin/reviews` | Approve/reject client reviews |
| **Admin — Blog** | `/dashboard/admin/blog` | CRUD blog posts |
| **Admin — Chats** | `/dashboard/admin/chats` | View and respond to live chat sessions |
| **Admin — Emails** | `/dashboard/admin/emails` | View email delivery logs |
| **Admin — Domains** | `/dashboard/admin/domains` | Manage domain orders |
| **Admin — Hosting** | `/dashboard/admin/hosting` | Manage hosting orders, approve bank transfers |
| **Admin — Users** | `/dashboard/admin/users` | Manage user accounts, block/change roles |

---

## 5. POS Sub-Services (Frontend)

| Page | Route | Description |
|------|-------|-------------|
| **POS Dashboard** | `/pos/dashboard` | Daily overview, sales targets, top parts |
| **POS Sell** | `/pos/sell` | Point-of-sale checkout interface |
| **POS Customers** | `/pos/customers` | Customer directory (search, view, edit) |
| **POS Customer Detail** | `/pos/customers/:id` | Single customer profile with job history |
| **POS Inventory** | `/pos/inventory` | Parts inventory management |
| **POS Suppliers** | `/pos/suppliers` | Supplier directory |
| **POS Supplier Detail** | `/pos/suppliers/:id` | Single supplier with part history |
| **POS Expenses** | `/pos/expenses` | Business expense tracking |
| **POS Jobs** | `/pos/jobs` | Repair jobs queue/list (filtered by status) |
| **POS New Job** | `/pos/jobs/new` | Create repair job |
| **POS Job Detail** | `/pos/jobs/:id` | Job management (status, parts, photos, payments) |
| **POS Technician** | `/pos/technician` | Technician view — assigned jobs |
| **POS Staff** | `/pos/staff` | Staff account management |
| **POS Reports** | `/pos/reports` | Sales and business reports |
| **POS Warranty** | `/pos/warranty` | Jobs under warranty tracking |

---

## 6. Third-Party Integrations

| Integration | Purpose | Configuration |
|-------------|---------|---------------|
| **Paystack** | Payment processing (cards, Mobile Money) | `PAYSTACK_SECRET` / `PAYSTACK_KEY` |
| **Namecheap** | Domain search, pricing, registration, nameserver updates | `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_CLIENT_IP` |
| **WHM / cPanel** | Hosting account creation, AutoSSL, suspension, SSO | `WHM_HOST`, `WHM_TOKEN`, `WHM_USER` |
| **Resend** | Transactional email (welcome, receipts, reminders) | `RESEND_API_KEY` |
| **Hubtel** | SMS notifications for repair job status changes | `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `HUBTEL_SENDER_ID` |
| **Cloudinary** | File/image uploads (hosting proofs, job photos) | `CLOUDINARY_URL` |

---

## 7. Hosting Plan Tiers

| Plan Type | Tiers Available |
|-----------|-----------------|
| **Shared** | Deluxe ($9/mo), Professional ($16/mo), Enterprise ($32/mo), Ultimate ($62/mo) |
| **VPS** | Starter ($280/mo), Business ($550/mo), Pro ($950/mo) |
| **Cloud** | Starter ($420/mo), Business ($850/mo), Enterprise (custom pricing) |
| **WordPress** | Starter ($45/mo), Business ($95/mo), Agency ($185/mo) |
| **Email** | Starter ($25/mo), Business ($55/mo), Enterprise ($120/mo) |

---

## 8. Supporting Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | Landing page with hero carousel, stats, services, featured work |
| About | `/about` | Company info and team |
| Reviews | `/reviews` | Client testimonials |
| Visit Us | `/visit-us` | Office location and directions |
| Resources | `/resources` | Free tools and resources |
| SEO (standalone) | `/seo` | SEO-specific landing page |
| Payment Success | `/payment-success` | Post-payment callback page |
| Track Repair | `/track/:token` | Public repair tracking (no login needed) |
| Maintenance | `/maintenance` | Shown when maintenance mode is active |
| Privacy | `/privacy` | Privacy policy |
| Terms | `/terms` | Terms of service |
| Not Found | 404 | Custom 404 page |
