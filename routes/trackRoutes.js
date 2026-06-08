const express        = require('express');
const { getJobByToken } = require('../controllers/posController');

const router = express.Router();

// Public — no authentication required
router.get('/:token', getJobByToken);

module.exports = router;
