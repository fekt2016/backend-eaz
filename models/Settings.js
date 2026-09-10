const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // ── Maintenance ────────────────────────────────────────────
  maintenanceMode:           { type: Boolean, default: false },
  maintenanceMessage:        { type: String,  default: "We're performing scheduled maintenance. We'll be back shortly!" },
  maintenanceScheduledStart: { type: Date,    default: null },
  maintenanceScheduledEnd:   { type: Date,    default: null },

  // ── Pricing knobs (owner request 2026-08-31) ──────────────────────────
  //
  // These were env vars (USD_TO_GHS_RATE, DOMAIN_MARKUP) until 2026-08-31, which meant every
  // cedi move needed a redeploy — and a rate that is awkward to change is a rate
  // that goes stale, quietly eating the margin it was meant to protect.
  //
  // `usdToGhsRate` is SHARED: it prices domains AND every hosting plan, because
  // config/hostingPlans.js converts with the same number. Changing it moves both.
  // That is existing behaviour, not something introduced here, but it is the
  // reason the admin UI labels it plainly rather than filing it under "domains".
  //
  // `domainMarkup` is domains only — 1.2 means a 20% margin on top of cost.
  //
  // Bounds are deliberate. A rate of 0 would make every price free; a markup
  // below 1 would sell below cost, which is the one mistake that cannot be
  // recovered from after the fact.
  pricing: {
    usdToGhsRate: {
      type: Number,
      default: 15.5,
      min: [1, 'Exchange rate must be at least 1'],
      max: [1000, 'Exchange rate looks wrong — above 1000'],
    },
    domainMarkup: {
      type: Number,
      default: 1.2,
      min: [1, 'Markup below 1 would sell domains below cost'],
      max: [10, 'Markup above 10x looks wrong'],
    },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },

  // ── Business profile (shop identity + service pricing — read by the chat
  //    knowledge base and customer notification service instead of each
  //    hardcoding their own copy) ────────────────────────────────────────
  business: {
    shopName:         { type: String, default: 'EazWorld Repair' },
    shopPhone:         { type: String, default: '0244388190' },
    whatsapp:          { type: String, default: '233244388190' },
    email:             { type: String, default: 'hello@eazworld.com' },
    location:          { type: String, default: 'Accra, Ghana' },
    hours:             { type: String, default: 'Monday – Friday, 8am – 6pm GMT' },
    consultationPath:  { type: String, default: '/book-consultation' },
    // ── Tax / VAT (T14 — display-only; nothing reads these into order/invoice
    //    totals math. A future task decides where, if anywhere, to surface them.)
    vatEnabled:        { type: Boolean, default: false },
    vatRate:           { type: Number,  default: 0, min: 0, max: 100 }, // percentage
    vatNumber:         { type: String,  default: '' },                  // TIN / VAT reg. number
    pricesIncludeVat:  { type: Boolean, default: true },                 // informational label only
    services: {
      type: [{
        name:  { type: String, required: true },
        price: { type: String, required: true },
        path:  { type: String, required: true },
        _id: false,
      }],
      default: [
        { name: 'Web Design & Development', price: 'Starting from GHS 1,500', path: '/services/web-design' },
        { name: 'SEO', price: 'GHS 800 – 2,000/month', path: '/services/seo' },
        { name: 'Paid Advertising', price: 'GHS 800 – 2,000/month (management fee)', path: '/services/paid-ads' },
        { name: 'Branding', price: 'GHS 500 – 3,500 (one-time)', path: '/services/branding' },
        { name: 'Social Media Management', price: 'GHS 600 – 1,500/month', path: '/services/social-media' },
        { name: 'Email Marketing', price: 'GHS 500 – 1,200/month', path: '/services/email' },
        { name: 'Phone Repair', price: 'Varies by device — walk-ins welcome', path: '/services/phone-repair' },
        { name: 'Web Hosting', price: 'Starting from GHS 150/year', path: '/hosting' },
        { name: 'Domain Registration', price: 'Starting from GHS 80/year', path: '/domains' },
      ],
    },
  },

  // ── Homepage hero carousel (owner request 2026-09-10) ───────────────────────
  //
  // The slides used to be a hardcoded array inside HeroCarousel.jsx, so changing
  // a headline or a photo meant a frontend deploy. They live here instead: this
  // document is already the one thing the owner can edit without a redeploy, and
  // the hero is the copy that changes most often.
  //
  // `icon` is a NAME, not a component — the frontend resolves it against a
  // whitelist of lucide icons (lib/heroSlides.js). An unknown name falls back to
  // a default icon rather than crashing the homepage.
  //
  // `href` is validated as a site-relative path in the controller: this array is
  // rendered straight into <Link href> and an absolute or javascript: URL here
  // would turn the hero into an open redirect.
  homeHero: {
    slides: {
      type: [{
        icon:        { type: String, default: 'Palette', trim: true },
        service:     { type: String, required: true, trim: true },
        headline:    { type: String, required: true, trim: true },
        description: { type: String, default: '', trim: true },
        cta:         { type: String, default: 'Learn more', trim: true },
        href:        { type: String, default: '/', trim: true },
        image:       { type: String, default: '', trim: true },
        accent:      { type: String, default: '#F5A623', trim: true },
        bg:          { type: String, default: '#fffbf5', trim: true },
        _id: false,
      }],
      // Seeded with exactly what HeroCarousel shipped with, so an existing
      // install looks identical the moment this deploys and the admin edits from
      // the real copy rather than an empty form.
      default: [
        {
          icon: 'Palette', service: 'Web Design',
          headline: 'Websites That Win Clients',
          description: 'We design fast, modern websites that make your business look credible and convert visitors into customers.',
          cta: 'See Web Design', href: '/services/web-design',
          image: '/images/hero/web-design.png', accent: '#F5A623', bg: '#fffbf5',
        },
        {
          icon: 'Search', service: 'SEO',
          headline: 'Get Found on Google',
          description: 'Rank higher, attract the right traffic, and grow organic revenue — with SEO built specifically for Ghanaian businesses.',
          cta: 'Explore SEO', href: '/services/seo',
          image: '/images/hero/seo.png', accent: '#10b981', bg: '#f0fdf4',
        },
        {
          icon: 'Megaphone', service: 'Paid Advertising',
          headline: 'Ads That Actually Convert',
          description: 'Google and Meta campaigns targeted precisely to your audience — every cedi of your budget working hard.',
          cta: 'Run Better Ads', href: '/services/paid-ads',
          image: '/images/hero/paid-ads.png', accent: '#3b82f6', bg: '#eff6ff',
        },
        {
          icon: 'Star', service: 'Branding',
          headline: 'A Brand Worth Remembering',
          description: 'Logo, identity, and brand strategy that tells your story clearly and sets you apart from the competition.',
          cta: 'Build Your Brand', href: '/services/branding',
          image: '/images/hero/branding.png', accent: '#8b5cf6', bg: '#f5f3ff',
        },
        {
          icon: 'Hash', service: 'Social Media',
          headline: 'Grow Your Audience Daily',
          description: 'Consistent, creative social media management that builds community, trust, and engagement around your brand.',
          cta: 'Grow Social', href: '/services/social-media',
          image: '/images/hero/social-media.png', accent: '#ec4899', bg: '#fdf2f8',
        },
        {
          icon: 'Mail', service: 'Email Marketing',
          headline: 'Turn Subscribers Into Buyers',
          description: 'Strategic email campaigns that nurture leads, re-engage customers, and drive repeat revenue on autopilot.',
          cta: 'Start Email', href: '/services/email',
          image: '/images/hero/email-marketing.png', accent: '#f59e0b', bg: '#fffbeb',
        },
        {
          icon: 'Smartphone', service: 'Phone Repair',
          headline: 'Your Phone Fixed Today',
          description: 'Fast, reliable phone repair in Accra. All major brands, 30-day warranty, honest pricing. Walk-ins welcome.',
          cta: 'Get a Repair', href: '/services/phone-repair',
          image: '/images/hero/phone-repair.png', accent: '#06b6d4', bg: '#ecfeff',
        },
      ],
    },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
}, { timestamps: true });

/**
 * Compute whether maintenance is currently active based on:
 *  1. maintenanceMode manually set to true, OR
 *  2. Current time falls within the scheduled window
 */
settingsSchema.virtual('maintenanceActive').get(function () {
  const now = new Date();
  if (this.maintenanceMode) return true;
  if (this.maintenanceScheduledStart && this.maintenanceScheduledEnd) {
    return now >= this.maintenanceScheduledStart && now <= this.maintenanceScheduledEnd;
  }
  if (this.maintenanceScheduledStart && !this.maintenanceScheduledEnd) {
    return now >= this.maintenanceScheduledStart;
  }
  return false;
});

settingsSchema.set('toJSON',   { virtuals: true });
settingsSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Settings', settingsSchema);
