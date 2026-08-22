const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} = require('../controllers/notificationController');

const router = express.Router();

router.get('/', protect, getNotifications);
router.get('/unread-count', protect, getUnreadCount);
router.patch('/read-all', protect, markAllRead);
router.patch('/:id/read', protect, markRead);

module.exports = router;
