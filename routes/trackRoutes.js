const express        = require('express');
const { getJobByToken, createPartOrder } = require('../controllers/posController');

const router = express.Router();

// Public — no authentication required
router.get('/:token', getJobByToken);
router.post('/:token/part-orders', createPartOrder);

module.exports = router;
