const express = require('express');
const { sendMessage, getSessions, getSession, updateSession, deleteSession, adminReply, getMessages, acceptChat } = require('../controllers/chatController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Public
router.post('/', sendMessage);

// Admin only
router.get('/sessions', protect, restrictTo('admin'), getSessions);
router.get('/sessions/:sessionId', protect, restrictTo('admin'), getSession);
router.patch('/sessions/:sessionId', protect, restrictTo('admin'), updateSession);
router.delete('/sessions/:sessionId', protect, restrictTo('admin'), deleteSession);
router.post('/sessions/:sessionId/accept', protect, restrictTo('admin'), acceptChat);
router.post('/sessions/:sessionId/reply',  protect, restrictTo('admin'), adminReply);

// Public — widget polling for new messages (admin replies)
router.get('/sessions/:sessionId/messages', getMessages);

module.exports = router;
