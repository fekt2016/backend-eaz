const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { upload } = require('../controllers/uploadController');
const { getPlans, createOrder, getOrders, getOrder, getOrderByReference, getInvoice, updateOrderStatus, uploadOrderProof } = require('../controllers/hostingOrderController');

const router = express.Router();

router.get('/plans', getPlans);
router.post('/orders', protect, createOrder);
router.get('/orders', protect, getOrders);
router.get('/orders/by-reference/:reference', protect, getOrderByReference);
router.get('/orders/:id/invoice', protect, getInvoice);
router.get('/orders/:id', protect, getOrder);
router.post('/orders/:id/proof', protect, upload.single('proof'), uploadOrderProof);
router.patch('/orders/:id', protect, restrictTo('admin'), updateOrderStatus);

module.exports = router;
