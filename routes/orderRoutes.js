const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  createOrder,
  getOrderByReference,
  trackOrder,
  getOrders,
  getOrder,
  updateOrderStatus
} = require('../controllers/orderController');

const router = express.Router();

router.post('/', createOrder);
router.post('/track', trackOrder);
router.get('/', protect, restrictTo('admin'), getOrders);
router.get('/by-reference/:reference', getOrderByReference);
router.patch('/:id', protect, restrictTo('admin'), updateOrderStatus);
router.get('/:id', protect, restrictTo('admin'), getOrder);

module.exports = router;
