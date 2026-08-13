const express        = require('express');
const { getJobByToken, createPartOrder, getMyRepairs, createPublicJob, getPublicParts, createRepairOrder, createBalancePayment } = require('../controllers/posController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Logged-in customer's own repairs (must come before the public /:token route)
router.get('/mine', protect, getMyRepairs);

// Public — no authentication required
router.post('/repair-requests', createPublicJob); // self-serve job intake (bring / rider)
router.get('/parts', getPublicParts);             // orderable parts catalogue (before /:token)
router.get('/:token', getJobByToken);
router.post('/:token/part-orders', createPartOrder);
router.post('/:token/orders', createRepairOrder); // prepay parts (+ rider shipping) in one go
router.post('/:token/balance-payment', createBalancePayment); // pay outstanding invoice balance

module.exports = router;
