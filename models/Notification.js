const mongoose = require('mongoose');

// Per-user in-app alert (T12). Server-created only — no client-writable
// fields beyond read/readAt (see controllers/notificationController.js).
// `type` is a free-form indexed string, same convention as ActivityLog's
// `action` field — the canonical vocabulary lives in
// utils/notifications.js's NOTIFICATION_TYPES.
const notificationSchema = new mongoose.Schema(
  {
    recipient:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type:         { type: String, required: true, trim: true },
    title:        { type: String, required: true, trim: true, maxlength: 200 },
    body:         { type: String, trim: true, maxlength: 500, default: '' },
    link:         { type: String, trim: true, default: null },
    resourceType: { type: String, trim: true, default: '' },
    resourceId:   { type: String, trim: true, default: '' },
    read:         { type: Boolean, default: false },
    readAt:       { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1 });
// Auto-expire read notifications 90 days after they were read, so the inbox
// doesn't grow unbounded. Unread notifications never expire — the partial
// filter excludes read:false, so nothing disappears before it's been seen.
notificationSchema.index(
  { readAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90, partialFilterExpression: { read: true } }
);

module.exports = mongoose.model('Notification', notificationSchema);
