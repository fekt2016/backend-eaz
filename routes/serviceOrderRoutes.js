const express = require('express');
const { createServicePayment, getServiceOrders, updateServiceOrder } = require('../controllers/serviceOrderController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Public — guest or logged-in user can pay
router.post('/payment', createServicePayment);

// Admin only
router.get('/orders',        protect, restrictTo('admin'), getServiceOrders);
router.patch('/orders/:id',  protect, restrictTo('admin'), updateServiceOrder);

module.exports = router;
