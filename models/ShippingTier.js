const mongoose = require("mongoose");

/**
 * ShippingTier — per product-category handling profile.
 *
 * A screen needs padding and a fragile surcharge; a bulk carton of cables is
 * heavy but robust. The tier is what encodes that difference on top of the
 * zone's base rate (see services/shipping/shippingCalculator.js for the
 * formula). `category` matches Product.category EXACTLY — that field is free
 * text, not an enum, so unmapped categories are expected and never an error:
 * they resolve to the default tier (below).
 *
 * Money convention: integer pesewas. Multipliers are dimensionless floats.
 */

// Sentinel category for THE default tier — the fallback row admins can edit
// through the normal CRUD instead of asking engineering. Any product whose
// category has no active tier of its own resolves to the active tier with
// this category; if even that is missing, the code constant below applies.
const DEFAULT_TIER_CATEGORY = "__default__";

// Last-resort default tier (documented final fallback in the resolution
// chain): neutral multiplier, no surcharges, level 0 — a cart of entirely
// unmapped categories prices at plain zone base rate.
const DEFAULT_TIER = Object.freeze({
  name: "Default",
  category: DEFAULT_TIER_CATEGORY,
  level: 0,
  multiplier: 1,
  fragileSurcharge: 0,
  weightThresholdKg: 0,
  weightSurchargePerKg: 0,
});

const shippingTierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Tier name is required"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      unique: true,
      trim: true,
    },
    // Highest level wins in a mixed cart (one screen + twenty cables prices
    // at the screen tier); ties break on the higher multiplier.
    level: {
      type: Number,
      min: [0, "Level cannot be negative"],
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Level must be a whole number",
      },
    },
    multiplier: { type: Number, min: 0, default: 1.0 },
    fragileSurcharge: {
      type: Number,
      min: [0, "Fragile surcharge cannot be negative"],
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Fragile surcharge must be a whole number in pesewas",
      },
    },
    // Per-kg weight surcharge only applies to the kg ABOVE this threshold.
    weightThresholdKg: { type: Number, min: 0, default: 0 },
    weightSurchargePerKg: {
      type: Number,
      min: [0, "Weight surcharge cannot be negative"],
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Weight surcharge must be a whole number in pesewas",
      },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ShippingTier", shippingTierSchema);
module.exports.DEFAULT_TIER_CATEGORY = DEFAULT_TIER_CATEGORY;
module.exports.DEFAULT_TIER = DEFAULT_TIER;
