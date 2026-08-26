const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Post = require("../models/Post");
const { logDbTarget } = require("../utils/dbTarget");

// Resolved lazily inside seed() so this module can be imported by tests/other
// seeders without touching .env or the process. Mirrors src/seedEcommerce.js.
const resolveDbUrl = () => {
  const mongoUrlRaw =
    process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!mongoUrlRaw) {
    throw new Error("MONGO_URL is not defined in environment variables");
  }
  const dbPassword =
    process.env.DATABASE_PASSWORD || process.env.database_password;
  return mongoUrlRaw.includes("<PASSWORD>") && dbPassword
    ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
    : mongoUrlRaw;
};

// -------------------------------------------------------------------------
// Q4 2026 editorial calendar — 12 posts, drafted with Claude.
//
// All posts are seeded with `published: false` on purpose: several carry
// illustrative GH cedi price ranges that must be confirmed against real
// EazWorld rates first, and two need a manual fill-in before publishing:
//   - case-study-toloba-sport-consult : add a live site link + optional quote
//   - best-budget-smartphones-ghana   : replace [ADD YOUR PICK] with real /shop products
//
// `content` uses only the syntax the blog renderer (components/blog/
// BlogArticle.jsx) supports: "## ", "### ", "- ", "1. ", **bold**, [text](url).
// `category` values match the Post model enum exactly.
// -------------------------------------------------------------------------
const POSTS = [
  {
    title: "How Much Does a Business Website Cost in Ghana? (2026 Guide)",
    slug: "business-website-cost-ghana",
    excerpt:
      "A transparent 2026 breakdown of what a business website really costs in Ghana — design, domain, hosting, and Mobile Money payments — with honest cedi price ranges.",
    category: "Web Design",
    readTime: "7 min read",
    content: `If you've asked three different agencies what a website costs, you've probably gotten three wildly different answers — and no clear reason why. It's one of the most confusing purchases a Ghanaian business owner can make.

This guide breaks down the **real cost of a business website in Ghana in 2026**: what you're actually paying for, honest cedi price ranges, and the recurring costs nobody warns you about. No jargon, no hidden extras.

## The short answer

For most small and medium businesses in Ghana, a professional website costs somewhere between **GH₵2,500 and GH₵15,000** to build, plus roughly **GH₵400 to GH₵1,200 per year** to keep it running.

That's a wide range, so let's break down what moves the number.

## What you're actually paying for

A website isn't one thing you buy — it's four things bundled together. Understanding the pieces is how you avoid overpaying.

### 1. The domain name (your web address)

Your domain is your address on the internet — like yourbusiness.com or yourbusiness.com.gh.

- **.com domains:** around **GH₵150 to GH₵250 per year**
- **.com.gh (Ghana) domains:** typically **GH₵250 to GH₵450 per year**

This is a small, recurring cost — you renew it every year to keep the name yours. A .com.gh signals you're a local business, while a .com reads as more international. Many businesses register both and point them to the same site. We register .com and the other international extensions directly — [check availability and live pricing here](/domains) — while .com.gh comes from a ghNIC-accredited registrar, since it needs proof of Ghanaian business registration. Either way we'll connect it to your site.

### 2. Web hosting (where your site lives)

Hosting is the space on a server where your website's files live so people can visit them 24/7. Think of it as rent for your shop's physical space — except online.

- **Shared hosting** (fine for most business sites): **GH₵300 to GH₵800 per year**
- **Higher-traffic or online-store hosting:** **GH₵1,000+ per year**

Cheap hosting from overseas often means a slow site for Ghanaian visitors. Hosting tuned for your audience keeps pages loading fast on local networks. [See our hosting plans](/hosting).

### 3. Design and development (the actual website)

This is the biggest and most variable cost, because "a website" can mean very different things:

- **Starter / one-page site** — a single professional page covering who you are, what you do, and how to reach you. **GH₵2,500 to GH₵4,500**
- **Standard business site** — 5 to 8 pages: About, Services, Gallery, Contact form. **GH₵4,500 to GH₵9,000**
- **Online store** — product catalogue, cart, and Mobile Money + card checkout. **GH₵9,000 to GH₵20,000+**
- **Custom / booking platform** — bookings, customer accounts, dashboards, integrations. **GH₵15,000+**

What pushes the price up: number of pages, custom design versus a template, online payments, and features like bookings or customer logins.

### 4. Payments (if you sell online)

If you want to take money on your site, you'll need a payment gateway. In Ghana that usually means accepting both **Mobile Money (MTN, Telecel, AirtelTigo)** and cards. There's rarely a big upfront fee — instead you pay a small percentage per transaction. Budget for that as a cost of sales, not a setup cost.

## The costs people forget

The build price gets all the attention, but these recurring costs are what actually keep your site alive:

- **Domain renewal** — every year, or you lose the name
- **Hosting renewal** — every year
- **SSL certificate** — the padlock in the browser (often free, sometimes bundled)
- **Maintenance and updates** — security patches, content changes, fixing things that break
- **Content** — good photos and text; the difference between a site that converts and one that just exists

A realistic annual "keep it running" budget for a small business site is **GH₵400 to GH₵1,200**, more if you want ongoing support.

## Why quotes vary so much

Three reasons a quote can be triple another:

1. **Template versus custom design.** A template is faster and cheaper; a custom design is built around your brand.
2. **Who's building it.** A freelancer, an agency, and a "cousin who does IT" price very differently — and support after launch differs even more.
3. **What's included.** Cheaper quotes often exclude hosting, content, revisions, or post-launch support, so the real cost shows up later.

The cheapest quote is rarely the cheapest website. Ask what happens after launch — that's where the difference lives.

## How to budget smartly

- **Start with what you need now, not everything you might want.** A clean 5-page site you launch this month beats a "perfect" site that never ships.
- **Separate one-time from recurring costs** so renewals don't surprise you.
- **Own your domain and hosting yourself.** Make sure they're registered in your name — not locked inside an agency's account.
- **Plan for content.** Budget time or money for real photos and clear copy.

## What EazWorld offers

At EazWorld, we handle the whole thing in one place — **domain registration, hosting, design, and Mobile Money + card payments** — so you're not juggling four vendors. Everything stays in your name, hosting is tuned for Ghanaian visitors, and you get real support after launch, not just at the sale.

Not sure which option fits your business or your budget? [Book a free consultation](/book-consultation) and we'll give you an honest recommendation — even if that means starting small.

Ready to move? [Browse our web design services](/services) or [check domain availability](/domains) to get started today.`,
  },

  {
    title:
      "Cracked Phone Screen in Ghana? Repair Cost, Time & What to Expect (2026)",
    slug: "phone-screen-repair-ghana",
    excerpt:
      "Cracked or unresponsive phone screen? Here's what screen repair really costs in Ghana in 2026, how long it takes, and how to avoid the common repair scams.",
    category: "Phone Repair",
    readTime: "6 min read",
    content: `A cracked screen is the worst kind of phone problem — it happens in a second, and suddenly you can't tell whether you need a GH₵150 fix or a GH₵1,500 one. Worse, walk into the wrong shop and you'll get a cheap panel that fails in a month.

This guide gives you the straight answer: what **phone screen repair actually costs in Ghana in 2026**, how long it takes, how to spot a bad repair before you pay, and when a screen isn't worth fixing at all.

## First: is it the glass or the whole screen?

Not all "cracked screens" are the same, and this is where most overcharging happens.

- **Cracked glass only** — the display still shows a clear picture and touch still works. Sometimes only the outer glass needs replacing (cheaper).
- **Damaged display (LCD/OLED)** — you see black patches, lines, colour bleeding, or a dead area. The whole screen assembly has to be replaced.
- **Touch not responding** — the picture is fine but taps don't register. This is a digitiser fault and usually means a full assembly swap.

A trustworthy technician will tell you which one you have **before** quoting. If someone quotes a full-assembly price for a hairline glass crack, ask questions.

## What screen repair costs in Ghana (2026)

Prices depend far more on your **phone model** than on the shop. As a rough guide:

- **Budget Android (Tecno, Infinix, itel, entry Samsung):** **GH₵120 to GH₵350**
- **Mid-range Android (Samsung A-series, Redmi, higher Tecno/Infinix):** **GH₵300 to GH₵700**
- **Flagship Android (Samsung S/Note, Pixel):** **GH₵700 to GH₵2,000+**
- **iPhone (older, up to iPhone 11):** **GH₵400 to GH₵900**
- **iPhone (12 and newer):** **GH₵900 to GH₵3,000+**

Why iPhones and flagships cost more: they use OLED displays that are expensive to source, and the part is often the whole cost of the repair.

## Original vs. copy screens — the part that really matters

This is the single biggest thing that changes your price and your experience:

- **Original (OEM) screens** cost more but match your phone's brightness, colour, and touch feel, and last.
- **Copy (aftermarket) screens** are cheaper but can be dimmer, less responsive, and more likely to fail. Some don't support features like True Tone or high refresh rates.

Neither is "wrong" — a copy screen on a 4-year-old budget phone can make sense. But you deserve to know **which one you're paying for.** Always ask, and always ask what happens if it fails.

## How long does it take?

For most common models, a screen replacement takes **30 minutes to 2 hours** once the correct part is in stock. If your model's screen has to be ordered, allow **1 to 3 days**. Anyone promising a flagship or newer iPhone screen "in 10 minutes" is either very well-stocked or cutting corners — ask which.

## How to avoid a bad repair

A few minutes of checking saves you a repeat repair:

1. **Get the diagnosis in writing** — glass only, or full assembly, and original or copy.
2. **Ask for a warranty.** A shop confident in its parts will stand behind them. No warranty is a red flag.
3. **Don't leave your phone unlocked with your PIN** unless it's genuinely needed for testing.
4. **Back up your data first** if the phone still powers on — repairs occasionally go wrong.
5. **Test before you pay:** brightness, touch across the whole screen, front camera, and the earpiece.

## When a screen isn't worth repairing

Sometimes replacement is the smarter spend. Think twice if:

- The repair costs more than half of a same-model replacement, **and** the phone is 4+ years old.
- There's also water damage, a swollen battery, or a failing charging port — costs stack up fast.
- The phone no longer receives security updates.

An honest technician will tell you when repair doesn't make financial sense — and that honesty is exactly who you want to deal with.

## Getting your screen fixed with EazWorld

At EazWorld we diagnose the problem first, tell you clearly whether it's glass or a full assembly, and quote you **before** any work starts. You choose original or aftermarket, we back the repair with a warranty, and every job comes with a tracking link so you always know its status.

- **[Book a repair in 2 minutes](/repair)** — tell us your device and the fault, and we'll take it from there.
- **[Track an existing repair](/track)** — check your job's status any time.
- **[Visit our shop](/visit-us)** — prefer to come in? Here's where to find us.

Cracked screen today? [Book your repair now](/repair) and stop squinting through the cracks.`,
  },

  {
    title: "How to Register a .com.gh Domain in Ghana (Step-by-Step, 2026)",
    slug: "register-com-gh-domain-ghana",
    excerpt:
      "A plain-English guide to registering a .com.gh domain for your Ghanaian business in 2026 — what it costs, what documents you need, and where to register it.",
    category: "Web Design",
    readTime: "6 min read",
    content: `Your domain name is the first thing customers type, the address on your business card, and the name on your email. For a Ghanaian business, a **.com.gh** domain says one thing clearly: we're a real, local company.

This guide walks you through exactly how to register a .com.gh domain in 2026 — what it is, what it costs, what you need to have ready, and where to go to get one.

**One thing up front, because it saves you a wasted search:** .com.gh is not sold by the international registrars most people know. It's administered locally by ghNIC and requires proof that your business is registered in Ghana, so you register it through a ghNIC-accredited registrar rather than through EazWorld or a global provider. We register [.com, .net, .org and the other international extensions](/domains) directly, and we'll happily connect a .com.gh you already own to your hosting and email.

## What is a .com.gh domain?

**.com.gh** is Ghana's commercial domain extension — the local equivalent of a global **.com**, reserved for businesses operating in Ghana. The part after the dot (**.gh**, **.com**, **.africa**) is called the extension, or TLD.

You'll usually see three options for a business:

- **.com.gh** — the standard choice for a Ghanaian company. Local, trusted, clearly a business.
- **.gh** — a shorter national domain; availability and rules can be stricter.
- **.com** — the global default. Great reach, but far more names are already taken.

Many businesses register both .com.gh and .com and point them to the same website, so no one can grab the other version of their name.

## Why .com.gh is worth it for a Ghanaian business

- **Instant local trust.** Customers recognise .com.gh as a Ghanaian business, not an anonymous overseas site.
- **Better availability.** The exact name you want is far more likely to be free on .com.gh than on .com.
- **Local SEO signal.** A Ghana domain reinforces to search engines that you serve a Ghanaian audience.
- **It protects your brand.** Registering your name stops a competitor — or a squatter — from taking it first.

## What you need before you start

Have these ready before you approach a registrar:

1. **Your preferred name** — plus two or three backups in case the first is taken.
2. **Proof that your business is registered in Ghana** — usually your Registrar-General certificate of incorporation or business registration. This is the step that catches people out: unlike .com, a .com.gh is only issued to a registered Ghanaian entity.
3. **Contact details** — business name, a phone number, and an email address (this becomes your official domain contact).
4. **Payment** — Mobile Money or a card, depending on what your registrar accepts.

You do **not** need a website ready yet. You can secure the name first and build the site afterwards.

## How much does a .com.gh domain cost?

Domains are billed **per year**, and the price depends on the extension:

- **.com.gh** — typically **GH₵250 to GH₵450 per year**, charged by the accredited registrar you use
- **.com** — **[live pricing on our domain search](/domains)**, renewed yearly

Two things worth knowing: the domain is separate from **hosting** (the space your website lives in), and you renew the domain every year to keep the name yours. Set a reminder, or let your provider auto-renew, so you never lose it.

## How to register your .com.gh domain (step by step)

1. **Pick your name and check it.** Decide on the name — your business name is usually the right answer — and have two or three backups ready.
2. **Choose a ghNIC-accredited registrar.** .com.gh is administered locally, so it has to come from a registrar accredited for it. A search for "ghNIC accredited registrar" will show the current list; the accreditation is what matters, not the size of the company.
3. **Send your business documents.** Your certificate of registration, plus the contact details that will sit on the domain record.
4. **Pay the yearly fee.** Once it clears, the domain is registered to you.
5. **Point it to your website.** When your site is ready, connect the domain to your [hosting](/hosting) — this part we're glad to do for you, whoever you registered with.

**Make sure the domain is registered in your business's name, not your registrar's or your web designer's.** It's the single most expensive mistake in this whole process to undo.

## What EazWorld does — and doesn't — handle

Being straight with you is cheaper for both of us than a checkout that fails:

- **We register** .com, .net, .org, .io, .store and the other international extensions, with live cedi pricing and Mobile Money or card payment — [search here](/domains).
- **We don't register** .com.gh, .gh or .africa. Those need local accreditation we don't hold, so we'd rather point you to someone who does than take your money and stall.
- **We do connect** any domain you own — including a .com.gh — to EazWorld hosting, business email, and the site we build for you. Bring the login and we'll handle the DNS.

## Common mistakes to avoid

- **Choosing a name that's hard to say or spell.** If you have to spell it out over the phone, it's too complicated.
- **Letting someone else register it in their name.** Always make sure the domain is registered to **you or your business** — not an agency's personal account. If you ever switch providers, you'll be glad you did.
- **Forgetting to renew.** An expired domain can be snapped up by someone else. Turn on auto-renew.
- **Registering only one extension.** If your brand matters, grab both .com.gh and .com so no one copies you.

## Get your name online with EazWorld

Whether your address ends in .com.gh or .com, the part that actually wins customers is what's behind it. That's our job: hosting, business email, and a site built for Ghanaian buyers — with Mobile Money at the checkout.

- **[Search your domain now](/domains)** — live cedi pricing on .com, .net, .org and more, registered in **your** name.
- **[See hosting plans](/hosting)** — pair your domain with fast, local-tuned hosting.
- **[Book a free consultation](/book-consultation)** — not sure which name or setup fits your business? Let's talk it through.

Ready to claim your name before someone else does? [Start your domain search](/domains).`,
  },

  {
    title: "Web Hosting in Ghana: What a Small Business Actually Needs (2026)",
    slug: "web-hosting-ghana-small-business",
    excerpt:
      "Confused by hosting jargon? Here's a plain-English guide to what web hosting is, what a small Ghanaian business actually needs in 2026, and how to pick a plan without overpaying.",
    category: "Web Design",
    readTime: "7 min read",
    content: `Hosting is where most people get stuck when building their first website. The plans all list the same intimidating words — SSD, bandwidth, cPanel, SSL — and it's never clear which ones actually matter for a normal business.

Here's the honest version. This guide explains what web hosting really is, what a small Ghanaian business **actually** needs in 2026, and how to choose a plan without paying for power you'll never use.

## What is web hosting, really?

Your website is a set of files. Those files have to live on a computer that's switched on 24/7 so anyone can visit them at any time. That always-on computer is a **server**, and renting space on it is **web hosting**.

A simple way to picture it:

- **Your domain** (like yourbusiness.com.gh) is your address.
- **Your hosting** is the shop the address points to.
- **Your website** is everything inside the shop.

You need all three. The domain and the hosting are usually billed separately, and both renew each year.

## The hosting words that actually matter

Ignore the marketing. For a small business, these are the only terms worth understanding:

- **Storage (SSD/NVMe):** how much space your files, images, and emails take up. Most business sites use very little. **NVMe SSD** just means fast, modern storage — good.
- **Bandwidth:** how much traffic your site can serve each month. Unless you're running viral campaigns, a standard allowance is plenty.
- **Email accounts:** whether you get professional email at your own domain (like info@yourbusiness.com.gh). Yes, you want this.
- **SSL certificate:** the padlock in the browser that makes your site "https" and secure. Non-negotiable in 2026 — and it should be free.
- **Backups:** automatic copies of your site so nothing is lost if something breaks.
- **Uptime & support:** how reliably your site stays online, and whether someone answers when you need help.

If a plan covers those well, the rest is mostly noise.

## Why local-tuned hosting matters in Ghana

The cheapest hosting is often a server far overseas. The problem: every time a Ghanaian visitor loads your site, the data travels a long way — so pages feel slow, especially on mobile data.

Hosting tuned for your audience, with speed technology like **LiteSpeed**, keeps pages loading fast on local networks. A fast site isn't a luxury — visitors leave slow pages, and search engines rank them lower.

## How much hosting does a small business need?

Most owners massively overestimate this. Match your situation:

- **Brochure / business site** (a few pages, contact form, gallery): an entry shared plan is more than enough.
- **Growing business with email** (several staff, professional inboxes): a mid-tier plan with more storage and email accounts.
- **Online store** (products, checkout, more traffic): a higher shared plan or a small server, so checkout stays fast during busy periods.
- **High-traffic or custom platform:** a **VPS** (your own dedicated slice of a server) for full control and consistent speed.

Start at the tier that fits **today**. Upgrading later takes minutes; you don't need to pay for headroom you won't touch for years.

## EazWorld hosting plans at a glance

Our shared plans scale with you, and every one includes free LiteSpeed speed, a free SSL, weekly backups, malware scanning, cPanel management, and 24/7 support:

- **Deluxe** — best price for a basic website: one site, NVMe SSD storage, and business email to get you online.
- **Professional** — for a growing business: more storage, more bandwidth, and more email accounts.
- **Enterprise** — for busier sites and small stores: generous storage, high bandwidth, and plenty of inboxes.
- **Ultimate** — unlimited storage, bandwidth, and email for content-heavy or multi-site needs.

Need more power? **VPS Starter, Business, and Pro** give you a dedicated server slice for high-traffic sites and custom apps.

See live pricing and the full feature list on the [hosting plans page](/hosting).

## How to choose without overpaying

1. **Start with your real needs, not the biggest plan.** Most businesses are well served by an entry or mid-tier shared plan.
2. **Insist on free SSL and automatic backups.** These protect your site and your customers — they shouldn't cost extra.
3. **Check the support promise.** When your site goes down, response time is everything. Look for genuine 24/7 support.
4. **Keep your domain and hosting in your own name.** Even if they're with the same provider, the accounts should belong to you.
5. **Plan to grow, not to guess.** Pick the plan that fits now, knowing you can upgrade in minutes.

## Get hosted with EazWorld

We keep it simple: choose a plan tuned for Ghanaian visitors, and we handle the setup — SSL, email, backups, and connecting your domain — so you're online without touching a control panel.

- **[Compare hosting plans](/hosting)** — see storage, email, and live pricing side by side.
- **[Search for your domain](/domains)** — pair your hosting with the right .com.gh or .com name.
- **[Book a free consultation](/book-consultation)** — not sure which plan fits? Tell us about your business and we'll recommend one.

Ready to get your business online? [Pick a hosting plan](/hosting) and we'll take it from there.`,
  },

  {
    title: "5 Signs Your Phone Battery Needs Replacing (Not a New Phone)",
    slug: "signs-phone-battery-needs-replacing",
    excerpt:
      "Phone dying by lunchtime? Before you spend on a new one, here are 5 clear signs your battery — not your phone — is the problem, and what a replacement costs in Ghana.",
    category: "Phone Repair",
    readTime: "5 min read",
    content: `Your phone used to last all day. Now it's begging for a charger by lunchtime, and you're wondering if it's time for a whole new phone. Usually, it isn't. Nine times out of ten, it's just the **battery** — and replacing one costs a fraction of a new device.

Phone batteries wear out. After 18 to 24 months of daily charging, they simply hold less power than they used to. The good news: a worn battery is one of the easiest, cheapest phone problems to fix. Here are the five signs to watch for.

## 1. It drains way faster than it used to

The clearest sign. If your phone went from lasting all day to needing a top-up by afternoon — with the same apps and habits — the battery is losing capacity. A healthy battery discharges gradually. A worn one empties fast, especially the last 30 percent.

## 2. It dies suddenly, or jumps in the percentage

Watch for the battery reading behaving strangely:

- It drops from **40 percent to dead** with no warning.
- It **jumps around** — 60 percent, then 45, then back to 55.
- It **shuts down in cold air-conditioning** or when you open the camera.

These mean the battery can no longer report or hold charge reliably. It's worn, and it's only going one way.

## 3. It gets hot — even when you're not doing much

A little warmth while gaming or charging is normal. Constant heat during light use — messaging, scrolling — is not. An ageing battery works harder and runs hotter, which then wears it out even faster. Persistent heat is worth acting on sooner rather than later.

## 4. It only works while plugged in

If your phone dies the moment you unplug it, the battery has effectively stopped holding a charge. Using a phone permanently tethered to a wall isn't a fix — and a battery in this state is stressed. Replace it before it fails completely.

## 5. The back is swelling or the screen is lifting

This one is serious. If the back cover feels raised, the screen is pushing up at an edge, or the phone rocks on a flat table, the battery is **swelling** — and a swollen battery is a safety risk.

- **Stop charging it immediately.**
- Don't press on it or try to puncture it.
- Get it to a technician as soon as you can.

A swollen battery isn't a "someday" repair. Treat it as urgent.

## Battery replacement vs. a new phone

Here's the math that surprises people: a battery replacement is usually a **small fraction** of the price of a new phone. If your phone is otherwise fine — good screen, enough storage, still gets updates — a fresh battery can give it another year or two of all-day life.

Replacement is the smart choice when:

- The phone still does everything you need.
- The screen, camera, and charging port all work.
- It still receives software updates.

Consider upgrading instead only if the battery is one of several failing parts, or the phone is very old and no longer supported.

## Before you replace it

A couple of quick checks and precautions:

1. **Rule out the simple stuff.** A worn charging cable or a heavy new app can mimic battery drain. But if you're seeing several signs above, it's the battery.
2. **Back up your data** before any repair, just in case.
3. **Insist on a quality battery and a warranty.** A cheap cell will wear out fast; a good one, backed by a warranty, lasts. Always ask which you're getting.

## Get your battery checked with EazWorld

At EazWorld we test your battery's real health first, tell you honestly whether it needs replacing, and quote you before any work starts. We fit quality batteries, back them with a warranty, and give you a tracking link so you always know your repair's status.

- **[Book a battery check or replacement](/repair)** — tell us your device and the symptoms, and we'll take it from there.
- **[Track an existing repair](/track)** — check your job's status any time.
- **[Visit our shop](/visit-us)** — prefer to bring it in? Here's where to find us.

Phone dying too early? [Book a battery check now](/repair) — it's cheaper than you think.`,
  },

  {
    title: "How to Accept Mobile Money Payments on Your Website (2026)",
    slug: "accept-mobile-money-payments-website",
    excerpt:
      "Want customers to pay by MTN, Telecel or AirtelTigo MoMo on your website? Here's how online Mobile Money payments work in Ghana in 2026, what they cost, and how to set them up.",
    category: "SEO",
    readTime: "6 min read",
    content: `In Ghana, Mobile Money isn't a payment option — it's the payment method. If your website can't take MTN, Telecel, and AirtelTigo MoMo, you're asking customers to jump through hoops to give you money. Many simply won't.

The good news: accepting Mobile Money online is far easier than most business owners think. This guide explains how it works in 2026, what it costs, and exactly how to set it up on your site.

## How online Mobile Money actually works

When a customer pays on your website, the money doesn't move by magic — it passes through a **payment gateway**. The gateway securely connects your site to the mobile networks and banks, takes the payment, and settles the money into your account.

The flow, from the customer's side:

1. They reach checkout and choose **Mobile Money**.
2. They pick their network — MTN, Telecel, or AirtelTigo — and enter their number.
3. They get a prompt on their phone and approve it with their PIN.
4. Payment confirmed, order placed. Done in seconds.

You never touch their PIN or handle sensitive details — the gateway does all of that securely.

## What you need to accept MoMo online

Three things:

- **A website with a checkout** — a shop, a booking page, or even a simple payment link.
- **A payment gateway account** — in Ghana, **Paystack** is the standard choice, supporting both Mobile Money and cards.
- **A settlement account** — a bank account or MoMo account where your money lands.

That's it. You don't need to sign separate deals with each mobile network — the gateway bundles them all.

## Cards too, not just Mobile Money

Set up a gateway once and you accept **both**:

- **Mobile Money** — MTN, Telecel, AirtelTigo (how most Ghanaian customers pay).
- **Cards** — Visa and Mastercard, for local and international buyers.

One integration, every common payment method. That matters if you sell to customers abroad or to the minority who prefer cards.

## What does it cost?

There's usually **no big upfront fee** to accept payments online. Instead, the gateway takes a **small percentage of each transaction** — a cost of sales, not a setup cost. Rates differ slightly between Mobile Money and cards, and between local and international payments.

Two practical points:

- Because the fee is per transaction, you only pay when you actually get paid.
- Build the fee into your pricing the way any business accounts for the cost of taking payment.

Always check the current published rates with your gateway before you launch, since they change.

## Is it safe?

Yes — and safer than handling cash. A proper gateway is **PCI-compliant**, encrypts every transaction, and never exposes card numbers or MoMo PINs to you or your site. On your side, the essentials are:

- Serve your site over **https** with a valid SSL certificate.
- Confirm each payment on your server before fulfilling the order — never trust the browser alone.
- Keep your gateway keys private.

If your site is built properly, this is handled for you. It's worth confirming with whoever builds it.

## How to set it up (the practical route)

1. **Get your website checkout ready.** A shop, a service booking, or a payment page.
2. **Create a gateway account** and complete the business verification (they'll ask for ID and business details).
3. **Connect the gateway to your site.** This is the technical step — the checkout has to talk to the gateway securely and confirm each payment on the server.
4. **Test with a real, small payment** on each method before going live.
5. **Set your settlement account** so your money reaches you on schedule.

Steps 1 and 3 are where most businesses want a developer — a badly wired checkout is exactly where money and trust get lost.

## Let EazWorld handle it

We build websites and stores with **Mobile Money and card payments** wired in properly from day one — verified securely on the server, tested end to end, and settling into your account. You focus on selling; we make sure getting paid just works.

- **[See our web design services](/services)** — stores and sites with MoMo + card checkout built in.
- **[Book a free consultation](/book-consultation)** — tell us how you want to get paid and we'll set it up.
- **[Browse our shop](/shop)** — see a live Ghanaian checkout in action.

Want customers to pay you the easy way? [Talk to us about your checkout](/book-consultation).`,
  },

  {
    title: "Case Study: How We Built Toloba Sport Consult a Website in 2 Weeks",
    slug: "case-study-toloba-sport-consult",
    excerpt:
      "Toloba Sport Consult had the expertise but no website — so clients had no easy way to find or book them. Here's how we built their site in two weeks and put consultations online.",
    category: "Case Study",
    readTime: "4 min read",
    featured: true,
    content: `Plenty of great businesses in Ghana share one quiet problem: the expertise is there, but there's no website — so new clients can't find them, and booking means a back-and-forth of calls and messages. **Toloba Sport Consult** was in exactly that position. Here's how we changed it in two weeks.

## The challenge

Toloba Sport Consult offers sports consultation — real, specialist knowledge. But the business had **no website at all**.

That meant:

- **No home online.** Potential clients had nowhere to learn what Toloba offers or why to trust them.
- **No easy way to book.** Every consultation depended on personal contact and word of mouth.
- **No presence in search.** Anyone searching for sports consultation simply couldn't find them.

The knowledge was there. What was missing was a front door.

## What we built

We built Toloba Sport Consult a clean, professional website designed around one job: turn a visitor into a booked consultation.

- **A clear, credible home** — who Toloba is, the consultation services offered, and why to trust them, presented simply and professionally.
- **Online consultation booking** — so a client can go from "interested" to "booked" without a single phone call.
- **A mobile-first design** — built for the phones most Ghanaian visitors actually use.
- **A foundation to be found** — set up so the business can grow its presence in search over time.

## Done in two weeks

From brief to live site took about **two weeks**. We kept the scope focused on what the business needed now — a professional presence and a way to book — rather than over-building. That's how a small business gets online fast, and starts seeing value while momentum is high.

## The result

The change was simple but meaningful: Toloba Sport Consult now **receives consultations through the website**. Instead of relying entirely on personal contact and word of mouth, the business has a front door that works around the clock — a place to send every prospect, and a way for new clients to book on their own.

## The takeaway for your business

If you have the skills but no website, you're leaving clients — and consultations — on the table. A focused, professional site doesn't have to take months or cost a fortune. Like Toloba, you can be online, and taking bookings, in a couple of weeks.

- **[See our web design services](/services)** — professional sites built for Ghanaian businesses.
- **[View more of our work](/portfolio)** — see what we've built for others.
- **[Book a free consultation](/book-consultation)** — tell us about your business and we'll map out your site.

Ready for a front door that works while you do? [Let's build yours](/book-consultation).`,
  },

  {
    title: "iPhone vs. Android Repair in Ghana: Cost, Time & What to Expect",
    slug: "iphone-vs-android-repair-ghana",
    excerpt:
      "iPhone or Android — which is cheaper to repair in Ghana, and why? A clear 2026 comparison of screen, battery and water-damage repairs, costs, and parts.",
    category: "Phone Repair",
    readTime: "6 min read",
    content: `"Is it more expensive to repair an iPhone than an Android?" It's one of the most common questions we hear — and the honest answer is: usually yes, but not always, and it depends entirely on the model and the part.

This guide breaks down how iPhone and Android repairs really compare in Ghana in 2026 — what drives the price, how long each takes, and what to check before you hand over your phone.

## The short answer

- **iPhones** generally cost more to repair because parts are pricier and Apple's designs are tightly integrated.
- **Androids** vary wildly — a budget Tecno or Infinix is cheap to fix; a flagship Samsung Galaxy S can cost as much as an iPhone.

So it's less "iPhone vs Android" and more "budget phone vs flagship phone." A high-end phone of either kind is an expensive repair.

## Why iPhones usually cost more

Three reasons:

- **Parts are more expensive.** iPhone screens (especially OLED models) and batteries cost more to source than most Android equivalents.
- **Tighter integration.** Apple pairs parts to the phone, so some repairs need careful handling to keep every feature working.
- **Newer models are pricier.** An iPhone 12 or newer screen costs far more than an iPhone 8 screen.

None of this makes iPhones "bad to repair" — it just means you should always get the quote first.

## Where Androids differ

Android covers everything from a GH₵800 phone to a GH₵15,000 flagship, so repair costs spread just as widely:

- **Budget Android** (Tecno, Infinix, itel, entry Samsung): parts are cheap and widely available — often the most affordable phones to repair in Ghana.
- **Mid-range Android** (Samsung A-series, Redmi): moderate part costs, quick turnaround.
- **Flagship Android** (Samsung S/Note, Pixel): OLED screens and complex assemblies push costs up toward iPhone territory.

## Repair-by-repair comparison

### Screen replacement
The biggest cost gap. Budget Android screens are cheap; iPhone and flagship Android OLED screens are expensive because the part is most of the price. Always ask whether it's a glass-only fix or a full assembly, and whether the part is original or aftermarket.

### Battery replacement
Much closer between the two. Batteries are among the cheapest repairs on either platform, and a replacement can add a year or two of life to a phone that's otherwise fine.

### Charging port
Comparable cost on both. On some models the port is a simple swap; on others it's soldered, which takes longer and costs more — your technician can tell you which yours is.

### Water damage
Not really a platform question. Cost depends on how far the liquid spread and what it corroded, on any phone. Speed matters far more than brand here — the sooner it's opened and cleaned, the better the outcome.

## Time: how long each takes

For common models of either platform, most screen and battery repairs take **30 minutes to 2 hours** once the part is in stock. Rarer models — or newer iPhones — may need the part ordered first, so allow **1 to 3 days**. Water damage takes longest because it needs careful cleaning and drying, not a quick swap.

## What to check before any repair — iPhone or Android

1. **Get the quote and diagnosis first.** Which part, and original or aftermarket.
2. **Ask about the part quality.** Original costs more and lasts; aftermarket is cheaper but varies. Your call — but know which you're buying.
3. **Get a warranty.** A shop confident in its parts stands behind them.
4. **Back up your data** before handing the phone over.
5. **Test before you pay:** screen, touch across the whole display, cameras, and the earpiece.

## Repair it right with EazWorld

Whatever you carry — iPhone or Android, budget or flagship — we diagnose it first, quote you before any work, let you choose original or aftermarket parts, and back the repair with a warranty. Every job comes with a tracking link.

- **[Book a repair](/repair)** — tell us your device and the fault.
- **[Track an existing repair](/track)** — check your job status any time.
- **[Visit our shop](/visit-us)** — prefer to come in? Here's where to find us.

Not sure what your repair should cost? [Book a free diagnosis](/repair) and we'll tell you straight.`,
  },

  {
    title: "How Much Does an Online Store Cost to Build in Ghana? (2026)",
    slug: "online-store-cost-ghana",
    excerpt:
      "Thinking of selling online? Here's what an e-commerce website really costs to build and run in Ghana in 2026 — features, payments, and honest cedi ranges.",
    category: "Web Design",
    readTime: "7 min read",
    content: `Selling online in Ghana has never made more sense — Mobile Money is everywhere, and customers are used to buying from their phones. But "how much does an online store cost?" is a hard question to get a straight answer to.

This guide breaks it down honestly: what an e-commerce site actually includes, what pushes the price up or down, and realistic cedi ranges for 2026 — plus the running costs most people forget.

## What an online store really includes

A shop is more than a website with prices on it. A proper online store needs:

- **A product catalogue** — items, photos, prices, and stock, easy for you to update.
- **A cart and checkout** — where customers review and pay.
- **Payments** — Mobile Money (MTN, Telecel, AirtelTigo) and cards, taken securely.
- **Order management** — so you can see, track, and fulfil what's been bought.
- **Delivery handling** — zones, fees, or pickup options for a Ghanaian audience.
- **A mobile-first design** — because most customers will shop from a phone.

The more of these you need custom-built, the more it costs — but each one directly affects whether you actually make sales.

## What an online store costs to build

Ranges depend on size and how custom it is:

- **Starter store** (a small catalogue, MoMo + card checkout, clean design): **GH₵9,000 to GH₵14,000**
- **Standard store** (larger catalogue, delivery zones, order tracking, accounts): **GH₵14,000 to GH₵25,000**
- **Custom / larger platform** (advanced features, integrations, heavy traffic): **GH₵25,000+**

What moves the price: number of products, custom design versus a template, delivery logic, customer accounts, and any integrations (inventory, accounting, marketing).

## The running costs people forget

The build is one-off; a store also has ongoing costs:

- **Hosting** — an online store needs faster, sturdier hosting than a brochure site so checkout stays quick when it's busy.
- **Domain** — renewed yearly.
- **Payment fees** — the gateway takes a small percentage of each sale (a cost of sales, not a setup fee).
- **Maintenance** — updates, security, and fixes so the store keeps running.
- **Product content** — good photos and descriptions; this is what actually sells.

Budget for these from the start so nothing surprises you after launch.

## What makes a store actually sell

Spending more doesn't guarantee sales. These do:

1. **Fast, mobile-first pages.** Slow sites lose buyers before they reach checkout.
2. **A checkout that just works.** MoMo and card, verified securely, with as few steps as possible.
3. **Clear photos and honest descriptions.** Customers can't hold the product — the page has to do that job.
4. **Trust signals.** Reviews, clear delivery and return info, and real contact details.
5. **Easy self-management.** You should be able to add products and update stock without calling a developer.

## How to spend wisely

- **Start with the products you have now.** Launch lean; add features as you grow.
- **Don't skimp on checkout and hosting.** These are where sales are won or lost.
- **Own your domain, hosting, and store data.** Everything in your name.
- **Plan for photos.** Budget time or money for good product images.

## Build your store with EazWorld

We build online stores made for Ghana — Mobile Money and card checkout wired in properly, delivery handling, order management, and a design that works on the phones your customers actually use. Domain, hosting, and payments, set up in one place.

- **[See our web design services](/services)** — stores built for the Ghanaian market.
- **[Browse our shop](/shop)** — see a live Ghanaian store and checkout in action.
- **[Book a free consultation](/book-consultation)** — tell us what you sell and we'll recommend the right build.

Ready to start selling online? [Talk to us about your store](/book-consultation).`,
  },

  {
    title: "How to Choose a Budget Smartphone in Ghana (2026 Buying Guide)",
    slug: "best-budget-smartphones-ghana",
    excerpt:
      "Shopping for an affordable phone in Ghana? Here's exactly what to look for at each budget in 2026 — battery, storage, screen, and network — so you don't waste your cedis.",
    category: "General",
    readTime: "6 min read",
    content: `A good budget phone in 2026 does almost everything a flagship does — calls, WhatsApp, Mobile Money, photos, social media — for a fraction of the price. A bad one frustrates you daily. The difference isn't the brand on the box; it's knowing what to check before you pay.

This guide shows you exactly what matters in an affordable phone in Ghana, band by band, so you spend your cedis where they count.

## The specs that actually matter (and the ones that don't)

Ignore the marketing numbers. For everyday use, prioritise these:

- **Battery (mAh):** the single most important spec for Ghana. Look for **5,000mAh or more** so the phone lasts through a day, power cuts included.
- **RAM:** aim for **4GB or more** so the phone doesn't lag when you switch apps.
- **Storage:** **64GB is the practical minimum**; 128GB is better. Photos and WhatsApp fill space fast. A microSD slot is a bonus.
- **Network bands:** make sure it fully supports **4G** on Ghanaian networks (and 5G if you want to future-proof).
- **Screen:** a bright enough display to read outdoors matters more than sheer size.

What matters **less** than the ads suggest: huge megapixel counts, the number of rear cameras, and gaming-focused specs you'll never use.

## Match the phone to how you'll use it

Be honest about what you actually do:

- **Calls, WhatsApp, Mobile Money, some photos:** an entry-level phone with a big battery and 4GB RAM is plenty.
- **Lots of social media, photos, and multitasking:** step up to more RAM and 128GB storage.
- **Streaming, light gaming, heavy use:** the top of the budget band, with a better screen and processor.

Buying more phone than you need wastes money; buying less leaves you frustrated in a month.

## Budget bands: what to expect

Rough guide to what your money buys in Ghana in 2026:

- **Entry level:** a dependable phone for calls, messaging, and MoMo. Prioritise battery and build over camera.
- **Lower-mid range:** the sweet spot for most people — good battery, enough RAM and storage, a decent screen.
- **Upper-mid range:** noticeably better screen, camera, and speed, still well below flagship prices.

Our current picks in each band:

- **Entry level:** [ADD YOUR PICK](/shop)
- **Lower-mid range:** [ADD YOUR PICK](/shop)
- **Upper-mid range:** [ADD YOUR PICK](/shop)

## Before you buy: a quick checklist

1. **Confirm the battery is 5,000mAh+** if all-day life matters (it does).
2. **Check storage is 64GB or more** — you'll fill less than that fast.
3. **Verify 4G support** on your network.
4. **Buy from a trusted seller** with a warranty and genuine stock — not a too-good-to-be-true price.
5. **Plan for a case and screen protector** from day one; they're cheaper than a repair.

## Protect your new phone

A budget phone is a smart buy — protect it so it lasts. A case and screen protector cost far less than a cracked-screen repair, and a good battery-charging habit keeps it healthy for years. If anything does go wrong, a quick repair usually beats replacing the whole phone.

- **[Shop phones and accessories](/shop)** — cases, protectors, and more.
- **[Book a repair](/repair)** — cracked screen or battery trouble? We'll sort it fast.

Ready to choose? [Browse our phones and accessories](/shop) and pick the one that fits how you actually use it.`,
  },

  {
    title: "Phone Got Wet? What to Do in the First Hour (and What Not To)",
    slug: "phone-water-damage-first-hour",
    excerpt:
      "Dropped your phone in water? The first hour decides whether it survives. Here's exactly what to do — and the common mistakes that make water damage worse.",
    category: "Phone Repair",
    readTime: "5 min read",
    content: `It happens in a second — the phone slips into a bucket, the sink, the toilet, or gets caught in the rain. What you do in the **first hour** decides whether it survives. Panic and the wrong moves can turn a recoverable phone into a dead one.

Here's exactly what to do, in order — and the popular "fixes" that actually cause more damage.

## Do this immediately

Speed matters more than anything else. As fast as you safely can:

1. **Get it out of the water.** The longer it's submerged, the further liquid spreads inside.
2. **Turn it off — and leave it off.** Power plus water is what fries the electronics. Do not check if it "still works."
3. **Don't plug it in to charge.** Putting power through a wet phone is one of the fastest ways to kill it.
4. **Dry the outside.** Wipe it with a soft cloth, and gently blot the ports.
5. **Remove what you can.** SIM tray, memory card, and the case. If your phone has a removable battery, take it out.
6. **Keep it upright and still.** Don't shake it — that spreads water to dry areas.

That's the whole emergency routine. The next decision is the important one.

## What NOT to do (these make it worse)

Popular advice online does real harm. Avoid all of these:

- **Rice.** The famous myth. Rice doesn't pull water from inside a sealed phone, and dust and starch can get into the ports. It mostly just wastes precious time.
- **A hairdryer or direct heat.** Heat pushes moisture deeper and can warp components and the battery.
- **Charging it to "test."** The single most damaging thing you can do to a wet phone.
- **Shaking or blowing hard into it.** This spreads water into parts that were still dry.
- **Turning it on repeatedly** to see if it works. Every power-on risks a short circuit.

## Why speed beats everything

Water itself isn't the real killer — **corrosion** is. Once liquid reaches the circuit board, it starts corroding the tiny connections, and that damage continues for hours and days after the phone looks dry on the outside.

That's why a phone can seem "fine" for a day, then stop working later. A professional clean within the first day removes the liquid and residue **before** corrosion sets in. The sooner it happens, the better the odds.

## When to get it to a technician

For anything more than a light splash, get it looked at quickly — ideally the same day. Bring it in straight away if:

- It went fully underwater, or was submerged for more than a moment.
- It fell into anything other than clean water (soapy, salty, or sugary liquids corrode faster).
- The screen shows lines, patches, or discolouration.
- It won't turn on, or behaves strangely after drying.

A proper repair means opening the phone, cleaning the board, and removing residue — not just letting it dry. That's what actually saves it.

## Get water damage handled fast with EazWorld

Water damage is a race against corrosion, and we treat it that way. We open the phone, clean the board properly, and tell you honestly what's recoverable — with a quote before any work and a tracking link so you know exactly where things stand.

- **[Book a water-damage repair](/repair)** — the sooner we start, the better the outcome.
- **[Visit our shop](/visit-us)** — bring it straight in; here's where to find us.
- **[Track an existing repair](/track)** — check your job status any time.

Phone taken a swim? Don't reach for the rice — [book a repair now](/repair). Every hour counts.`,
  },

  {
    title: "Why Your Business Needs an Email at Your Own Domain (Not Gmail)",
    slug: "business-email-own-domain-ghana",
    excerpt:
      "Still using a free Gmail or Yahoo address for your business? Here's why a professional email at your own domain (info@yourbusiness.com.gh) wins trust and sales in Ghana.",
    category: "Email Marketing",
    readTime: "5 min read",
    content: `Two businesses send you a quote. One writes from **info@brightbuild.com.gh**. The other from **brightbuild47@gmail.com**. Which one feels like a real, established company?

That instant judgement happens with every email your business sends. If you're still using a free Gmail or Yahoo address, you're quietly losing trust — and probably sales. Here's why a professional email at your own domain matters, and how to get one.

## What is a domain email?

A domain email uses **your own web address** after the @ sign — like info@yourbusiness.com.gh or sales@yourbusiness.com — instead of a free provider's name.

You've registered a domain for your website anyway. A domain email simply puts that same name to work in your inbox, so your website and your email speak with one voice.

## Why it matters for a Ghanaian business

- **Instant credibility.** A domain email signals you're an established business, not a side hustle run from a personal account.
- **Free marketing on every message.** Every email you send quietly advertises your web address.
- **It builds trust and reduces scams.** Customers are wary of unfamiliar Gmail addresses. Your own domain reassures them the message is really from you.
- **It scales with your team.** Give each role its own address — info@, sales@, accounts@, support@ — so enquiries reach the right person.
- **You own it.** Staff come and go, but the addresses stay with the business.

## "But Gmail is free and works fine"

Free personal email is fine for personal life. For a business it quietly costs you:

- **Lost trust** with every customer who sees a free address on an invoice or quote.
- **A messy, unprofessional look** — random numbers in an address never reads as serious.
- **No real ownership.** If the person who controls that free account leaves, your business communications can leave with them.

The good news: professional email is inexpensive and usually comes bundled with the hosting you need for your website anyway.

## How to set up business email (the easy way)

1. **Register your domain** — ideally a **.com.gh** or **.com** for your business.
2. **Choose hosting that includes email accounts.** Most business hosting plans come with several inboxes at your domain.
3. **Create your addresses** — start with info@ and sales@, and add roles as you grow.
4. **Connect it to your phone and computer,** or use webmail in a browser.
5. **Set a professional signature** — name, role, business, and website — on every account.

You don't need to be technical. If your website and hosting are set up properly, your email comes with them.

## A few good habits

- **Use role addresses, not personal ones,** for anything customer-facing (info@, not a personal name) — they outlast any one employee.
- **Keep a clear signature** with your website and phone number.
- **Secure your accounts** with strong passwords, so your business identity can't be hijacked.

## Get professional email with EazWorld

Every EazWorld hosting plan includes email at your own domain — so your website and your inbox share one professional name. We set up your addresses, connect them to your devices, and you start sending mail that looks the part.

- **[See hosting plans with email](/hosting)** — inboxes at your domain, included.
- **[Search for your domain](/domains)** — secure the .com.gh or .com your email will use.
- **[Book a free consultation](/book-consultation)** — we'll set up your domain, hosting, and email together.

Still emailing customers from Gmail? [Get email at your own domain](/hosting) and look the part.`,
  },
];

async function seed() {
  const db = resolveDbUrl();
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");
  logDbTarget();

  // Idempotent upsert keyed on the unique slug. Seeded as drafts
  // (published: false); flip to published in the admin blog dashboard once
  // prices are confirmed and the two placeholder posts are filled in.
  const ops = POSTS.map((p) => ({
    updateOne: {
      filter: { slug: p.slug },
      update: {
        $set: {
          title: p.title,
          excerpt: p.excerpt,
          content: p.content,
          category: p.category,
          readTime: p.readTime,
          featured: p.featured === true,
        },
        $setOnInsert: {
          slug: p.slug,
          author: "EazWorld Team",
          published: false,
        },
      },
      upsert: true,
    },
  }));
  const result = await Post.bulkWrite(ops);
  console.log(
    `Posts — ${result.upsertedCount} inserted, ${result.modifiedCount} updated, ${result.matchedCount} matched`,
  );

  const total = await Post.countDocuments();
  const published = await Post.countDocuments({ published: true });
  console.log(`Totals — Posts: ${total}, Published: ${published}`);

  await mongoose.connection.close();
  console.log("Seed complete");
}

// Guarded so tests and other seeders can `require` the post data without
// triggering a DB run.
if (require.main === module) {
  dotenv.config({ path: "./.env" });
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}

module.exports = { POSTS };
