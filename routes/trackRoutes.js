const express        = require('express');
const { getJobByToken, createPartOrder, getMyRepairs } = require('../controllers/posController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Logged-in customer's own repairs (must come before the public /:token route)
router.get('/mine', protect, getMyRepairs);

// Public — no authentication required
router.get('/:token', getJobByToken);
router.post('/:token/part-orders', createPartOrder);

module.exports = router;
