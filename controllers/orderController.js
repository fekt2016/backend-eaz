/**
 * Order controller barrel. The implementation lives in
 * controllers/orders/<domain>Controller.js; this file re-exports every handler
 * so the route files' import path is unchanged.
 *
 * This was one 2,150-line file spanning four unrelated concerns — placing an
 * order, what a customer may see of it, pre-orders, and admin fulfilment. The
 * POS controllers were split the same way for the same reason; this follows
 * that shape rather than inventing a second one.
 */
const checkoutController = require('./orders/checkoutController');
const trackingController = require('./orders/trackingController');
const preorderController = require('./orders/preorderController');
const adminController    = require('./orders/adminController');

// Re-exported from the shared module rather than the utils directly: it was
// exported from this file before the split, and routes/tests may reach for it.
const { normalizePhone } = require('./orders/common');

module.exports = {
  ...checkoutController,
  ...trackingController,
  ...preorderController,
  ...adminController,
  normalizePhone,
};
