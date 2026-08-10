const HOSTING_PLANS = {
  shared: {
    deluxe: {
      name: 'Deluxe',
      tagline: 'Best price for a basic website.',
      monthlyPrice: 9,
      annualPrice: 108,
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
      monthlyPrice: 16,
      annualPrice: 192,
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
      monthlyPrice: 32,
      annualPrice: 384,
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
      monthlyPrice: 62,
      annualPrice: 744,
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
      monthlyPrice: 280,
      annualPrice: 3360,
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
      monthlyPrice: 550,
      annualPrice: 6600,
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
      monthlyPrice: 950,
      annualPrice: 11400,
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
      monthlyPrice: 420,
      annualPrice: 5040,
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
      monthlyPrice: 850,
      annualPrice: 10200,
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
      monthlyPrice: null,
      annualPrice: null,
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
      monthlyPrice: 45,
      annualPrice: 540,
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
      monthlyPrice: 95,
      annualPrice: 1140,
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
      monthlyPrice: 185,
      annualPrice: 2220,
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
      monthlyPrice: 25,
      annualPrice: 300,
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
      monthlyPrice: 55,
      annualPrice: 660,
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
      monthlyPrice: 120,
      annualPrice: 1440,
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

function getPlanPrice(planType, tier, billingCycle) {
  const typeGroup = HOSTING_PLANS[planType];
  if (!typeGroup) {
    throw new Error(`Unknown hosting plan type: ${planType}`);
  }
  const plan = typeGroup[tier];
  if (!plan) {
    throw new Error(`Unknown hosting plan tier: ${tier} for type ${planType}`);
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

