/**
 * Business profile — single source of truth for shop identity, contact info,
 * and service pricing. Backed by `Settings.business` (admin-editable via
 * PATCH /api/v1/settings), with an in-memory TTL cache so hot paths (chat
 * replies, SMS/email sends) don't hit the DB on every call.
 *
 * Falls back to env vars (SHOP_NAME/SHOP_PHONE, for deployments that set
 * those instead of using the Settings UI) and finally to hardcoded defaults
 * if Settings hasn't been created yet.
 */
const Settings = require('../models/Settings');

const DEFAULTS = {
  shopName:        process.env.SHOP_NAME  || 'EazWorld Repair',
  shopPhone:       process.env.SHOP_PHONE || '0244388190',
  whatsapp:        '233244388190',
  email:           'hello@eazworld.com',
  location:        'Accra, Ghana',
  hours:           'Monday – Friday, 8am – 6pm GMT',
  consultationPath: '/book-consultation',
  services: [
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
};

const TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _cacheExpiry = 0;

async function getBusinessProfile() {
  const now = Date.now();
  if (_cache && now < _cacheExpiry) return _cache;

  try {
    const settings = await Settings.findOne({ key: 'global' }).select('business').lean();
    const b = settings?.business || {};
    _cache = {
      shopName:         b.shopName || DEFAULTS.shopName,
      shopPhone:        b.shopPhone || DEFAULTS.shopPhone,
      whatsapp:         b.whatsapp || DEFAULTS.whatsapp,
      email:            b.email || DEFAULTS.email,
      location:         b.location || DEFAULTS.location,
      hours:            b.hours || DEFAULTS.hours,
      consultationPath: b.consultationPath || DEFAULTS.consultationPath,
      services:         b.services?.length ? b.services : DEFAULTS.services,
    };
  } catch {
    // DB unreachable — never let a config lookup break chat/notifications.
    _cache = DEFAULTS;
  }
  _cacheExpiry = now + TTL_MS;
  return _cache;
}

/** Called by settingsController after a `business` update so edits apply immediately. */
function clearBusinessProfileCache() {
  _cache = null;
  _cacheExpiry = 0;
}

module.exports = { getBusinessProfile, clearBusinessProfileCache };
