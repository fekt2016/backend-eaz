const crypto = require('crypto');

/**
 * Public tracking number for a shop order: `EZWTRK-<base36 time><6 hex>`.
 *
 * Lives here rather than in orderController because two callers need the exact
 * same format — order creation, and scripts/backfillOrderTrackingNumbers.js,
 * which fills the field in for orders created before it existed. A second
 * hand-rolled copy would drift.
 *
 * `Order.trackingNumber` is a unique sparse index, so callers generating many in
 * one loop should still handle a duplicate-key rejection: the timestamp half is
 * identical within a millisecond, leaving only 3 random bytes between two
 * numbers minted back to back.
 */
function generateTrackingNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EZWTRK-${ts}${rand}`;
}

module.exports = { generateTrackingNumber };
