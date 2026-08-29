const mongoose = require("mongoose");

/**
 * CourierRate — the courier payout configuration (T78 Phase 5).
 *
 * Single document (`code: 'COURIER_PAYOUT'`) governs how the courier portion
 * of a delivery fee is split. The calculator itself never reads this — it is
 * consumed by the DeliveryCharge settlement logic when an order transitions
 * to delivered.
 *
 * Resolved through a documented fallback chain (mode → hardcoded default);
 * a missing config must fall through the chain, never resolve to 0 or NaN,
 * and never block a delivery from being marked complete.
 *
 * Money convention: integer pesewas end-to-end.
 */
const HARDCOURT_DEFAULT_PERCENTAGE = 30; // 30% of shipping fee goes to courier

const courierRateSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      default: "COURIER_PAYOUT",
      unique: true,
      trim: true,
      uppercase: true,
    },
    mode: {
      type: String,
      enum: { values: ["percentage", "flat", "per_zone"], message: "Mode must be one of: {VALUES}" },
      default: "percentage",
    },
    percentage: {
      type: Number,
      min: [0, "Percentage cannot be negative"],
      max: [100, "Percentage cannot exceed 100"],
      default: 0,
    },
    flatAmount: {
      type: Number,
      min: [0, "Flat amount cannot be negative"],
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Flat amount must be a whole number in pesewas",
      },
    },
    zoneRates: [
      {
        zoneCode: { type: String, required: true, trim: true, uppercase: true },
        amount: {
          type: Number,
          min: 0,
          default: 0,
          validate: {
            validator: (v) => Number.isInteger(v),
            message: "Zone rate must be a whole number in pesewas",
          },
        },
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

/**
 * Compute the courier payout in pesewas for a given shipping fee + zone.
 *
 * Fallback chain (never silently resolves to 0):
 *   1. Active document with matching mode → apply mode's rule.
 *   2. Document missing, inactive, or mode yields NaN/≤0 → fall through to
 *      the hardcoded default percentage (HARDCOURT_DEFAULT_PERCENTAGE).
 *   3. The result is always floored to 0 (never negative) but if the fee is
 *      > 0 and the config is totally broken the fallback still produces a
 *      non-zero payout so the courier isn't stiffed.
 *
 * @param {number} shippingFee  — total shipping fee collected (pesewas, ≥ 0)
 * @param {string} [zoneCode]   — for per_zone mode
 * @returns {number} courier payout in whole pesewas
 */
courierRateSchema.methods.resolvePayout = function resolvePayout(shippingFee, zoneCode) {
  const fee = Math.max(0, Number(shippingFee) || 0);

  if (fee === 0) return 0;

  let payout = 0;

  if (this.isActive) {
    switch (this.mode) {
      case "percentage": {
        const pct = Number(this.percentage);
        if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
          payout = Math.round(fee * (pct / 100));
        }
        break;
      }
      case "flat": {
        const flat = Number(this.flatAmount);
        if (Number.isFinite(flat) && flat > 0) {
          payout = Math.round(flat);
        }
        break;
      }
      case "per_zone": {
        if (zoneCode && Array.isArray(this.zoneRates)) {
          const entry = this.zoneRates.find(
            (z) => z.zoneCode === String(zoneCode).toUpperCase(),
          );
          if (entry) {
            const amt = Number(entry.amount);
            if (Number.isFinite(amt) && amt > 0) {
              payout = Math.round(amt);
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // Fallback: if the config is missing, inactive, or yielded nothing usable,
  // apply the hardcoded default percentage.
  if (!Number.isFinite(payout) || payout <= 0) {
    payout = Math.round(fee * (HARDCOURT_DEFAULT_PERCENTAGE / 100));
  }

  return Math.max(0, payout);
};

/**
 * Fetch-or-create the singleton config. Called by the settlement logic — a
 * missing doc must not throw; the fallback chain above handles it.
 */
courierRateSchema.statics.getOrCreate = async function getOrCreate() {
  const existing = await this.findOne({ code: "COURIER_PAYOUT" });
  if (existing) return existing;
  try {
    return await this.create({ code: "COURIER_PAYOUT" });
  } catch (err) {
    if (err.code === 11000) return this.findOne({ code: "COURIER_PAYOUT" });
    throw err;
  }
};

module.exports = mongoose.model("CourierRate", courierRateSchema);
module.exports.HARDCOURT_DEFAULT_PERCENTAGE = HARDCOURT_DEFAULT_PERCENTAGE;
