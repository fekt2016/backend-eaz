# EazWorld — Who Can Do What (User Roles Explained)

This guide explains, in plain English, the different kinds of accounts on EazWorld,
what each one is allowed to do, and where each person ends up when they log in.

If you're setting up an account for a new team member, this tells you which role to give them.

---

## The big picture

EazWorld has **two sides**:

1. **The public side** — the shop, blog, domain/hosting pages, booking a consultation. Anyone can use this,
   even without an account.
2. **The staff side** — the dashboard at `/dashboard`, where the business is actually run: taking repairs,
   ringing up sales, managing products, replying to customers, and so on.


A person's **role** is like the set of keys they carry. It decides which doors open for them on the staff side.
Everyone with an account can shop; only certain roles can walk into the back office, and even then they can
only open the rooms their keys allow.

There are **five roles**. Four of them are for your team; one (`user`) is just a normal customer.

---

## The five roles, in one line each

| Role           | Think of them as…                          | What they mainly do                                  |
|----------------|--------------------------------------------|------------------------------------------------------|
| **Superadmin** | The owner with the master key              | Everything. No door is locked to them.               |
| **Admin**      | The manager                                | Runs the website, shop, customers, and staff records. |
| **Staff**      | The shop team — supervisor **and** front desk | Runs the day-to-day shop: repairs, front-desk sales, stock, money. |
| **Technician** | The repair person at the workbench         | Fixes devices and updates repair jobs.               |
| **Customer** (`user`) | A member of the public with an account | Shops, tracks orders, manages their own account.     |

---

## Each role, explained properly

### 👑 Superadmin — the owner
This is **you** (or whoever runs the business). A superadmin can do **absolutely everything** — there is no
screen or action anywhere in the system that's off-limits. They're the only ones who can do the most sensitive
things: **cancelling (voiding) a completed sale, adding or editing suppliers, recording business expenses,
deleting stock items, and creating new staff accounts.**

Give this role to as few people as possible — ideally just the owner.

---

### 🧑‍💼 Admin — the business manager
An admin runs the **business and website side** of EazWorld. They can:

- Manage the **online shop** — products, orders, inventory, and delivery zones.
- Handle **customers and enquiries** — contact messages, live-chat conversations, and reviews.
- Manage **content** — blog posts and the portfolio.
- Oversee **services** — domain orders, hosting orders (including suspending or terminating hosting).
- Manage **people** — create user accounts, block/unblock them, and reset passwords.
- Flip the site into **maintenance mode**.

On the repair-shop (POS) side, an admin has more of an **oversight** role than a hands-on one. They can look at
the **reports/dashboard**, manage **stock**, view **suppliers**, and chase up **uncollected repairs**. But by
design they **don't take money at the counter** — they can't record a payment, run a Mobile Money charge, view
day-to-day expenses, or handle warranty claims. Those belong to the shop floor.

---

### 🛠️ Staff — the shop team (supervisor **and** front desk)
Staff **run the repair shop day to day** — and they also handle the **front desk**, so this one role covers both
supervising the shop and serving/selling to walk-in customers. They can do almost everything in the shop:

- **Sell** products and ring up sales (the front-desk / till job).
- Manage **repair jobs** from start to finish — create them, update them, add photos, and remove photos.
- **Take payments** and run **Mobile Money** charges.
- Manage **customers**.
- Add and edit **stock** (but not delete it).
- View **suppliers**, **expenses**, **warranty** claims, and **reports**.

What staff **can't** do is the sensitive owner-level stuff: they can't **cancel a completed sale**, **add or
edit suppliers**, **record expenses**, **delete stock**, or **create staff accounts**. They also have **no
access to the website/business side** (no shop-product management, no user management, no blog).

---

### 🔧 Technician — the workbench
A technician is the person **actually repairing devices**. Their whole world is the **repair jobs** assigned to
them:

- View, create, and update **repair jobs**.
- Add **photos** of the device.
- Scan and look up **parts/stock** (read-only).

They **don't handle money at all** — no payments, no Mobile Money, no cancelling sales — and they can't touch
stock levels, suppliers, expenses, or reports. Their screen is a simple top-bar with just their **Jobs**, plus
a **Settings** link (for their profile, password, two-factor, and light/dark theme) and Sign out.

---

### 🛒 Customer (`user`) — the public
This is the **default** role everyone gets when they sign up. A customer is just that — a member of the public
with an account. They can:

- Browse and buy from the **shop**, and pay with card or Mobile Money.
- **Track their orders** and book consultations.
- Leave **reviews**.
- Manage **their own account** — name, password, two-factor security, and light/dark theme.

They have **no access to the back office**. If a customer tries to open a staff page, the system quietly sends
them back to their own dashboard.

---

## The repair shop, side by side

Here's exactly who can do what inside the repair shop (POS). ✅ = yes, ❌ = no.
(Superadmin is ✅ on everything, so they're the baseline.)

| In the repair shop, can they…        | Admin | Staff | Technician |
|--------------------------------------|:-----:|:-----:|:----------:|
| See the dashboard & reports          |   ✅  |   ❌   |    ❌      |
| Scan a barcode / look something up   |   ✅  |   ✅   |    ❌      |
| Add & edit customers                 |   ✅  |   ✅²  |    ❌ |
| Create & update repair jobs          |   ✅  |   ✅   |    ✅ | 
| Add photos to a job                  |   ✅  |   ✅   |    ✅ |
| Delete a job photo                   |   ❌  |   ✅   |    ❌ |
| Take a payment on a job              |   ✅  |   ✅   |    ❌ |
| Take a Mobile Money payment          |   ✅  |   ✅   |    ❌ |
| Ring up a sale                       |   ❌  |   ✅   |    ❌ |
| **Cancel (void) a sale**             |   ❌  |   ❌   |    ❌ |
| Look up stock                        |   ✅  |   ✅   |    ❌|
| Add / edit stock                     |   ✅  |   ❌   |    ❌ |
| Delete stock                         |   ✅  |   ❌   |    ❌ |
| See suppliers                        |   ✅  |   ❌   |    ❌ |
| Add / edit / delete suppliers        |   ❌  |   ❌   |    ❌ |
| See expenses                         |   ✅¹ |   ✅¹  |    ❌ |
| Record an expense                    |   ✅  |   ✅   |    ❌ |
| Edit / delete an expense             |   ✅  |   ❌   |    ❌ |
| See jobs waiting to be collected     |   ✅  |   ✅   |    ❌ |
| Send collection reminders            |   ✅  |   ✅   |    ❌ |
| Track warranty claims                |   ✅  |   ❌   |    ❌ |
| Create staff accounts                |   ✅  |   ❌   |    ❌ |    

> Rows ❌ for **everyone** (cancel a voidable sale, add/edit/delete suppliers) are the **owner-only**
> powers — only a **superadmin** can do them. Admin **can** create staff accounts, edit customers,
> take payments and record an expense (backstopping the till); the one row where admin *loses* to
> staff is "delete a job photo" (deliberate, T83 — admin owns the audit trail).

---

## The website & business side

These are **admin-and-owner only**. Staff, technicians, and customers can't touch them:

- The **online shop** — products, orders, delivery zones.
- **Customers & enquiries** — contact messages, live chat, reviews.
- **Content** — blog posts, portfolio projects.
- **Services** — domain orders, hosting orders (suspend/terminate).
- **People** — user accounts, blocking, password resets.
- **Email logs** and **site settings** (maintenance mode).

---

## Where everyone lands after logging in

The system drops each person at the most useful starting page for their job:

| When this role logs in…            | They land on…                        |
|------------------------------------|--------------------------------------|
| Staff or Superadmin                | the **Sell** screen (ready to serve) |
| Technician or Admin                | the **repair-jobs / POS home**       |
| Customer                           | their own **dashboard**              |

---

## Good to know

A few things worth being aware of:

0. **Expenses are scoped to who recorded them** (T113, 2026-08-29). ¹ Everyone above can record
   spending, but the list each person sees differs: **staff see only their own**, **admin see
   their own plus every staff member's**, **superadmin see everything**. The totals and the
   category summary are scoped the same way, so a figure never covers rows you cannot open.
   Editing and deleting stay with admin and superadmin — and only within what they can see, so an
   admin cannot revise a superadmin's expense.

0. **Staff are the counter; admin manages** (T83/T105, 2026-08-29/09-01). Reports, suppliers and
   warranty tracking are superadmin + admin only — staff no longer see them in the sidebar *or*
   reach them directly. Staff keep their own scoped dashboard ("My dashboard"), sales, repair jobs
   and payments. Warranty also *gained* admin, who had been excluded despite this table saying
   otherwise. **Side effect worth knowing:** the supplier dropdown when adding or editing stock
   now comes back empty for staff, so staff can add stock but cannot attach a supplier to it.

1. **Technician separation is now enforced, not just hidden** (T83/T105, 2026-08-29/09-01). Sales,
   stock lookup, barcode scanning and the customer list used to be reachable by a technician who
   went straight to the address, even though the menu hid them. They now return "no permission" —
   as does "jobs waiting to be collected", since collection follow-up is counter staff work, not
   bench work. Ringing up a sale is the till's job — **superadmin and staff only; admin cannot**.
   That rule is enforced inside `createSale` as well as on the route, so it holds even if the
   routing changes.

2. **Customers, payments and staff accounts — clarified 2026-09-01 (T105):**
   - ² **Staff create customers, admin edits.** Job intake silently creates a walk-in customer
     when booking a repair, so staff keep that write; existing records are admin's to change.
   - **Admin does take money at the counter.** T83 had left that open; confirmed now — admin
     records job payments, takes MoMo/card charges and records expenses, backstopping the till.
     Admin still *cannot ring up a retail sale* (that stays superadmin + staff).
   - **Reminders:** both admin and staff may send collection reminders (the till follows up on
     devices ready for collection).
   - **Staff accounts:** admin may create staff accounts, not just superadmin.

3. **Theme is per-device, not per-person.** Choosing dark or light mode is remembered on that browser/computer,
   not saved to the account — so it won't follow someone from the shop tablet to their phone.

---

<sub>

### For developers — where these rules live

Keep this document in sync when any of these change:

- **Role list:** `backend-eaz/models/User.js` (`role` enum)
- **Who's allowed on each API route:** `backend-eaz/routes/*.js` via `restrictTo(...)` in `middleware/auth.js`
  (note: **superadmin implicitly passes every check**, and `restrictTo('admin')` also allows superadmin)
- **Repair-shop (POS) permissions:** `backend-eaz/routes/posRoutes.js`
- **Which pages a role can open:** `frontend-eaz/src/middleware.js`
- **What shows in the menu:** `frontend-eaz/src/app/dashboard/dashboardNav.js`, `Sidebar.jsx`, `pos/PosShell.jsx`
- **Where each role lands after login:** `frontend-eaz/src/app/auth/login/page.jsx`

</sub>
</content>
