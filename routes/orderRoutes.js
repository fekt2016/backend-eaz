const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createOrderSchema, trackOrderSchema } = require('../validation/orderSchema');
const {
  createOrder,
  getMyOrders,
  getMyOrderById,
  getOrderByReference,
  trackOrder,
  getOrderTracking,
  getOrders,
  getPreorders,
  getPreorderCount,
  releasePreorder,
  getOrder,
  updateOrderStatus,
  addTrackingEvent,
  refundOrder,
  syncRefund,
  changeOrderAddress
} = require('../controllers/orderController');

const router = express.Router();

router.post('/', validate(createOrderSchema), createOrder);
router.post('/track', validate(trackOrderSchema), trackOrder);
router.get('/track/:trackingNumber', getOrderTracking); // public — must stay before /:id
router.get('/mine', protect, getMyOrders); // logged-in customer's own shop orders
router.get('/mine/:id', protect, getMyOrderById); // a customer's own order detail
router.get('/', protect, restrictTo('admin', 'staff'), getOrders);
// T45 — pre-order release queue. Must precede '/:id', or Express reads
// "preorders" as an order id.
router.get('/preorders', protect, restrictTo('admin', 'staff'), getPreorders);
// Feeds the badge on the Orders nav item. Above `/:id` for the same reason.
router.get('/preorders/count', protect, restrictTo('admin', 'staff'), getPreorderCount);
router.patch('/:id/preorder-release', protect, restrictTo('admin', 'staff'), releasePreorder);
router.get('/by-reference/:reference', getOrderByReference);
router.post('/:id/tracking', protect, restrictTo('admin', 'staff'), addTrackingEvent);
router.patch('/:id', protect, restrictTo('admin', 'staff'), updateOrderStatus);
router.patch('/:id/address', protect, restrictTo('admin', 'staff'), changeOrderAddress);
// Refunds move real money and are irreversible — admin only, staff excluded
// (narrower than the other order-management routes above).
router.post('/:id/refund', protect, restrictTo('admin'), refundOrder);
router.post('/:id/refund/sync', protect, restrictTo('admin'), syncRefund);
router.get('/:id', protect, restrictTo('admin', 'staff'), getOrder);

module.exports = router;
