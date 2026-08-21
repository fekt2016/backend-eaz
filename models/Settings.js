const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // ── Maintenance ────────────────────────────────────────────
  maintenanceMode:           { type: Boolean, default: false },
  maintenanceMessage:        { type: String,  default: "We're performing scheduled maintenance. We'll be back shortly!" },
  maintenanceScheduledStart: { type: Date,    default: null },
  maintenanceScheduledEnd:   { type: Date,    default: null },

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
