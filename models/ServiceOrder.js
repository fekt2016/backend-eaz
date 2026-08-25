const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema({
  // Customer info
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, trim: true, lowercase: true },
  phone:        { type: String, trim: true },
  businessName: { type: String, trim: true },

  // Service details
  service:      { type: String, required: true, default: 'Web Design' },
  package:      { type: String, required: true }, // Landing Page, Business Website, etc.
  notes:        { type: String, trim: true },      // extra requirements from customer

  // ── Money: intentional exception to the app-wide integer-pesewas rule ──
  // depositAmount/totalAmount store major GHS floats, not pesewas. Decided
  // 2026-08-25 (T44) to leave this as-is — see the matching comment on
  // `HostingOrder.amount` for the full reasoning (PHASE7 Group C precedent,
  // live-money migration risk) and `controllers/webhookController.js`'s
  // `amountMismatch` comment for the read-side of this split. The
  // `*Pesewas` fields below are the actual pesewas values, computed once
  // at order creation.
  depositAmount: { type: Number, required: true }, // amount paid upfront
  totalAmount:   { type: Number, required: true }, // full project price (starting from)
  depositAmountPesewas: { type: Number, default: null },
  totalAmountPesewas:   { type: Number, default: null },

  // Payment
  paystackReference: { type: String, unique: true, sparse: true },
  status: {
    type: String,
    enum: ['pending', 'paid', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  paidAt: { type: Date },

  // Optional link to user account
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Admin
  adminNote: { type: String, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);
