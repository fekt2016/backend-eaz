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

router.post('/payment', protect, denyRoles('technician'), createDomainPayment);

router.get('/my', protect, denyRoles('technician'), getMyRegisteredDomains);
router.get('/orders', protect, denyRoles('technician'), getDomainOrders);
router.get('/orders/:id', protect, denyRoles('technician'), getDomainOrder);
router.patch('/orders/:id/status', protect, restrictTo('admin'), updateOrderStatus);
router.post('/orders/:id/retry-registration', protect, restrictTo('admin'), retryDomainRegistration);

module.exports = router;
