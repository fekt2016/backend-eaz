/**
 * Hosting plans. Prices are stored as **USD per month** (`priceUsd`) and converted
 * to GH₵ at read time — the same idea as domain pricing, where `config/domainPricing.js`
 * holds USD and `services/namecheap.js`'s `usdToGhs()` converts with the same
 * admin-set exchange rate (Settings.pricing.usdToGhsRate).
 *
 * Why (T66/T67, 2026-08-25): the shared tiers used to be stored as 9/16/32/62 and
 * rendered as **GH₵**, i.e. about $0.58–$4/month — a USD price list that never got
 * converted. Storing one currency and deriving the other removes that whole class of
 * bug: a half-converted price is no longer expressible, and a rate change moves every
 * plan at once instead of leaving some behind.
 *
 * `monthlyPrice` and `annualPrice` are still on every plan — as live getters, so every
 * existing reader (the plans API, the storefront, `getPlanPrice`) keeps working
 * unchanged and always sees the current rate.
 *
 * The VPS/Cloud/WordPress/Email `priceUsd` values were back-derived from their original
 * GH₵ prices at 15.5, so nothing moved for those tiers.
 *
 * T66 (2026-08-26): the first shared conversion (9/16/32/62 → GH₵140–961) left the
 * ladder inverted — Shared Ultimate cost more than VPS Pro. Repriced to a market
 * ladder (4/8/14/18 → GH₵62/124/217/279), so a shared account now always costs
 * less than the cheapest VPS. User-approved.
 */

// Annual billing is charged as ten months: two months free. Previously every
// `annualPrice` was hardcoded to exactly monthlyPrice × 12, so "annual" was no saving
// at all while the storefront advertised one.
const MONTHS_BILLED_ANNUALLY = 10;

function usdToGhs(usd) {
  // Same admin-editable rate the domain prices use — deliberately shared, so a
  // cedi move reprices hosting and domains together instead of leaving one
  // behind. No markup here: hosting `priceUsd` values are already sell prices.
  const { getRate } = require('../services/pricingSettings');
  return Math.round(usd * getRate());
}

// ── Shared-tier prices are pinned to GH₵, not USD (2026-08-31) ──────────────
//
// The shared tiers are priced against the Ghanaian market — Aveshost's entry
// shared plan is ~GH₵9/mo — so the customer-facing figure that matters is the
// cedi one: GH₵9 / 16 / 32 / 62. This file stores USD and derives GH₵, so those
// four `priceUsd` values are back-derived to land on the cedi targets after
// `Math.round`, which is why they are fractional and look odd (0.58, 1.03,
// 2.065, 4.00). Each was chosen so BOTH monthly and annual round exactly:
// e.g. 2.065 × 15.5 = 32.0075 → 32, and × 10 months = 320.075 → 320.
//
// ⚠️ They are therefore RATE-SENSITIVE. `usdToGhsRate` is admin-editable in
// Business Settings, and changing it moves these off their targets — at 16.0,
// Deluxe becomes GH₵9.28 → 9 (still fine), but at 20.0 it becomes GH₵12. If the
// cedi price must hold regardless of the rate, this file needs a `priceGhs`
// field rather than a derived one; that is a structural change, not a retune.
//
// Only the four SHARED tiers are pinned this way. vps/cloud/wordpress/email
// still hold genuine USD sell prices.
const HOSTING_PLANS = {
  // Sized against the Namecheap Nebula reseller plan, which gives 30 GB disk,
  // 30 mailboxes and 25 cPanel accounts FOR THE WHOLE PLAN — shared by every
  // customer and by eazworld.co itself. The previous tiers read those totals as
  // if they were per-account, which is how `enterprise` came to advertise 50 GB
  // (more disk than the entire plan holds) and `ultimate` unlimited storage and
  // mailboxes. Budget: 6 GB / 5 mailboxes / 2 accounts reserved for the site and
  // API, leaving 24 GB / 25 mailboxes / 23 accounts to sell.
  //
  // `specs` is the structured pair list the storefront's comparison table matches
  // on by label; `features` is the marketing bullet list. Both live here so the
  // storefront has ONE source of truth — it used to carry its own copy in
  // src/data/hostingHostingData.js, which drifted to ~1/7th of these prices.
  //
  // Per-account RAM claims are deliberately absent: Nebula has 4 GB total, so
  // advertising "1GB RAM" per customer is the same category error as the 50 GB
  // tier. The 50 messages/hour per domain limit IS advertised — customers hit it.
  shared: {
    deluxe: {
      name: 'Deluxe',
      tagline: 'A single small site, online and looked after.',
      // GH₵9/mo. Back-derived: 0.58 × 15.5 = 8.99 → 9. See the note above
      // HOSTING_PLANS on why these are fractional.
      priceUsd: 0.58,
      specs: [
        { label: 'Websites', value: '1' },
        { label: 'NVMe SSD Storage', value: '1GB' },
        { label: 'Email Accounts', value: '1' },
        { label: 'Monthly Bandwidth', value: 'Unmetered' },
        { label: 'Subdomains', value: '2' },
        { label: 'Databases', value: '2' },
      ],
      features: [
        'FREE Webmail',
        'FREE UNLIMITED Auto SSL',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        'Free Malware Scanning',
        'Managed with cPanel',
        'Multiple PHP versions',
        '24/7 Support',
        'Email sending: 50 messages/hour per domain',
      ],
    },
    professional: {
      name: 'Professional',
      tagline: 'Room to grow, and mail for a small team.',
      // GH₵16/mo — 1.03 × 15.5 = 15.965 → 16.
      priceUsd: 1.03,
      specs: [
        { label: 'Websites', value: '1' },
        { label: 'NVMe SSD Storage', value: '3GB' },
        { label: 'Email Accounts', value: '3' },
        { label: 'Monthly Bandwidth', value: 'Unmetered' },
        { label: 'Subdomains', value: '10' },
        { label: 'Databases', value: '5' },
      ],
      features: [
        'FREE Webmail',
        'FREE UNLIMITED Auto SSL',
        'FREE Website Builder',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        'Free Malware Scanning',
        'Managed with cPanel',
        'Multiple PHP versions',
        'Cache manager',
        '24/7 Support',
        'Email sending: 50 messages/hour per domain',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'Several sites for one business.',
      // GH₵32/mo — 2.065 × 15.5 = 32.0075 → 32, and × 10 months = 320 exactly.
      priceUsd: 2.065,
      specs: [
        { label: 'Websites', value: '3' },
        { label: 'NVMe SSD Storage', value: '6GB' },
        { label: 'Email Accounts', value: '5' },
        { label: 'Monthly Bandwidth', value: 'Unmetered' },
        { label: 'Subdomains', value: '25' },
        { label: 'Databases', value: '10' },
      ],
      features: [
        'FREE .top Domain',
        'FREE Webmail',
        'FREE UNLIMITED Auto SSL',
        'FREE Website Builder',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        'Free Malware Scanning',
        'Managed with cPanel',
        'Multiple PHP versions',
        'Cache manager',
        'Free Domain Privacy Protection',
        'Priority 24/7 Support',
        'Email sending: 50 messages/hour per domain',
      ],
    },
    ultimate: {
      name: 'Ultimate',
      // Websites/subdomains are UNLIMITED; storage and mailboxes are not, and
      // must not be advertised as such. cPanel addon domains genuinely are
      // unlimited within an account — they cost no extra cPanel account slot —
      // so "unlimited websites" is deliverable. Disk is the real ceiling, which
      // is why the 10GB line stays and is what actually bounds the plan.
      tagline: 'Unlimited sites on our largest shared plan.',
      // GH₵62/mo — 4.00 × 15.5 = 62 exactly.
      priceUsd: 4.0,
      specs: [
        { label: 'Websites', value: 'Unlimited' },
        { label: 'NVMe SSD Storage', value: '10GB' },
        { label: 'Email Accounts', value: '10' },
        { label: 'Monthly Bandwidth', value: 'Unmetered' },
        { label: 'Subdomains', value: 'Unlimited' },
        { label: 'Databases', value: '20' },
      ],
      features: [
        'FREE .com Domain',
        'FREE Webmail',
        'FREE UNLIMITED Auto SSL',
        'FREE Website Builder',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        'Free Malware Scanning',
        'Managed with cPanel',
        'Multiple PHP versions',
        'Cache manager',
        'Free Domain Privacy Protection',
        'Priority 24/7 Support',
        'Email sending: 50 messages/hour per domain',
      ],
    },
  },
  vps: {
    starter: {
      name: 'VPS Starter',
      priceUsd: 18.06,
      features: [
        '2 vCPU cores',
        '2GB DDR4 RAM',
        '40GB NVMe SSD storage',
        '2TB bandwidth',
        'Full root access',
        'Dedicated IP address',
      ],
    },
    business: {
      name: 'VPS Business',
      priceUsd: 35.48,
      features: [
        '4 vCPU cores',
        '8GB DDR4 RAM',
        '80GB NVMe SSD storage',
        '4TB bandwidth',
        'Full root access',
        'Dedicated IP address',
        'Daily backups',
        'DDoS protection',
        'Free migration',
        'Priority support',
      ],
    },
    pro: {
      name: 'VPS Pro',
      priceUsd: 61.29,
      features: [
        '8 vCPU cores',
        '16GB DDR4 RAM',
        '160GB NVMe SSD storage',
        '8TB bandwidth',
        'Everything in VPS Business',
        'Managed server option',
        'Advanced firewall',
        'Hourly backups',
        'Load balancer ready',
        'Dedicated account manager',
      ],
    },
  },
  cloud: {
    starter: {
      name: 'Cloud Starter',
      priceUsd: 27.10,
      features: [
        '2 vCPU (auto-scale to 4)',
        '4GB RAM (auto-scale to 8GB)',
        '50GB SSD (expandable)',
        'Unmetered bandwidth',
        'Auto-scaling',
        'Load balancing',
        'Free SSL',
        'Daily backups',
        '99.99% uptime SLA',
      ],
    },
    business: {
      name: 'Cloud Business',
      priceUsd: 54.84,
      features: [
        '4 vCPU (auto-scale to 8)',
        '8GB RAM (auto-scale to 32GB)',
        '100GB SSD (expandable)',
        'Unmetered bandwidth',
        'Premium global CDN',
        'Auto-scaling',
        'Load balancing',
        'Free SSL',
        'Hourly backups',
        'DDoS protection',
        'Free migration',
        '99.99% uptime SLA',
        '24/7 priority support',
      ],
    },
    enterprise: {
      name: 'Cloud Enterprise',
      priceUsd: null,
      custom: true,
      features: [
        'Dedicated infrastructure',
        'Custom CPU & RAM',
        'Unmetered bandwidth',
        'Enterprise CDN',
        'Custom SLA',
        'Compliance support',
        'Dedicated engineer',
        '15-minute response SLA',
      ],
    },
  },
  // WordPress draws on the SAME 24 GB pool as `shared` — it is the same cPanel
  // account with WordPress preinstalled, not separate capacity. Sizing it as if
  // it had its own budget is what produced the old 80 GB `agency` tier.
  //
  // WordPress draws on the SAME disk pool as `shared` — it is a shared cPanel
  // account with WordPress preinstalled, not separate capacity.
  //
  // Repriced 2026-08-31 to sit just ABOVE the comparable shared tier rather than
  // several times above the whole shared range. When shared moved to GH₵9–62, these
  // still sat at GH₵78/140/185, so every WordPress plan cost more than Shared
  // Ultimate (GH₵62, 10 GB, unlimited sites) while giving less — WP Agency was 3×
  // the price for less disk and 3 sites instead of unlimited. Nobody would have
  // bought one. The premium now reflects what WordPress actually adds: a Softaculous
  // preinstall and managed core/plugin updates, not a different class of hardware.
  //
  // This is the same inversion T66 recorded when Shared Ultimate outpriced VPS Pro.
  // Check the whole ladder after moving ANY tier.
  //
  // `agency` was briefly dropped and is restored here by request. Its SPECS are not
  // restored: it advertised 80 GB on a plan holding 30 GB in total. Redis and a CDN
  // went with them — neither is available without root on a cPanel reseller plan.
  // White-labelling stays, because WHM genuinely supports reseller branding.
  // Seven WHM packages to create, not six.
  wordpress: {
    starter: {
      name: 'WP Starter',
      tagline: 'WordPress, installed and kept updated.',
      // GH₵25/mo — 1.61 × 15.5 = 24.955 → 25, × 10 months = 250.
      priceUsd: 1.61,
      specs: [
        { label: 'WordPress Sites', value: '1' },
        { label: 'NVMe SSD Storage', value: '2GB' },
        { label: 'Email Accounts', value: '1' },
        { label: 'Monthly Bandwidth', value: 'Unmetered' },
        { label: 'Databases', value: '2' },
      ],
      features: [
        'WordPress preinstalled (Softaculous)',
        'Automatic core + plugin updates',
        'FREE UNLIMITED Auto SSL',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        'Free Malware Scanning',
        'Managed with cPanel',
        '24/7 Support',
        'Email sending: 50 messages/hour per domain',
      ],
    },
    business: {
      name: 'WP Business',
      tagline: 'A busier WordPress site, with mail for a team.',
      // GH₵45/mo — 2.901 × 15.5 = 44.9655 → 45, × 10 months = 450.
      priceUsd: 2.901,
      specs: [
        { label: 'WordPress Sites', value: '1' },
        { label: 'NVMe SSD Storage', value: '5GB' },
        { label: 'Email Accounts', value: '3' },
        { label: 'Monthly Bandwidth', value: 'Unmetered' },
        { label: 'Databases', value: '5' },
      ],
      features: [
        'WordPress preinstalled (Softaculous)',
        'Automatic core + plugin updates',
        'FREE UNLIMITED Auto SSL',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        'Free Malware Scanning',
        'Managed with cPanel',
        'Cache manager',
        'Priority 24/7 Support',
        'Email sending: 50 messages/hour per domain',
      ],
    },
    agency: {
      name: 'WP Agency',
      tagline: 'Several client sites, managed under one roof.',
      // GH₵75/mo — 4.84 × 15.5 = 75.02 → 75, × 10 months = 750.
      priceUsd: 4.84,
      specs: [
        { label: 'WordPress Sites', value: '3' },
        { label: 'NVMe SSD Storage', value: '8GB' },
        { label: 'Email Accounts', value: '5' },
        { label: 'Monthly Bandwidth', value: 'Unmetered' },
        { label: 'Databases', value: '10' },
      ],
      features: [
        'WordPress preinstalled (Softaculous)',
        'Automatic core + plugin updates',
        'White-label control panel',
        'Client management tools',
        'FREE UNLIMITED Auto SSL',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        'Free Malware Scanning',
        'Managed with cPanel',
        'Cache manager',
        'Dedicated account manager',
        'Priority 24/7 Support',
        'Email sending: 50 messages/hour per domain',
      ],
    },
  },
  email: {
    starter: {
      name: 'Starter Email',
      priceUsd: 1.61,
      features: [
        '5 mailboxes',
        '5GB per mailbox',
        'Webmail access',
        'IMAP / POP3 / SMTP',
        'Spam & virus protection',
        'Mobile app sync',
        'SSL encrypted',
      ],
    },
    business: {
      name: 'Business Email',
      priceUsd: 3.55,
      features: [
        '20 mailboxes',
        '25GB per mailbox',
        'Webmail access',
        'IMAP / POP3 / SMTP',
        'Spam & virus protection',
        'Mobile app sync',
        'Shared calendar & contacts',
        'Email aliases (unlimited)',
        'Auto-responders',
        'SSL encrypted',
      ],
    },
    enterprise: {
      name: 'Enterprise Email',
      priceUsd: 7.74,
      features: [
        'Unlimited mailboxes',
        '100GB per mailbox',
        'Everything in Business',
        'Advanced admin controls',
        'Email archiving (7yrs)',
        'Compliance tools',
        'Dedicated IP for email',
        'Custom retention policies',
        'Dedicated account manager',
      ],
    },
  },
};

// ── What can actually be sold, and how ──────────────────────────────────────
// A cPanel RESELLER plan can create cPanel accounts. That is the entire
// constraint, and it decides this table:
//
//   instant      shared / wordpress — provisioned by utils/provisionHosting.js
//   enquiry      vps — no supplier and no API; the price is indicative and the
//                real one is quoted by hand, so we must not take money upfront
//   unavailable  cloud / email — cannot be delivered from Nebula at all
//                (email is capped at 30 mailboxes PLAN-WIDE, not per account)
//
// This drives BOTH the storefront button and the `createOrder` guard so the two
// can never disagree. It rides on each plan object as `plan.availability`, the
// same way prices do, because "can a customer buy this" is business meaning, not
// presentation — the frontend must not keep its own copy. That is the same
// mistake that let src/data/hostingHostingData.js advertise GH₵9/mo against a
// GH₵62/mo charge.
const PLAN_AVAILABILITY = {
  shared: "instant",
  wordpress: "instant",
  vps: "enquiry",
  cloud: "unavailable",
  email: "unavailable",
};

/** Can a customer pay for this plan type right now, unaided? */
function isSellable(planType) {
  return PLAN_AVAILABILITY[planType] === "instant";
}

// Expose the GH₵ figures as live getters rather than baked-in numbers: readers keep
// using `plan.monthlyPrice` / `plan.annualPrice`, but the value always reflects the
// current admin-set exchange rate, and the two can never drift apart. `enumerable` matters —
// without it these vanish from JSON.stringify and the plans API would return no prices.
for (const [planType, tiers] of Object.entries(HOSTING_PLANS)) {
  for (const plan of Object.values(tiers)) {
    // Ships on the plan itself, exactly like the prices below, so the storefront
    // cannot hold an opinion about sellability that the API disagrees with.
    plan.availability = PLAN_AVAILABILITY[planType] || "unavailable";
    Object.defineProperty(plan, "monthlyPrice", {
      enumerable: true,
      get() {
        return plan.priceUsd == null ? null : usdToGhs(plan.priceUsd);
      },
    });
    Object.defineProperty(plan, "annualPrice", {
      enumerable: true,
      get() {
        return plan.priceUsd == null ? null : usdToGhs(plan.priceUsd) * MONTHS_BILLED_ANNUALLY;
      },
    });
  }
}

function getPlanPrice(planType, tier, billingCycle) {
  // Unknown type/tier (e.g. a bad client request, or a stale frontend sending a
  // removed tier) is a 400-worthy input error, not a server fault — return the
  // same null-total shape callers already use for the cloud/enterprise custom
  // tier, rather than throwing (which propagated as a 500).
  const typeGroup = HOSTING_PLANS[planType];
  if (!typeGroup) {
    return { basePrice: null, total: null, billingCycle };
  }
  const plan = typeGroup[tier];
  if (!plan) {
    return { basePrice: null, total: null, billingCycle };
  }

  const basePrice = billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
  if (basePrice == null) {
    return { basePrice: null, total: null, billingCycle };
  }

  return { basePrice, total: basePrice, billingCycle };
}

// Nameservers customers must point their domain at (for 'own'/'skip' domains).
// Set HOSTING_NAMESERVERS to a comma-separated list from your WHM server,
// e.g. "ns1.eazworld.co,ns2.eazworld.co".
const HOSTING_NAMESERVERS = (process.env.HOSTING_NAMESERVERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Expiry lifecycle timing (days), env-configurable. Default: 7-day grace after
// expiry → suspend; 30 days after suspension → terminate.
const LIFECYCLE = {
  graceDays: Number(process.env.HOSTING_GRACE_DAYS) || 7,
  suspendToTerminateDays: Number(process.env.HOSTING_SUSPEND_TO_TERMINATE_DAYS) || 30,
};

module.exports = {
  PLAN_AVAILABILITY,
  isSellable,
  HOSTING_PLANS,
  getPlanPrice,
  HOSTING_NAMESERVERS,
  LIFECYCLE,
};

