const express = require('express');
const {
  checkDomain,
  checkDomainBatch,
  checkDomainBulk,
  searchDomain,
  suggestDomain,
  createDomainPayment,
  handlePaystackWebhook,
  getDomainOrders,
  getDomainOrder,
  updateOrderStatus,
} = require('../controllers/domainController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.get('/check', checkDomain);
router.get('/search', searchDomain);
router.get('/suggest', suggestDomain);
router.post('/check/batch', checkDomainBatch);
router.post('/check-bulk', checkDomainBulk);

router.post('/payment', createDomainPayment);
router.post('/webhook', handlePaystackWebhook);

router.get('/orders', protect, restrictTo('admin'), getDomainOrders);
router.get('/orders/:id', getDomainOrder);
router.patch('/orders/:id/status', protect, restrictTo('admin'), updateOrderStatus);

module.exports = router;
