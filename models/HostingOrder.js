const mongoose = require('mongoose');

const hostingOrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  planType: {
    type: String,
    required: true,
    trim: true,
    enum: ['shared', 'vps', 'cloud', 'wordpress', 'email']
  },
  tier: {
    type: String,
    required: true,
    trim: true
  },
  billingCycle: {
    type: String,
    required: true,
    enum: ['monthly', 'annual']
  },
  addons: [{
    id: String,
    name: String,
    price: { type: Number, default: 0 }
  }],
  customer: {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'Ghana' }
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'GHS'
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'active', 'suspended', 'cancelled', 'terminated', 'failed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['paystack_card', 'mobile_money', 'bank_transfer', 'cash'],
    required: true
  },
  // Set when a staff/admin created this order on a customer's behalf (in-store).
  createdByStaff: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  paystackReference: {
    type: String,
    trim: true
  },
  paidAt: {
    type: Date,
    default: null
  },
  bankTransferVerifiedAt: {
    type: Date,
    default: null
  },
  proofUploadUrl: {
    type: String,
    trim: true,
    default: null
  },
  proofUploadedAt: {
    type: Date,
    default: null
  },
  domain: {
    type: String,
    trim: true,
    lowercase: true,
    default: null
  },
  // 'new'  = register domain for customer (bundled into this order)
  // 'own'  = customer already owns it, needs to update nameservers manually
  // 'skip' = no domain attached yet
  domainMode: {
    type: String,
    enum: ['new', 'own', 'skip'],
    default: 'skip'
  },
  domainRegistrationFee: {
    type: Number,
    default: 0
  },
  domainRegistrationYears: {
    type: Number,
    default: 1
  },
  domainRegistered: {
    type: Boolean,
    default: false
  },
  domainRegistrationError: {
    type: String,
    default: null
  },
  // Subscription lifecycle
  expiresAt: {
    type: Date,
    default: null
  },
  renewedAt: {
    type: Date,
    default: null
  },
  // 'none' | 'sent_30d' | 'sent_7d' | 'sent_1d'
  renewalReminderSent: {
    type: String,
    enum: ['none', 'sent_30d', 'sent_7d', 'sent_1d'],
    default: 'none'
  },
  // Link to the renewal order that extended this subscription
  renewalOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HostingOrder',
    default: null
  },
  // If this order IS a renewal, link back to the original
  parentOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HostingOrder',
    default: null
  },

  provisioningStatus: {
    type: String,
    enum: ['not_started', 'pending', 'provisioned', 'failed', 'skipped'],
    default: 'not_started'
  },
  provisioningStartedAt: {
    type: Date,
    default: null
  },
  provisionedAt: {
    type: Date,
    default: null
  },
  cpanelUsername: {
    type: String,
    trim: true,
    default: null
  },
  provisioningError: {
    type: String,
    default: null
  },
  // Expiry lifecycle (grace → suspend → terminate)
  suspendedAt: {
    type: Date,
    default: null
  },
  terminatedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

hostingOrderSchema.index({ user: 1, createdAt: -1 });
hostingOrderSchema.index({ status: 1 });
hostingOrderSchema.index({ paystackReference: 1 }, { sparse: true });
hostingOrderSchema.index({ expiresAt: 1, status: 1 }); // for renewal reminders & expiry checks

module.exports = mongoose.model('HostingOrder', hostingOrderSchema);
