const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema(
  {
    to:      { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'welcome',
        'account_created',
        'password_reset',
        'two_factor',
        'contact_admin',
        'contact_autoreply',
        'order_confirmation',
        'payment_received',
        'hosting_credentials',
        'renewal_reminder',
        'expired_notice',
        'other',
      ],
      default: 'other',
    },
    status:    { type: String, enum: ['sent', 'failed'], default: 'sent' },
    error:     { type: String, default: null },
    orderId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    meta:      { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

emailLogSchema.index({ createdAt: -1 });
emailLogSchema.index({ to: 1 });
emailLogSchema.index({ type: 1 });
emailLogSchema.index({ status: 1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
