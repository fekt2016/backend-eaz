const express = require('express');
const { sendMessage, getSessions, getSession, updateSession, deleteSession, adminReply, getMessages, acceptChat, claimSession, rateSession, getChatMetrics } = require('../controllers/chatController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Public
router.post('/', sendMessage);

// Supervisor view (T69) — admin/superadmin only: staff shouldn't read the
// scoreboard they're measured on. Declared before '/sessions/:sessionId' for
// clarity; the paths don't actually collide.
router.get('/metrics', protect, restrictTo('admin'), getChatMetrics);

// Admin + staff (front desk answers customer chats)
router.get('/sessions', protect, restrictTo('admin', 'staff'), getSessions);
router.get('/sessions/:sessionId', protect, restrictTo('admin', 'staff'), getSession);
router.patch('/sessions/:sessionId', protect, restrictTo('admin', 'staff'), updateSession);
// Deliberately NOT opened to staff: T69 measures chat quality from these transcripts,
// so the person being measured must not be able to delete the evidence. Staff can read,
// accept, reply and resolve — destroying the record stays admin/superadmin.
router.delete('/sessions/:sessionId', protect, restrictTo('admin'), deleteSession);
router.post('/sessions/:sessionId/accept', protect, restrictTo('admin', 'staff'), acceptChat);
router.post('/sessions/:sessionId/claim',  protect, restrictTo('admin', 'staff'), claimSession);
router.post('/sessions/:sessionId/reply',  protect, restrictTo('admin', 'staff'), adminReply);

// Public — widget polling for new messages (admin replies)
router.get('/sessions/:sessionId/messages', getMessages);
// Public — the customer rates the closed conversation (T69 phase 4). Same
// cookie-ownership gate as the polling route above: the rater has no account.
router.post('/sessions/:sessionId/rating', rateSession);

module.exports = router;
