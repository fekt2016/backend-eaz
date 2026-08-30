const Notification = require('../models/Notification');

// GET /api/v1/notifications?unreadOnly=&page=&limit=
const getNotifications = async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const filter = {
      recipient: req.user._id,
      ...(req.query.unreadOnly === 'true' ? { read: false } : {}),
    };

    const [items, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    res.json({ success: true, data: items, total, page, limit });
  } catch (err) { next(err); }
};

// GET /api/v1/notifications/unread-count — cheap poll target for a bell badge.
const getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.user._id, read: false });
    res.json({ success: true, data: { count } });
  } catch (err) { next(err); }
};

// PATCH /api/v1/notifications/:id/read
const markRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, error: 'Notification not found.' });
    res.json({ success: true, data: notification });
  } catch (err) { next(err); }
};

// PATCH /api/v1/notifications/read-all
const markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};

module.exports = { getNotifications, getUnreadCount, markRead, markAllRead };
