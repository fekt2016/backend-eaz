const mongoose = require('mongoose');

// Immutable audit record for important business/security actions. Append-only —
// there is intentionally no update/delete route exposed anywhere in the API.
// Stores a snapshot of the actor so the record stays meaningful even if the
// acting user is later deleted, renamed, or blocked.
const changeSchema = new mongoose.Schema(
  {
    field:  { type: String, trim: true, default: '' }, // machine key, e.g. "status"
    label:  { type: String, trim: true, default: '' }, // human label, e.g. "Order Status"
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after:  { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const activityLogSchema = new mongoose.Schema(
  {
    // ── Actor snapshot (denormalised for durability) ────────────────────
    actorUser:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName:  { type: String, trim: true, default: '' },
    actorEmail: { type: String, trim: true, lowercase: true, default: '' },
    actorRole:  { type: String, trim: true, default: '' }, // 'system' when no user

    // ── Event ───────────────────────────────────────────────────────────
    action:       { type: String, required: true, trim: true, index: true },
    resourceType: { type: String, trim: true, default: '' },
    // Stored as a string so it can hold order numbers, tracking numbers,
    // job numbers, or Mongo ids uniformly.
    resourceId:   { type: String, trim: true, default: '' },
    resourceName: { type: String, trim: true, default: '' },
    description:  { type: String, trim: true, maxlength: 1000, default: '' },

    // ── Before/after for update events (only changed fields) ────────────
    changes: { type: [changeSchema], default: [] },

    // ── Extra structured context (never secrets) ─────────────────────────
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── Outcome ──────────────────────────────────────────────────────────
    status: { type: String, enum: ['success', 'failure'], default: 'success', index: true },

    // ── Request provenance ───────────────────────────────────────────────
    ip:        { type: String, trim: true, default: '' },
    userAgent: { type: String, trim: true, default: '', maxlength: 500 },
    requestId: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

// Indexes match the admin query patterns: newest-first with common filters.
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actorUser: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ resourceType: 1, createdAt: -1 });
activityLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
activityLogSchema.index({ status: 1, createdAt: -1 });
activityLogSchema.index({ actorRole: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
