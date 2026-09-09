# How the EazWorld System Works

Organised by **journey**: what actually happens, step by step, from someone's
first click to the money landing and the goods going out. Reference material
(data models, security, file layout, environment) follows the flows.

Rewritten 2026-09-07 from the code as it stands. The previous version was
written before pre-orders were built out and described stages and rules that no
longer exist — where the code and that text disagreed, the code won.

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

---

## User Roles

There are five types of users:

| Role | What they can do |
|------|-----------------|
| **user** (customer) | Browse shop, buy products, track orders, manage cart |
| **staff** | Run the shop day to day — orders, repair jobs, pre-order stages, counter sales, expenses, customer chats |
| **technician** | Handle device repairs, update repair status |
| **admin** | Full access — manage products, orders, refunds, hosting, domains, staff |
| **superadmin** | Same as admin but can also manage other admins. The "owner" account |

The `superadmin` role automatically passes every permission check — they can do anything an admin can do, and can manage other admin accounts.

---

---

## Before the flows: five things that apply everywhere

**1. Money is stored in pesewas, never in cedis.** GH₵1.00 is stored as the
number `100`. Nothing is ever a decimal, because decimals drift — add GH₵0.10
three times in floating point and you get GH₵0.30000000000000004. Cedis appear
only at the last moment, on screen.

**2. Prices are always worked out on the server.** A phone or a browser can send
anything it likes; the API ignores any price in the request and recomputes it
from the product, the plan table, or the shipping rules. This is tested from the
outside — one test sends `amount: 1` for a real hosting plan and checks the
stored order still carries the full price.

**3. Payment is Paystack**, taking cards and Mobile Money in cedis. Nothing is
ever fulfilled because a *browser* said the payment worked. Paystack calls the
API directly (a "webhook"), the API checks the message really came from Paystack
using a signature, and only then does anything move.

**4. Five kinds of account.** `superadmin` and `admin` see everything;
`staff` run the shop day to day; `technician` works on repairs and is
deliberately blocked from money and customer records; `user` is a customer.

**5. Logging in** sets a cookie the browser can't read from JavaScript, which is
what stops a stolen script from stealing a session.

---

# Part 1 — What a customer does

## Flow 0: Creating an account and signing in

Buying does not need an account (see Flow 1), but tracking your own orders,
hosting and domains does.

1. They register with a name, a password, and **either an email or a phone
   number**.
2. A 6-digit PIN is sent to verify they own it — **by email if they registered
   with an email, by SMS if they registered with a phone**. It expires in 15
   minutes.
3. They enter the PIN and the account is verified.
4. Signing in takes their email/phone and password. If they've turned on
   two-factor, a second PIN is sent and asked for.
5. The server issues a token and stores it in a cookie the browser's JavaScript
   cannot read — so a malicious script on the page cannot steal the session.
   That cookie rides along with every later request.
6. Protected endpoints reject a missing or invalid cookie with a 401. Endpoints
   limited by role check it as well; `superadmin` passes every check.

**Forgotten password:** they request a reset, get a link by email, and set a new
one.

⚠️ **Email verification currently cannot complete.** No transactional email
sends (see the last section), so anyone registering with an email address never
receives a PIN. Registering with a phone number goes by SMS instead and is
unaffected. Worth knowing before anyone tests sign-up.

## Flow 1: Buying something that's in stock

1. They browse the shop and add items to a basket.
2. At checkout they give a name, phone and delivery address. **No account is
   needed** — this is guest checkout, because making people register to spend
   money loses sales.
3. They pick how it reaches them:
   - **In-house delivery** — the shop's own rider
   - **Courier dispatch** — a third-party courier
   - **Bus station pickup** — the parcel goes to a station and the customer
     collects it there
   ...and a speed: standard, same-day, next-day or express.
4. The API works out the delivery fee from the delivery zone, the weight of what
   they bought, and the speed chosen. One file does this and only that file — so
   a price can't quietly differ between two screens.
5. They pay on Paystack, by card or Mobile Money.
6. **Paystack tells the API the payment succeeded.** The API then, in one
   step: marks the order paid, takes the items out of stock, and counts the
   sale.
7. The customer gets a tracking number and a confirmation email.
8. Staff move the order along: **paid → processing → shipped → delivered**. Each
   move can carry a note and a location ("Handed to courier, Accra depot"), and
   the customer sees the whole history.

**If they change their mind:** an admin can refund. The money goes back through
Paystack and the stock returns to the shelf.

## Flow 2: Buying a pre-order — goods that don't exist yet

This is for stock coming from China that hasn't been made, let alone shipped.
The customer pays **in full, up front**, and then waits — sometimes months.

1. A product (or one colour/size of it) is marked as available to pre-order,
   optionally with a limit per customer.
2. The customer buys it exactly like anything else and pays in full.
3. **Nothing leaves stock**, because there is no stock. The line is marked as a
   pre-order and joins a waiting queue.
4. **The order is frozen.** Staff cannot mark it processing, shipped or
   delivered — there are no goods to pack. They can still cancel it, because a
   customer must be able to walk away while their goods are still at sea.
5. Staff record where the goods have got to, as they get there. Five stages:

   | Stage | What the customer reads |
   |---|---|
   | 1 | In production |
   | 2 | At the container warehouse |
   | 3 | Shipped — on its way to Ghana |
   | 4 | Arrived at the port in Ghana |
   | 5 | At our warehouse — preparing your order |

6. Each stage is stamped with the time it was saved and can carry a **message
   for the customer** — "Held at the port, about three more days". That message
   is shown to them. What is never shown: which staff member recorded it, the
   container number, or the supplier.
7. **The customer sees only stages that have actually been recorded.** The road
   ahead is not drawn. (It used to be, and people read five drawn steps as five
   things that had already happened.)
8. When it reaches **"At our warehouse"**, the order **releases itself**: it
   leaves the waiting queue, the customer is emailed that their item has
   arrived, and normal delivery tracking opens up. Everything in Flow 1 from
   step 8 then applies.

**Two rules worth knowing:**
- **Release is blocked until the goods are in Ghana.** Releasing tells a
  customer their item has arrived; doing that while it's on the water would be a
  lie.
- **Releasing doesn't need the item to be in stock**, because a pre-ordered unit
  never was. It arrives *for that customer* and goes straight back out. If the
  container *was* booked into stock first, release takes one off the shelf
  instead. Both are handled.

**Optional: shipping batches.** If one container carries twenty customers'
pre-orders, staff can create a *batch*, attach those orders to it, and move the
batch once — all twenty customers update together. This is an efficiency, never
a requirement. A single pre-order needs no batch at all.

## Flow 3: Checking on an order

Three ways in, all showing the same story:

- The **tracking number** from the confirmation email
- **Order number + phone number**
- The **confirmation link** they landed on after paying

They see the status history, and for a pre-order, the stages recorded so far
with dates and any message staff wrote. Public lookups deliberately hide most of
the order — name and phone are partly masked, and money and item details are
trimmed — because a tracking link can be forwarded.

## Flow 4: Bringing in a device for repair

1. The customer walks in. Staff create a repair job: who they are, what the
   device is, what's wrong with it.
2. The job gets a **private tracking link** the customer can use from home.
3. The job moves through: **received → diagnosing → waiting for parts →
   repairing → ready → collected**. (Or cancelled.)
4. Parts used are recorded against the job and come out of stock.
5. Payment can be taken in pieces — a deposit now, the balance on collection —
   in cash, Mobile Money or by card. **The parts leave stock once**, on the
   first payment, however many payments there are.
6. When it's ready the customer is told, collects, and the job closes.

## Flow 5: Paying a repair bill from home

1. The customer opens their tracking link and sees what's outstanding.
2. They enter their phone number. **It must match the number on the job** —
   that's the only thing standing between a guessed link and someone else's
   repair record.
3. They pay the balance on Paystack. **The amount is worked out from the job**,
   never taken from the request, so a crafted request can't settle a GH₵500
   repair for one pesewa.

## Flow 6: Registering a domain

1. They search for a name. The API asks Namecheap whether it's free and what it
   costs wholesale, converts to cedis using an **admin-editable exchange rate
   and markup**, and shows a price.
2. `.gh` and `.com.gh` are refused before any lookup — those are
   registry-restricted and the shop can't sell them.
3. They pay. On confirmation the API registers the domain with Namecheap and it
   appears under their account.
4. If registration fails after payment, staff can retry it — the money is
   already in, so the order isn't lost.

⚠️ **Registration has never been proven end to end.** The registrar is live but
this path should be tested in Namecheap's sandbox before anyone relies on it.

## Flow 7: Buying hosting

1. They pick a plan. **Only plans the shop can actually deliver are sellable:**
   shared and WordPress are instant; VPS is quote-only and points at an enquiry;
   cloud and email can't be bought at all. This is enforced by the API, not just
   hidden in the storefront — otherwise a stale page could sell a server nobody
   could build.
2. They pay by card, Mobile Money or bank transfer. (Bank transfer means
   uploading proof, which an admin verifies.)
3. Once paid, the API creates the cPanel account automatically through WHM and
   emails the login details.
4. Renewals reprice from the current plan table, not from what the original cost
   — so an old price or a one-off domain fee doesn't get charged again.

## Flow 8: Asking for a consultation or a website

A form: name, email, phone, business, what they need. It's stored, the customer
gets an acknowledgement, and staff get an alert. Staff then work it in the
dashboard. Bigger jobs become **service orders**, which have their own life:
pending → paid → in progress → completed.

## Flow 9: Chatting on the website

1. The chat widget answers using **Claude** — it knows the shop's services,
   prices and past work.
2. If the customer asks for a person, or the bot can't help, the chat is
   **escalated**: the bot stops answering and it waits for a human.
3. Staff see waiting chats in the dashboard, claim one, and reply. The widget
   checks for replies every few seconds.
4. When the chat is closed, the customer is asked to rate it once.

## Flow 10: Leaving a review

Reviews are tied to a **verified purchase** — the API checks the person actually
bought the thing, and that they haven't already reviewed it. Reviews are
approved before they show.

---

# Part 2 — What staff do

## Flow 11: Working the shop orders

The order list is the day's work. It shows what's paid and waiting, and carries
a **count of pre-orders waiting on stock** so nobody has to remember to look.

On one order, staff can: move its status, add a tracking note, change the
delivery address (which recalculates the fee and records the difference), and —
for admins — refund it.

**On a held pre-order** the status buttons and the tracking form are hidden
entirely rather than shown greyed out: there is nothing useful to do until the
goods arrive. Cancel stays available. A **delivered or cancelled** order hides
both too — its history is the finished record.

## Flow 12: Running the repair counter

Create jobs, move them along, add parts, take payments, print receipts. A
technician can update the work but **cannot change money fields** — labour,
diagnosis fee and deposits are read-only to them, so a bill can't be quietly
reduced.

## Flow 13: Selling over the counter

A straight POS sale: scan or search a part, add it, take payment, print a
receipt. Stock comes down as it sells. Each sale gets its own number, and those
numbers stay unique even when two tills ring up at the same instant.

## Flow 14: Recording expenses

Staff record what the shop spends. Who recorded it decides who can see it.

## Flow 15: Provisioning hosting by hand

Some orders don't provision themselves — bank transfers awaiting verification,
or a plan needing manual setup. There's a queue for those, so a paying customer
never sits invisible.

---

# Part 3 — What happens without anyone clicking

## Flow 16: The payment webhook

The most important piece of plumbing in the system.

1. Paystack sends a message saying a payment succeeded.
2. The API **checks the signature** to prove it came from Paystack.
3. It looks up the reference to find what was paid for — a hosting order, a
   domain, a service, a shop order, or a repair balance.
4. It fulfils that one thing.

Two properties matter. **It can't be tricked**: an unsigned or wrongly-signed
message is refused. And **it can't double-fulfil**: if Paystack sends the same
message twice (which it does), the second one changes nothing — the stock only
moves once.

## Flow 17: The scheduled jobs

Four run on the server's schedule, not inside the app: renewal reminders,
uncollected-device reminders, publishing scheduled blog posts, and reconciling
refunds.

They're scheduled **outside** the app on purpose. The hosting idles the app when
nobody's using the site, and an idled app runs no timers — so a quiet night used
to mean reminders never sent, with nothing in the logs to say so.

---

# Part 4 — Things that are true today and worth knowing

**Transactional email has never worked.** The sender address is a test one and
the domain isn't verified, so every "we've emailed the customer" step above
currently writes a log entry and sends nothing. Fixing this is one DNS change
and one config value, and it silently blocks a lot of the flows above.

**Delivery pricing by distance is built but switched off.** It needs billing
enabled on a Google Cloud project and the Routes API turned on.

**Domain registration is unproven end to end** (see Flow 6).

**Payments are one-way for corrections.** Cancelling a paid order does *not*
refund it, and changing a pre-order's quantity doesn't move money either — both
report what's owed and leave the settlement to a human. That's deliberate, but
it means someone has to actually do it.

---

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

---

## Keeping this document honest

Every flow above was read out of the code, not from memory or from the previous
version of this file. `FLOWS.md` at the monorepo root is the same content
without the reference sections.

When a flow changes, change it here too — a document that quietly goes stale is
worse than no document, because people trust it. The last version described a
pre-order journey that no longer existed, and nothing flagged that.

*Last rewritten: September 2026*
