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
    // T45: this line was bought with no stock on hand. It is paid for like any
    // other line, but no stock moves until staff release it once the item lands —
    // so fulfilment skips it and `releasedAt` records when it was actually filled.
    isPreorder: {
      type: Boolean,
      default: false
    },
    preorderReleasedAt: {
      type: Date,
      default: null
    },
    // Which incoming batch this line is waiting on. Staff move the shipment
    // through its stages once and every line attached to it follows, rather than
    // the same container being re-entered on twenty separate orders.
    shipment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shipment',
      default: null
    },
    // Which variant was purchased (structured variants feature). Absent for
    // products bought as a single implicit SKU and for retail parts.
    variant: new mongoose.Schema(
      {
        sku: { type: String, trim: true },
        attributes: { type: Map, of: String, default: {} },
      },
      { _id: false }
    ),
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
  // Whether stock was decremented for this order (set by fulfilShopOrder on
  // pending → paid) and whether it's since been restored (set on cancel).
  // Guards against restocking an order that never had stock deducted, and
  // against double-restocking one that's already been reversed.
  stockDeducted: {
    type: Boolean,
    default: false
  },
  stockRestored: {
    type: Boolean,
    default: false
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
  }],
  // T15 — full-order refunds via Paystack. Not a `status` value: refund is a
  // payment outcome, orthogonal to fulfilment status. `status` here starts
  // 'none' and is atomically claimed to 'processing' before the Paystack call
  // fires (see orderController.refundOrder) so a crash mid-request fails safe
  // (stuck record, no money moved) rather than risking a duplicate refund.
  refund: {
    status: {
      type: String,
      enum: ['none', 'processing', 'completed', 'failed'],
      default: 'none'
    },
    amount:      { type: Number, default: null },  // pesewas, snapshot of order.total
    reference:   { type: String, default: null },  // Paystack refund id
    reason:      { type: String, trim: true, default: '' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
}, {
  timestamps: true,
  // item.variant.attributes is a Map — flatten it in responses so the API
  // serves { color: "Black" }, not an empty {}.
  toObject: { flattenMaps: true },
  toJSON: { flattenMaps: true }
});

orderSchema.index({ paystackReference: 1 }, { sparse: true });
orderSchema.index({ createdAt: -1 });
// trackingNumber already gets a unique sparse index from `unique: true` on the
// field definition — no separate index() call (avoids a duplicate-index warning).

module.exports = mongoose.model('Order', orderSchema);
