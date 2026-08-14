const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  createOrder,
  getMyOrders,
  getMyOrderById,
  getOrderByReference,
  trackOrder,
  getOrderTracking,
  getOrders,
  getOrder,
  updateOrderStatus,
  addTrackingEvent
} = require('../controllers/orderController');

const router = express.Router();

router.post('/', createOrder);
router.post('/track', trackOrder);
router.get('/track/:trackingNumber', getOrderTracking); // public — must stay before /:id
router.get('/mine', protect, getMyOrders); // logged-in customer's own shop orders
router.get('/mine/:id', protect, getMyOrderById); // a customer's own order detail
router.get('/', protect, restrictTo('admin', 'staff'), getOrders);
router.get('/by-reference/:reference', getOrderByReference);
router.post('/:id/tracking', protect, restrictTo('admin', 'staff'), addTrackingEvent);
router.patch('/:id', protect, restrictTo('admin', 'staff'), updateOrderStatus);
router.get('/:id', protect, restrictTo('admin', 'staff'), getOrder);

module.exports = router;
