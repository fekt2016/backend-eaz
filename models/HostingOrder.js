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
    enum: ['pending', 'paid', 'active', 'cancelled', 'failed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['paystack_card', 'mobile_money', 'bank_transfer'],
    required: true
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
  }
}, {
  timestamps: true
});

hostingOrderSchema.index({ user: 1, createdAt: -1 });
hostingOrderSchema.index({ status: 1 });
hostingOrderSchema.index({ paystackReference: 1 }, { sparse: true });

module.exports = mongoose.model('HostingOrder', hostingOrderSchema);
