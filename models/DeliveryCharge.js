const mongoose = require("mongoose");

/**
 * DeliveryCharge — one row per order, created when the order reaches
 * `delivered`.  Records the courier payout vs. EazWorld's retained margin.
 *
 * Invariant: `courierPayout + retainedMargin === shippingFeeCollected`.
 *
 * Unique on `orderId` → idempotent; calling settle twice on the same order
 * returns the existing record.  Negative margin is surfaced, never clamped —
 * if the admin set a discount that costs us money, we want to see it.
 *
 * Money convention: integer pesewas end-to-end.
 */
const deliveryChargeSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
      index: true,
    },
    shippingFeeCollected: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "shippingFeeCollected must be a whole number in pesewas",
      },
    },
    courierPayout: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "courierPayout must be a whole number in pesewas",
      },
    },
    retainedMargin: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "retainedMargin must be a whole number in pesewas",
      },
    },
    mode: {
      type: String,
      enum: ["percentage", "flat", "per_zone"],
      required: true,
    },
    zoneCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },
    method: {
      type: String,
      enum: ["courier_dispatch", "in_house_delivery"],
      default: null,
    },
    refunded: {
      type: Boolean,
      default: false,
    },
    refundedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

/**
 * Validate the invariant on save. Negative margins are allowed — the
 * clamping logic happens in the settlement service, not the schema.
 */
deliveryChargeSchema.pre("validate", function preValidate(next) {
  if (this.shippingFeeCollected != null && this.courierPayout != null && this.retainedMargin != null) {
    const sum = this.courierPayout + this.retainedMargin;
    if (sum !== this.shippingFeeCollected) {
      this.invalidate(
        "retainedMargin",
        `courierPayout + retainedMargin (${sum}) ≠ shippingFeeCollected (${this.shippingFeeCollected})`,
      );
    }
  }
  next();
});

/**
 * Fetch-or-create the settlement for an order.
 * Returns the existing record on the second call (idempotent).
 */
deliveryChargeSchema.statics.settle = async function settle(orderId, doc) {
  const existing = await this.findOne({ orderId });
  if (existing) return existing;
  return this.create({ orderId, ...doc });
};

module.exports = mongoose.model("DeliveryCharge", deliveryChargeSchema);
