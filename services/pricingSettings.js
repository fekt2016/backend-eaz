/**
 * Live pricing knobs — the USD→GH₵ rate and the domain markup.
 *
 * WHY THIS EXISTS AS A CACHE RATHER THAN A DB READ
 *
 * `usdToGhs()` in services/namecheap.js and config/hostingPlans.js is
 * SYNCHRONOUS, and it is called from getters that render a price list. Making it
 * async would ripple into every caller and every template. So the value is held
 * in process and refreshed, rather than read per call.
 *
 * This mirrors services/shipping/shippingCache.js: a plain in-process value with
 * a TTL, invalidated explicitly whenever an admin writes. The TTL is the safety
 * net for a missed invalidation, not the mechanism.
 *
 * PRECEDENCE: database → hardcoded default.
 *
 * USD_TO_GHS_RATE and DOMAIN_MARKUP are NO LONGER READ (owner decision,
 * 2026-08-31). They were the previous mechanism, and keeping them as a fallback
 * would have meant two places to look when a price is wrong — with the env var
 * silently winning on any deployment where the settings document had not been
 * written yet. One source, and it is the one the admin UI edits.
 *
 * The defaults below are the same 15.5 / 1.2 the env vars carried, and they match
 * the schema defaults in models/Settings.js, so a fresh install prices exactly as
 * before until an admin changes it.
 *
 * SCOPE WARNING: `usdToGhsRate` is shared. It prices domains AND every hosting
 * plan. Changing it moves both. That was already true when it was an env var;
 * surfacing it in an admin UI just makes it easy to do by accident, which is why
 * the UI says so out loud.
 */
const DEFAULTS = { usdToGhsRate: 15.5, domainMarkup: 1.2 };
const TTL_MS = 60_000;

let cache = null;
let cachedAt = 0;

/** The floor when the database has nothing saved yet. */
function fallback() {
  return { ...DEFAULTS };
}

/** Refresh from the database. Safe to call when Mongo is unreachable. */
async function refresh() {
  try {
    // Required lazily: this module is pulled in by config/hostingPlans.js, which
    // is itself required at module load in places — a top-level model import
    // would create a cycle.
    const Settings = require('../models/Settings');
    const doc = await Settings.findOne({ key: 'global' }).select('pricing').lean();
    const base = fallback();
    cache = {
      usdToGhsRate: Number(doc?.pricing?.usdToGhsRate) > 0 ? Number(doc.pricing.usdToGhsRate) : base.usdToGhsRate,
      domainMarkup: Number(doc?.pricing?.domainMarkup) >= 1 ? Number(doc.pricing.domainMarkup) : base.domainMarkup,
    };
    cachedAt = Date.now();
  } catch {
    // A pricing read must never take the app down. Fall back to the defaults
    // rather than leaving prices undefined.
    cache = fallback();
    cachedAt = Date.now();
  }
  return cache;
}

/** Drop the cache so the next read refetches — called after an admin write. */
function invalidate() {
  cache = null;
  cachedAt = 0;
}

/**
 * Synchronous read. Returns the cached values, or the env/default fallback when
 * nothing has been loaded yet (first call before boot refresh completes).
 *
 * A stale read triggers a background refresh rather than blocking: a price that
 * is one minute old is a far smaller problem than a price list that hangs.
 */
function current() {
  if (!cache) return fallback();
  if (Date.now() - cachedAt > TTL_MS) refresh().catch(() => {});
  return cache;
}

const getRate = () => current().usdToGhsRate;
const getMarkup = () => current().domainMarkup;

module.exports = { refresh, invalidate, current, getRate, getMarkup, DEFAULTS };
