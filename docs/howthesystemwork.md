# How the EazWorld System Works

A plain-English guide to the entire EazWorld platform.

---

## What is EazWorld?

EazWorld is a **Ghana-based digital agency** that does five things:

1. **Builds websites** for clients (web design, SEO, branding)
2. **Sells products online** (phone accessories, parts, gadgets)
3. **Registers domains and sells hosting** (via Namecheap registrar)
4. **Repairs phones and devices** (in-store POS system)
5. **Runs a blog and portfolio** to showcase their work

Everything runs on one platform — customers browse, buy, and track everything from a single website.

---

## The Two Apps

The system is split into two separate applications that talk to each other:

### Backend (the API server)

- Lives in `backend-eaz/`
- Built with **Node.js + Express** (plain JavaScript, no TypeScript)
- Stores data in **MongoDB** (a database)
- Runs on port 5000
- Every URL starts with `/api/v1/` (e.g. `/api/v1/products`, `/api/v1/orders`)
- This is the "brain" — it handles all the logic, data, and security

### Frontend (the website people see)

- Lives in `frontend-eaz/`
- Built with **Next.js 14** (React framework)
- Styled with **Tailwind CSS**
- Runs on port 3000
- This is the "face" — what customers and staff interact with in their browser

**How they talk:** When you click something on the website, the frontend sends a request to `/api/v1/...` which Next.js forwards to the backend server. The backend processes it and sends back a response.

---

## How Money Works

**Everything is stored in pesewas (the smallest unit of Ghana Cedis).**

- GH₵1.00 = 100 pesewas
- A product priced at GH₵25.00 is stored as `2500` in the database
- Money is only divided by 100 at the very last moment when showing it to a person
- This avoids floating-point rounding errors that would give customers wrong totals

---

## User Roles

There are five types of users:

| Role | What they can do |
|------|-----------------|
| **user** (customer) | Browse shop, buy products, track orders, manage cart |
| **staff** | Handle customer chats, view orders (read-only), front desk duties |
| **technician** | Handle device repairs, update repair status |
| **admin** | Full access — manage products, orders, refunds, hosting, domains, staff |
| **superadmin** | Same as admin but can also manage other admins. The "owner" account |

The `superadmin` role automatically passes every permission check — they can do anything an admin can do, and can manage other admin accounts.

---

## Authentication (How Login Works)

1. **Register:** Customer signs up with name, email, phone, and password
2. **Verify:** They receive a PIN code via email and enter it to verify their account
3. **Login:** They enter email + password. If they have 2FA enabled, they also enter a second PIN
4. **Session:** The server creates a **JWT token** (a short encrypted string) and saves it as an HTTP-only cookie called `token` in the browser. This cookie is sent with every request to prove "yes, I'm logged in"
5. **Protected routes:** Any API route with the `protect` middleware checks this cookie. If it's missing or invalid, the request is rejected with a 401 error
6. **Role-based access:** Some routes use `restrictTo('admin', 'staff')` to limit who can access them. The `superadmin` role passes all of these checks automatically

---

## The Shop & E-commerce System

### Products

Products live in the **Product** model. Each product has:
- A name, slug (URL-friendly ID), description, price (in pesewas)
- Images (uploaded to Cloudinary)
- A category and stock count
- Optional **variants** — e.g. a phone case might come in "Black" and "Blue", each with its own SKU, price, stock, and images
- A `status` field: `active` (visible in shop), `draft` (hidden), or `archived`

### How Shopping Works

1. **Browse:** Customer visits `/shop` — the frontend fetches all active products from the API
2. **Add to cart:** When they click "Add to Cart", the item goes into the **CartContext** (React state). If they're logged in, the cart is also saved to the database. If they're a guest, it's saved in the browser's localStorage
3. **Cart persistence:** The cart is synced to the backend every time it changes (for logged-in users). On login, any localStorage items are merged into the database cart. On logout, localStorage is cleared
4. **Checkout:** Customer fills in their details (name, phone, address) and clicks Pay
5. **Payment:** The frontend calls the backend to initialize a Paystack payment. Paystack opens a popup where the customer enters their card or Mobile Money details
6. **Confirmation:** After payment, Paystack sends a webhook to the backend. The backend verifies the signature, marks the order as "paid", deducts stock, and sends a confirmation email
7. **Order tracking:** The customer gets an order number and can track their order at `/track-order`

### Shipping

When the customer enters their delivery address, the system:
1. Looks up which **shipping zone** the address falls into
2. Checks which **shipping tier** the product belongs to (by weight)
3. Calculates the shipping fee
4. Shows the total (products + shipping) before payment

Shipping can be done in two ways:
- **In-house delivery** — EazWorld's own riders
- **Courier dispatch** — third-party courier service

### Stock Management

- Stock is deducted when an order is paid
- If an order is cancelled, stock is restored
- **Preorders** are items the customer buys before they're in stock — they pay now, but stock isn't deducted until the item arrives and staff "releases" it
- The system tracks whether stock was deducted/restored to prevent double-restocking

---

## Hosting & Domain Registration

### Hosting Plans

EazWorld sells web hosting on a VPS (Virtual Private Server) managed through WHM (Web Host Manager). Plans include:

- **Shared hosting** (Deluxe, Premium, Business, Enterprise)
- **VPS hosting** (Starter, Pro, Business, Enterprise)
- **Cloud hosting** (various tiers)
- **WordPress hosting** (managed WordPress)
- **Email hosting** (standalone email)

Prices are stored in USD and converted to GH₵ using a configurable exchange rate. Annual billing gives 2 months free (charged as 10 months).

### How Hosting Orders Work

1. Customer picks a hosting plan and billing cycle (monthly/annual)
2. They pay via Paystack
3. The backend creates a **HostingOrder** record
4. A provisioning job runs automatically and:
   - Creates a cPanel account on the VPS via the WHM API
   - Sets up the hosting package
   - Sends the customer their hosting credentials via email

### Domain Registration

Domains are registered through **Namecheap** (a domain registrar). The flow:

1. Customer searches for a domain (e.g. `mybusiness.com`)
2. The backend queries Namecheap's API to check availability
3. Domain pricing is defined in `config/domainPricing.js` (USD prices converted to GH₵ with a markup)
4. Customer pays for the domain + hosting together
5. The backend registers the domain with Namecheap and sets EazWorld's nameservers

**Note:** `.gh` and `.com.gh` domains cannot be registered through us — they are registry-restricted by ghNIC and listed as unsupported. `.africa` is available again since the move to Namecheap.

---

## Device Repair Tracking

EazWorld runs an in-store repair shop. Here's how it works:

### POS (Point of Sale) System

Staff use a dedicated POS interface at `/dashboard/pos` to:
- Create repair jobs for customers
- Track repair status (received → diagnosed → in-progress → completed → picked-up)
- Process payments for repairs
- Manage parts inventory
- Look up customers by phone number

### Customer Repair Tracking

1. When a repair job is created, the customer gets a **tracking token** (a unique URL)
2. They can visit `/track/{token}` to see the current status of their repair
3. They don't need to log in — the token is their proof of identity
4. Staff update the status as the repair progresses, and the customer sees it in real-time

---

## Live Chat System

EazWorld has a real-time chat system where customers can talk to staff.

### How It Works

1. **Customer initiates chat:** A customer opens the chat widget (bottom-right corner) and types a message. This creates a **ChatSession** with the customer's message
2. **Bot mode:** Initially, the chat is in "bot mode" — the customer's messages are just logged
3. **Requesting a human:** The customer can click "Talk to a human" which sends a request
4. **Staff picks it up:** Staff members see the pending request in their chat console (`/dashboard/chats`). They click "Accept" to claim the conversation
5. **Live conversation:** Staff and customer can now exchange messages in real-time (polled every few seconds)
6. **Resolve:** When the conversation is done, the staff member clicks "Resolve" to end the chat
7. **Rating:** After the chat ends, the customer can rate their experience (1-5 stars)

### Staff Chat Console

- Staff see all **open** (unresolved) chats
- Admins can also see **resolved** chats (for quality review)
- Multiple chats can be open at once — each one opens in a separate draggable modal
- Staff can claim, reply to, and resolve chats
- Only admins can **reopen** a resolved chat or **delete** a chat record

### Roles in Chat

| Role | Can see chats | Can reply | Can resolve | Can reopen | Can delete |
|------|:---:|:---:|:---:|:---:|:---:|
| Staff | Yes (open only) | Yes | Yes | No | No |
| Admin | Yes (all) | Yes | Yes | Yes | Yes |
| Superadmin | Yes (all) | Yes | Yes | Yes | Yes |

---

## The Dashboard

The dashboard (`/dashboard`) is the staff/admin control center. Different roles see different things:

### Customer Dashboard
- Order history
- Hosting management
- Domain management
- Settings (profile, password)

### Staff Dashboard
- Chat console
- Order viewing
- Repair tracking

### Admin/Superadmin Dashboard
Everything above, plus:
- Product management (add/edit/delete products)
- Order management (update status, process refunds)
- Commerce settings (shipping zones, delivery charges)
- Hosting management (create accounts, manage plans)
- Domain management
- User management
- Sales reports and analytics
- Activity logs (who did what)
- Notifications
- Settings

### POS (Point of Sale) Dashboard
A separate interface for the physical store:
- Sell products in person
- Create repair jobs
- Process payments (card, cash, MoMo)
- View daily/weekly/monthly sales reports
- Manage customers
- Manage parts inventory

---

## Payments (Paystack)

All online payments go through **Paystack**, a payment processor popular in Ghana.

### How Payment Works

1. **Initialize:** Frontend sends the order total to the backend
2. **Backend calls Paystack:** Creates a payment session and gets back an authorization URL
3. **Customer pays:** A Paystack popup opens in the browser. The customer enters their card details or selects Mobile Money
4. **Webhook:** After payment succeeds, Paystack sends a POST request to `/api/webhooks/paystack` with a cryptographic signature
5. **Verify:** The backend verifies the signature (to make sure it's really Paystack), then:
   - Marks the order as "paid"
   - Deducts product stock
   - Sends a confirmation email
   - Creates an activity log entry

### Refunds

Admins can process full or partial refunds through Paystack. The system:
- Records the refund status on the order
- Sends a refund request to Paystack
- Restores stock if it was a full refund
- Logs the refund in the activity log

---

## Data Models (What Gets Stored)

Here's a simplified list of all the data the system manages:

| Model | What it stores |
|-------|---------------|
| **User** | Customer and staff accounts (name, email, phone, password, role, 2FA) |
| **Product** | Shop items (name, price, stock, images, variants) |
| **Part** | Repair parts (similar to products but for the repair shop) |
| **Order** | Customer purchases (items, total, shipping, payment status, tracking) |
| **Cart** | A logged-in user's shopping cart (items, quantities) |
| **HostingOrder** | Hosting plan purchases (plan type, billing cycle, provisioning status) |
| **DomainOrder** | Domain registration purchases (domain name, registrar status) |
| **RepairOrder** | Device repair jobs (device, fault, status, cost) |
| **RepairJob** | Individual repair tasks within a repair order |
| **Sale** | POS in-person sales (items, payment method, amount) |
| **PosPayment** | Payments made through the POS system |
| **PosCustomer** | In-store customer records |
| **ChatSession** | Live chat conversations (messages, status, agent assignment) |
| **Post** | Blog posts (title, content, categories, publish date) |
| **Project** | Portfolio items (client work showcases) |
| **Review** | Customer testimonials (name, rating, comment) |
| **ProductReview** | Product-specific reviews |
| **ServiceOrder** | Service requests (web design, SEO, etc.) |
| **Contact** | Contact form submissions |
| **Notification** | System notifications for staff |
| **Shipment** | Incoming product shipments (for preorders) |
| **ShippingZone** | Geographic delivery zones |
| **ShippingTier** | Weight-based shipping price tiers |
| **DeliveryZone** | Legacy delivery zones (being replaced by ShippingZone) |
| **ActivityLog** | Audit trail of admin/staff actions |
| **EmailLog** | Record of all emails sent by the system |
| **Expense** | Business expenses tracking |
| **Supplier** | Supplier records |
| **Counter** | Auto-incrementing counters (for order numbers, etc.) |
| **Settings** | System-wide settings (business profile, etc.) |

---

## Security

The system has multiple layers of security:

1. **Helmet:** Sets HTTP security headers (CSP, HSTS, etc.)
2. **XSS protection:** `xss-clean` strips malicious scripts from user input
3. **NoSQL injection prevention:** `express-mongo-sanitize` strips `$` and `.` from request data
4. **HTTP Parameter Pollution:** `hpp` prevents duplicate query parameters
5. **Rate limiting:** Different endpoints have different rate limits (e.g. login: 10 attempts per 15 minutes, chat: 60 messages per 15 minutes)
6. **CORS:** Only allows requests from approved domains
7. **JWT tokens:** Stored as HTTP-only cookies (can't be accessed by JavaScript)
8. **Password hashing:** Passwords are hashed with bcrypt before storage
9. **Input validation:** Zod schemas validate user input on key endpoints
10. **Webhook verification:** Paystack webhooks are verified with HMAC signatures

---

## File Structure at a Glance

```
eazworld/
├── backend-eaz/              # The API server
│   ├── server.js             # Starts the server, connects to MongoDB
│   ├── app.js                # Express app — security, routes, error handling
│   ├── models/               # 35 data models (User, Product, Order, etc.)
│   ├── controllers/          # Business logic for each feature
│   ├── routes/               # URL → controller mappings
│   ├── middleware/            # Auth (protect, restrictTo), error handler
│   ├── services/             # External integrations (Namecheap, WHM, email)
│   ├── utils/                # Helper functions (email, money, provisioning)
│   ├── config/               # Plans, pricing, Cloudinary setup
│   └── tests/                # Automated tests (Jest + in-memory MongoDB)
│
└── frontend-eaz/             # The website
    └── src/
        ├── app/              # Pages (35 routes — shop, dashboard, auth, etc.)
        ├── components/       # Reusable UI components
        ├── context/          # Global state (Auth, Cart, Theme)
        ├── hooks/            # Custom React hooks
        ├── lib/              # Utilities (API client, roles, formatting)
        └── middleware.js     # Redirects unauthenticated users, maintenance mode
```

---

## Environment Variables

The backend needs these key environment variables:

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Database connection string |
| `JWT_SECRET` | Secret key for signing login tokens |
| `JWT_EXPIRES_IN` | How long a login session lasts (e.g. "7d") |
| `PAYSTACK_SECRET` | Paystack payment API key |
| `NAMECHEAP_API_USER` | Domain registrar API username |
| `NAMECHEAP_API_KEY` | Domain registrar API key |
| `NAMECHEAP_CLIENT_IP` | Whitelisted IP for registrar API calls |
| `CLOUDINARY_API_KEY` | Image hosting API key |
| `RESEND_API_KEY` | Transactional email service |
| `FRONTEND_URL` | The website URL (for CORS and links) |
| `USD_TO_GHS_RATE` | Exchange rate for hosting/domain pricing |

---

## How a Typical Customer Journey Works

1. **Ama visits eazworld.co** → sees the homepage with services, testimonials, recent products
2. **She browses the shop** → sees phone cases, cables, accessories with prices in GH₵
3. **She adds items to cart** → cart saves to her browser (localStorage) and to the database (if logged in)
4. **She goes to checkout** → enters her name, phone, and delivery address in Accra
5. **She sees the total** → product prices + shipping fee calculated for her area
6. **She pays with Mobile Money** → Paystack popup opens, she enters her MoMo number
7. **Payment succeeds** → Paystack notifies the backend, order is created, stock is deducted
8. **She gets a confirmation email** → with her order number and estimated delivery
9. **She can track her order** → at `/track-order` using her order number
10. **Meanwhile, admin sees the order** → in the dashboard, processes it, ships it, adds tracking number
11. **She gets shipping updates** → email with tracking number, can follow the package

---

*Last updated: August 2026*
