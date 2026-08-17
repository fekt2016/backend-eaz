const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { getActivityLogs } = require('../controllers/activityLogController');

const router = express.Router();

// Admin + SuperAdmin only. restrictTo('admin') implicitly allows superadmin
// (see middleware/auth.js). Read-only — audit records are immutable and there
// is intentionally no create/update/delete route here.
router.get('/', protect, restrictTo('admin'), getActivityLogs);

module.exports = router;
