/**
 * Hosting order controller barrel. The implementation lives in
 * controllers/hosting/<domain>Controller.js; this file re-exports every handler
 * so the route file's import path is unchanged.
 *
 * This was one 1,197-line file spanning four concerns — the plan catalogue,
 * buying and renewing, what an owner may do with a live account, and admin
 * fulfilment. Split the same way posController and orderController were.
 */
const plansController    = require('./hosting/plansController');
const purchaseController = require('./hosting/purchaseController');
const accountController  = require('./hosting/accountController');
const adminController    = require('./hosting/adminController');

module.exports = {
  ...plansController,
  ...purchaseController,
  ...accountController,
  ...adminController,
};
