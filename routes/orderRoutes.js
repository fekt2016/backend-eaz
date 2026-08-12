const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  createOrder,
  getMyOrders,
  getOrderByReference,
  trackOrder,
  getOrders,
  getOrder,
  updateOrderStatus
} = require('../controllers/orderController');

const router = express.Router();

router.post('/', createOrder);
router.post('/track', trackOrder);
router.get('/mine', protect, getMyOrders); // logged-in customer's own shop orders
router.get('/', protect, restrictTo('admin', 'staff'), getOrders);
router.get('/by-reference/:reference', getOrderByReference);
router.patch('/:id', protect, restrictTo('admin', 'staff'), updateOrderStatus);
router.get('/:id', protect, restrictTo('admin', 'staff'), getOrder);

module.exports = router;
