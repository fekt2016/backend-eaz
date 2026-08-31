const express = require('express');
const {
  checkDomain,
  checkDomainBatch,
  checkDomainBulk,
  searchDomain,
  suggestDomain,
  createDomainPayment,
  getDomainOrders,
  getDomainOrder,
  getMyRegisteredDomains,
  updateOrderStatus,
  retryDomainRegistration,
} = require('../controllers/domainController');
const { protect, restrictTo, denyRoles } = require('../middleware/auth');
const namecheap = require('../services/namecheap');
const { validate } = require('../middleware/validate');
const { paymentSchema } = require('../validation/domainSchema');

const router = express.Router();

// Debug route — admin only, shows raw Namecheap pricing response
router.get('/pricing-debug', protect, restrictTo('admin'), async (req, res) => {
  try {
    const prices = await namecheap.getPricing();
    res.json({ count: Object.keys(prices).length, prices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check', checkDomain);
router.get('/search', searchDomain);
router.get('/suggest', suggestDomain);
router.post('/check/batch', checkDomainBatch);
router.post('/check-bulk', checkDomainBulk);

// T126 — also written and never wired. Checked against the real caller before
// connecting it (components/CheckoutForm.jsx): it sends domain, email, amount,
// currency, firstName, lastName, phone, years and registrantInfo, so the
// schema's required `email` and `amount` are satisfied and nothing it declares
// is missing. This is a money path — a domain registration spends real money at
// the registrar — so `amount` being a positive number rather than whatever the
// client sent is worth asserting before the controller reads it.
router.post('/payment', protect, denyRoles('technician'), validate(paymentSchema), createDomainPayment);

router.get('/my', protect, denyRoles('technician'), getMyRegisteredDomains);
router.get('/orders', protect, denyRoles('technician'), getDomainOrders);
router.get('/orders/:id', protect, denyRoles('technician'), getDomainOrder);
router.patch('/orders/:id/status', protect, restrictTo('admin'), updateOrderStatus);
router.post('/orders/:id/retry-registration', protect, restrictTo('admin'), retryDomainRegistration);

module.exports = router;
