/**
 * POS controller barrel. The implementation lives in controllers/pos/<domain>Controller.js;
 * this file re-exports every handler so the route files import path is unchanged.
 */
const customerController = require('./pos/customerController');
const jobController = require('./pos/jobController');
const inventoryController = require('./pos/inventoryController');
const staffController = require('./pos/staffController');
const salesController = require('./pos/salesController');
const paymentController = require('./pos/paymentController');
const expenseController = require('./pos/expenseController');
const reportsController = require('./pos/reportsController');

module.exports = {
  ...customerController,
  ...jobController,
  ...inventoryController,
  ...staffController,
  ...salesController,
  ...paymentController,
  ...expenseController,
  ...reportsController,
};
