const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: [true, 'Order number is required'],
    unique: true,
    trim: true,
    uppercase: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false,
    },
    part: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Part',
      required: false,
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative']
    },
    qty: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1']
    }
  }],
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal cannot be negative']
  },
  deliveryZone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryZone'
  },
  deliveryFee: {
    type: Number,
    default: 0,
    min: [0, 'Delivery fee cannot be negative']
  },
  total: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative']
  },
  customer: {
    name: { type: String, required: [true, 'Customer name is required'], trim: true },
    phone: { type: String, required: [true, 'Phone is required'], trim: true },
    phoneDigits: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' }
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  paystackReference: {
    type: String,
    trim: true
  },
  paidAt: {
    type: Date,
    default: null
  },
  trackingNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true
  },
  trackingHistory: [{
    status: {
      type: String,
      enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending'
    },
    note: {
      type: String,
      trim: true,
      default: ''
    },
    location: {
      type: String,
      trim: true,
      default: ''
    },
    updatedBy: {
      name: { type: String, trim: true, default: '' },
      role: { type: String, trim: true, default: '' }
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

orderSchema.index({ paystackReference: 1 }, { sparse: true });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ trackingNumber: 1 }, { sparse: true });

module.exports = mongoose.model('Order', orderSchema);
