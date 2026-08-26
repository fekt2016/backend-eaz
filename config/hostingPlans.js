/**
 * Hosting plans. Prices are stored as **USD per month** (`priceUsd`) and converted
 * to GH₵ at read time — the same idea as domain pricing, where `config/domainPricing.js`
 * holds USD and `services/spaceship.js`'s `usdToGhs()` converts with USD_TO_GHS_RATE.
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
 * GH₵ prices at 15.5, so nothing moved for those tiers — only the shared group repriced.
 */

// Annual billing is charged as ten months: two months free. Previously every
// `annualPrice` was hardcoded to exactly monthlyPrice × 12, so "annual" was no saving
// at all while the storefront advertised one.
const MONTHS_BILLED_ANNUALLY = 10;

function usdToGhs(usd) {
  const rate = parseFloat(process.env.USD_TO_GHS_RATE) || 15.5;
  return Math.round(usd * rate);
}

const HOSTING_PLANS = {
  shared: {
    deluxe: {
      name: 'Deluxe',
      tagline: 'Best price for a basic website.',
      priceUsd: 9,
      features: [
        'FREE LiteSpeed (20x Faster)',
        'FREE .top Domain',
        '1 Website',
        '1GB NVMe SSD Storage',
        '1GB RAM',
        '100GB Monthly Bandwidth',
        '5 Email Accounts',
        '2 Subdomains',
        '3 Databases',
        '2 FTP Accounts',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        '24/7 Support',
        'Free Malware Scanning',
        'Host PHP, Node.js & other apps',
        'Managed with cPanel',
        'Multiple PHP versions',
        'Free Domain Privacy Protection',
        'Cache manager',
        '250,000 Inodes',
      ],
    },
    professional: {
      name: 'Professional',
      tagline: 'Enhanced features designed to grow your online presence.',
      priceUsd: 16,
      features: [
        'FREE LiteSpeed (20x Faster)',
        'FREE .top Domain',
        '1-Click WordPress Install',
        '1 Website',
        '10GB NVMe SSD Storage',
        '2GB RAM',
        '300GB Monthly Bandwidth',
        '15 Email Accounts',
        '10 Subdomains',
        '10 Databases',
        '7 FTP Accounts',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        '24/7 Support',
        'Free Malware Scanning',
        'Host PHP, Node.js & other apps',
        'Managed with cPanel',
        'Multiple PHP versions',
        'Free Domain Privacy Protection',
        'Cache manager',
        '250,000 Inodes',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'Level up with more power and enhanced features.',
      priceUsd: 32,
      featured: true,
      badge: 'MOST POPULAR',
      features: [
        'FREE LiteSpeed (20x Faster)',
        'FREE .top Domain',
        '3 Websites',
        '50GB NVMe SSD Storage',
        '3GB RAM',
        '1TB Monthly Bandwidth',
        '50 Email Accounts',
        '30 Subdomains',
        '50 Databases',
        '30 FTP Accounts',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        '24/7 Support',
        'Free Malware Scanning',
        'Host PHP, Node.js & other apps',
        'Managed with cPanel',
        'Multiple PHP versions',
        'Free Domain Privacy Protection',
        'Cache manager',
        '350,000 Inodes',
      ],
    },
    ultimate: {
      name: 'Ultimate',
      tagline: 'Enjoy optimized performance & powerful resources.',
      priceUsd: 62,
      features: [
        'FREE LiteSpeed (20x Faster)',
        'FREE .com, .top Domain',
        'UNLIMITED Websites',
        'UNLIMITED NVMe SSD Storage',
        '4GB RAM',
        'UNLIMITED Monthly Bandwidth',
        'UNLIMITED Email Accounts',
        'UNLIMITED Subdomains',
        'UNLIMITED Databases',
        'UNLIMITED FTP Accounts',
        'Weekly Website Backups',
        'Web Application Firewall',
        'DDoS Protection',
        '24/7 Support',
        'Free Malware Scanning',
        'Host PHP, Node.js & other apps',
        'Managed with cPanel',
        'Multiple PHP versions',
        'Free Domain Privacy Protection',
        'Cache manager',
        '650,000 Inodes',
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
  wordpress: {
    starter: {
      name: 'WP Starter',
      priceUsd: 2.90,
      features: [
        '10GB NVMe SSD storage',
        '1 WordPress site',
        'Up to 10,000 visitors/mo',
        'Pre-installed WordPress',
        'Free SSL',
        'Automatic WP updates',
        'One-click staging',
        'WP-optimised cache',
      ],
    },
    business: {
      name: 'WP Business',
      priceUsd: 6.13,
      features: [
        '30GB NVMe SSD storage',
        '3 WordPress sites',
        'Up to 50,000 visitors/mo',
        'Free SSL + free domain',
        'Automatic WP updates',
        'Daily backups',
        'One-click staging',
        'WooCommerce ready',
        'Malware scanning',
        'Free migration',
        'Priority WP support',
      ],
    },
    agency: {
      name: 'WP Agency',
      priceUsd: 11.94,
      features: [
        '80GB NVMe SSD storage',
        '10 WordPress sites',
        'Up to 200,000 visitors/mo',
        'Everything in WP Business',
        'White-label dashboard',
        'Client management tools',
        'Advanced caching (Redis)',
        'CDN included',
        'Dedicated account manager',
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

// Expose the GH₵ figures as live getters rather than baked-in numbers: readers keep
// using `plan.monthlyPrice` / `plan.annualPrice`, but the value always reflects the
// current USD_TO_GHS_RATE, and the two can never drift apart. `enumerable` matters —
// without it these vanish from JSON.stringify and the plans API would return no prices.
for (const tiers of Object.values(HOSTING_PLANS)) {
  for (const plan of Object.values(tiers)) {
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
// Set HOSTING_NAMESERVERS to a comma-separated list from your Asura/WHM server,
// e.g. "ns1.eazworld.com,ns2.eazworld.com".
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
  HOSTING_PLANS,
  getPlanPrice,
  HOSTING_NAMESERVERS,
  LIFECYCLE,
};

