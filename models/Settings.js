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
