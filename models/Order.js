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
      ref: 'Product',
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
  // ── Legacy delivery fields (deprecated — kept for backward compat with old
  //    admin views; synced from shippingFee by the pre-save hook below) ──────
  deliveryZone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryZone'
  },
  /** @deprecated Use shippingFee. Synced automatically by pre-save hook. */
  deliveryFee: {
    type: Number,
    default: 0,
    min: [0, 'Delivery fee cannot be negative']
  },

  // ── T78 shipping fields ──────────────────────────────────────────────────
  // These are the authoritative shipping figures. The calculator writes them;
  // the pre-save hook copies shippingFee → deliveryFee for legacy compat.
  shippingFee: {
    type: Number,
    default: 0,
    min: [0, 'Shipping fee cannot be negative'],
    validate: {
      validator: (v) => Number.isInteger(v),
      message: 'Shipping fee must be a whole number in pesewas',
    },
  },
  shippingZoneCode: {
    type: String,
    trim: true,
    default: null,
  },
  shippingZoneName: {
    type: String,
    trim: true,
    default: null,
  },
  shippingNeighborhood: {
    type: String,
    trim: true,
    default: null,
  },
  shippingMethod: {
    type: String,
    enum: {
      values: ['in_house_delivery', 'courier_dispatch', 'bus_station_pickup', null],
      message: 'Shipping method must be one of: {VALUES}',
    },
    default: null,
  },
  shippingSpeed: {
    type: String,
    enum: {
      values: ['standard', 'same_day', 'next_day', 'express', null],
      message: 'Shipping speed must be one of: {VALUES}',
    },
    default: 'standard',
  },
  // The ShippingQuote doc that was consumed to produce these figures. Null when
  // the legacy deliveryZone path was used or when shipping was manually set.
  shippingQuoteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShippingQuote',
    default: null,
  },
  shippingWeightKg: {
    type: Number,
    default: 0,
    min: 0,
  },
  shippingTierLevel: {
    type: Number,
    default: 0,
  },

  // ── T80 E2 pickup-fulfilment fields ─────────────────────────────────────
  // Set when shippingMethod === 'bus_station_pickup'. The id points back to a
  // PickupLocation doc for live lookups; the name is a snapshot so historical
  // orders keep the exact label the customer chose even if the pickup is later
  // renamed, disabled, or deleted.
  pickupLocationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PickupLocation',
    default: null,
  },
  // The fulfilment choice as the customer saw it — "Courier — Next Day".
  // Snapshotted like pickupLocationName so renaming a speed tier later never
  // rewrites what someone actually bought, and so the confirmation and order
  // pages render one field instead of each re-deriving a label from raw enums.
  shippingMethodLabel: {
    type: String,
    trim: true,
    maxlength: 80,
    default: "",
  },
  pickupLocationName: {
    type: String,
    trim: true,
    default: null,
  },
  // T80 — pickup-region context. Mirrors ShippingQuote.region; the calculator
  // resolves region → fulfilment, but the order also stores it so the
  // tracking/email copy can name the region without re-querying the quote.
  shippingRegion: {
    type: String,
    trim: true,
    default: null,
  },
  // T80 — pickup lifecycle markers. `readyForPickupAt` is set by staff when
  // the parcel reaches the chosen pickup point (status reaches 'shipped' for
  // pickup orders); `pickedUpAt` is set when the customer collects (status
  // reaches 'delivered'). Both null for home-delivery orders. Kept as separate
  // fields rather than new status enum values so the existing forward-only
  // transition rules keep working and reports/dashboards don't break.
  readyForPickupAt: {
    type: Date,
    default: null,
  },
  pickedUpAt: {
    type: Date,
    default: null,
  },

  total: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative']
  },
  // T125 — these are GUEST-supplied and were previously bounded only by
  // express.json({ limit: '5mb' }), so a single order could carry a multi-megabyte
  // address. On a 512MB heap, a handful of those in one admin list query is a
  // memory problem. Caps are enforced here as well as in the controller, because
  // the controller is not the only writer.
  //
  // Not an XSS control — app.js runs xss-clean globally and it traverses nested
  // objects. This is about size and deliverability.
  customer: {
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
      maxlength: [100, 'Customer name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
      maxlength: [20, 'Phone cannot exceed 20 characters'],
    },
    phoneDigits: {
      type: String,
      trim: true,
      default: '',
      maxlength: [15, 'Normalized phone cannot exceed 15 digits'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      maxlength: [254, 'Email cannot exceed 254 characters'], // RFC 5321 maximum
      validate: {
        // Optional field, so '' must stay valid. Order confirmations and invoices
        // go out through Resend, and before T125 "not-an-email" was accepted —
        // turning a paid order into a silent delivery failure.
        validator: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        message: 'Customer email is not a valid email address',
      },
    },
    address: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Delivery address cannot exceed 500 characters'],
    }
  },
  // T89 — lines that could not be fulfilled after the payment landed.
  //
  // The stock decrement in utils/fulfilShopOrder.js is guarded (`stock: { $gte:
  // qty }`) so it can never oversell. When that guard fails the code logs and
  // continues, deliberately: the customer has already been charged and the
  // payment must not be undone. But nothing recorded the shortfall, so the
  // order looked completely normal in the dashboard and it surfaced only as a
  // customer complaint.
  //
  // This is the record. It never blocks fulfilment; it makes the gap visible.
  fulfilmentIssues: [{
    itemName: { type: String, default: '' },
    productId: { type: mongoose.Schema.Types.ObjectId, default: null },
    variantSku: { type: String, default: '' },
    qtyRequested: { type: Number, default: 0 },
    reason: {
      type: String,
      enum: ['insufficient_stock'],
      default: 'insufficient_stock',
    },
    detectedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
  }],

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
    },
    // T45 — set when the entry came from a pre-order batch moving rather than
    // from staff. Carries the CUSTOMER-facing stage (four, not the eight
    // internal ones), because this history is shown to the customer.
    //
    // Tagging is what makes the journey correctable: when a batch is stepped
    // back, only entries carrying this field are rewritten, so a courier note
    // sitting beside them survives untouched.
    preorderStage: {
      type: String,
      enum: ['', 'preparing', 'on_the_way', 'in_ghana', 'at_shop'],
      default: ''
    }
  }],

  // ── T78 address-change tracking ───────────────────────────────────────────
  // When the delivery address changes after order creation, the shipping fee
  // is recalculated and the delta recorded here. Once status reaches "shipped"
  // no further address changes are allowed (controller enforces; model stores).
  addressHistory: [{
    address: { type: String, trim: true },
    shippingFee: { type: Number },
    zoneCode: { type: String, trim: true },
    changedBy: { type: String, trim: true, default: 'customer' },
    changedAt: { type: Date, default: Date.now },
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
orderSchema.index({ shippingQuoteId: 1 }, { sparse: true });
// trackingNumber already gets a unique sparse index from `unique: true` on the
// field definition — no separate index() call (avoids a duplicate-index warning).

// ── T78 pre-save hook ────────────────────────────────────────────────────────
// Keep the legacy `deliveryFee` field in sync with the new `shippingFee` so old
// admin views and reports that still read deliveryFee keep working. The two
// fields are never set independently — shippingFee is the source of truth.
orderSchema.pre('save', function syncDeliveryFee(next) {
  if (this.isModified('shippingFee')) {
    this.deliveryFee = this.shippingFee;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
