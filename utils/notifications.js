const Notification = require('../models/Notification');
const User = require('../models/User');

// Canonical notification-type vocabulary — reuse these at call sites (mirrors
// services/activityLogService.js's ACTIONS pattern). Add new triggers here as
// they're wired up (see backend-eaz/tasks.md T12 for scope).
const NOTIFICATION_TYPES = {
  JOB_ASSIGNED: 'job_assigned',
  NEW_ORDER:    'new_order',
};

// Best-effort — a failure to persist a notification must never break the
// business action that triggered it (mirrors services/notify.js's SMS
// fallback behaviour).
async function notify(recipientIds, { type, title, body = '', link = null, resourceType = '', resourceId = '' }) {
  const unique = [...new Set(
    (Array.isArray(recipientIds) ? recipientIds : [recipientIds])
      .filter(Boolean)
      .map(String)
  )];
  if (!unique.length) return;

  try {
    await Notification.insertMany(
      unique.map((recipient) => ({ recipient, type, title, body, link, resourceType, resourceId }))
    );
  } catch (err) {
    console.error('[notifications] failed to create notification:', err.message);
  }
}

// Notify every user currently in one of the given roles (e.g. every admin/staff).
async function notifyRoles(roles, payload) {
  const users = await User.find({ role: { $in: roles } }).select('_id');
  await notify(users.map((u) => u._id), payload);
}

module.exports = { notify, notifyRoles, NOTIFICATION_TYPES };
