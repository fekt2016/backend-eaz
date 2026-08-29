const mongoose = require("mongoose");

/**
 * ShippingZone — where EazWorld delivers, and what it costs to get there.
 *
 * Part of the single-vendor shipping system (see services/shipping/). Rates
 * live HERE in the database, never in code: every figure below is an admin-
 * editable knob read through services/shipping/shippingCache.js at quote time.
 *
 * Money convention (whole app): integer pesewas. GH₵1.00 === 100. Multipliers
 * are dimensionless floats; every GHS-denominated field carries the usual
 * whole-number-of-pesewas validator.
 */
const shippingZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Zone name is required"],
      trim: true,
    },
    // Stable machine id used on orders (`shippingZoneCode`) and in courier
    // zone rates — survives zone renames, unlike name.
    code: {
      type: String,
      required: [true, "Zone code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    // ── Expansion (T78 → E2) ────────────────────────────────────────────────
    // `city` used to be a closed Accra/Tema enum. With the E2 expansion the
    // open geography taxonomy lives in models/Location.js and zones are scoped
    // to a `region`; `city` is now a free label naming the primary city the
    // zone serves (e.g. 'Kumasi' for the Ashanti zone), so regional zones can
    // be stored. Legacy Accra/Tema zones keep their 'Accra'/'Tema' value and
    // the existing delivery path is unaffected (it falls back to city match).
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
      index: true,
    },
    // ── Expansion (T78 → E2) ────────────────────────────────────────────────
    // Breadth of geography. `city` stays the closed legacy enum for backward
    // compatibility with delivery zones; this free `region` names the whole
    // region the zone serves (e.g. 'Greater Accra', 'Ashanti'). The open
    // geography taxonomy lives in models/Location.js (region → city →
    // neighborhood); this field links the zone to it when the customer is not
    // in the legacy Accra/Tema cities.
    region: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    // Neighbourhoods this zone covers, matched case-insensitively against the
    // customer's address text. Lowercased on save (preValidate below) so the
    // DB-side match stays a plain string compare.
    neighborhoods: {
      type: [String],
      default: [],
    },
    // Distance band. Originally optional (only the in-house rider radius read
    // it); for a distance zone (zoneKey A–F) it is the zone's DEFINITION and
    // the classifier reads it as a half-open interval [minKm, maxKm).
    //
    // Half-open is deliberate. Ranges written as 0–5, 5.01–10, 10.01–15 and
    // matched with `min <= d <= max` leave a hole at 5.005 km that belongs to
    // no zone and throws at checkout. Contiguous bounds with an inclusive
    // lower and an exclusive upper cover the line with no gap and no overlap.
    distanceMinKm: { type: Number, min: 0, default: null },
    distanceMaxKm: { type: Number, min: 0, default: null },

    // ── Distance-zone identity (A–F) ────────────────────────────────────────
    // Set on the six banded zones that price Greater-Accra deliveries by
    // distance. Null on the legacy city/regional zones, which keep their own
    // resolution path untouched.
    zoneKey: {
      type: String,
      enum: { values: ["A", "B", "C", "D", "E", "F", null], message: "zoneKey must be A–F" },
      uppercase: true,
      default: null,
      index: true,
    },

    // ── Speed tiers ─────────────────────────────────────────────────────────
    // A subdocument array, NOT one schema field per speed. Named fields invite
    // exactly one bug: a call site that reads `expressMultiplier` for same-day
    // orders and `sameDayMultiplier` for express ones, while the admin panel
    // labels each field by its schema name — so editing "same-day" silently
    // reprices express. Keying on `code` makes that mistake unrepresentable,
    // and a new tier needs no schema change.
    speedTiers: {
      type: [
        new mongoose.Schema(
          {
            code: { type: String, required: true, trim: true },
            label: { type: String, required: true, trim: true },
            multiplier: { type: Number, required: true, min: [1, "A speed multiplier cannot discount below the base rate"] },
            estimatedDays: { type: String, trim: true, default: "" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // Human label for the delivery window ('1-2', '2-3'). The numeric
    // `estimatedDays` below stays the machine-readable low end.
    estimatedDaysLabel: { type: String, trim: true, default: "" },

    // ── Rate card (pesewas) ────────────────────────────────────────────────
    baseRate: {
      type: Number,
      required: [true, "Base rate is required"],
      min: [0, "Base rate cannot be negative"],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Base rate must be a whole number in pesewas",
      },
    },
    // Courier dispatch rate — if set, courier_dispatch uses this instead of
    // baseRate. In-house always uses baseRate. Falls back to baseRate when null.
    courierBaseRate: {
      type: Number,
      min: [0, "Courier base rate cannot be negative"],
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "Courier base rate must be a whole number in pesewas",
      },
    },
    // Applied per billable kg when the cart's tier has no per-kg surcharge.
    perKgRate: {
      type: Number,
      min: [0, "Per-kg rate cannot be negative"],
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Per-kg rate must be a whole number in pesewas",
      },
    },
    // Courier per-kg rate — if set, courier_dispatch uses this instead of
    // perKgRate. Falls back to perKgRate when null.
    courierPerKgRate: {
      type: Number,
      min: [0, "Courier per-kg rate cannot be negative"],
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "Courier per-kg rate must be a whole number in pesewas",
      },
    },
    sameDayMultiplier: { type: Number, min: 0, default: 1.2 },
    expressMultiplier: { type: Number, min: 0, default: 1.4 },
    fragileSurcharge: {
      type: Number,
      min: [0, "Fragile surcharge cannot be negative"],
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Fragile surcharge must be a whole number in pesewas",
      },
    },

    // ── Expansion pricing (T78 → E2) ────────────────────────────────────────
    // The E2 formula splits fulfilment into two branches. These fields carry
    // the figures for the Greater-Accra distance-based formula and the
    // regional bus-station-pickup formula. They are additive: the legacy
    // baseRate/perKgRate/tier/speed fields above still fully drive the old
    // Accra/Tema delivery path, so existing zones keep working untouched.
    //
    // Whether a zone is part of the Greater-Accra core. In-core zones use the
    // distance formula + home delivery; other zones use a regional zone code
    // (regional* fields) + bus-station pickup. When null, falls back to the
    // zone's city being one of the legacy core cities.
    inAccraCore: {
      type: Boolean,
      default: null,
    },
    // Greater-Accra distance formula: fee = distanceBaseFee + distanceKm ×
    // pricePerKm + weightKg × pricePerKg. Falls back to the legacy
    // baseRate/perKgRate when these are null (backward compat).
    distanceBaseFee: {
      type: Number,
      min: [0, "Distance base fee cannot be negative"],
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "distanceBaseFee must be a whole number in pesewas",
      },
    },
    pricePerKm: {
      type: Number,
      min: [0, "Per-km price cannot be negative"],
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "pricePerKm must be a whole number in pesewas",
      },
    },
    pricePerKg: {
      type: Number,
      min: [0, "Per-kg price cannot be negative"],
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "pricePerKg must be a whole number in pesewas",
      },
    },
    // Regional pickup formula: fee = regionalBaseFee + weightKg ×
    // regionalPricePerKg. Used when fulfilment is bus_station_pickup.
    regionalBaseFee: {
      type: Number,
      min: [0, "Regional base fee cannot be negative"],
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "regionalBaseFee must be a whole number in pesewas",
      },
    },
    regionalPricePerKg: {
      type: Number,
      min: [0, "Regional per-kg price cannot be negative"],
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "regionalPricePerKg must be a whole number in pesewas",
      },
    },
    // Pickup UX mode for this zone: 'none' (delivery only, the Accra core),
    // 'bus_station' (regional — customer collects from a chosen station).
    pickupMode: {
      type: String,
      enum: {
        values: ["none", "bus_station"],
        message: "pickupMode must be one of: {VALUES}",
      },
      default: "none",
    },

    estimatedDays: {
      type: Number,
      required: [true, "Estimated delivery days are required"],
      min: [0, "Estimated days cannot be negative"],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Estimated days must be a whole number",
      },
    },
    // The zone customers fall back to when their address text matches none of
    // the neighbourhoods in this city (one per city — if several are flagged,
    // the calculator takes the lowest-id deterministically). When no zone in a
    // city is flagged at all, the heuristic fallback is lowest distanceMinKm,
    // then name ascending, so an unflagged setup still quotes instead of 500.
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

// Lowercase + trim neighbourhoods so lookups can be exact matches.
shippingZoneSchema.pre("validate", function normalizeNeighborhoods(next) {
  if (Array.isArray(this.neighborhoods)) {
    this.neighborhoods = this.neighborhoods
      .map((n) => String(n || "").trim().toLowerCase())
      .filter(Boolean);
  }
  next();
});

/** `0-5 km` — for the public rate table. */
shippingZoneSchema.virtual("distanceRange").get(function distanceRange() {
  if (this.distanceMinKm == null || this.distanceMaxKm == null) return "";
  return `${this.distanceMinKm}-${this.distanceMaxKm} km`;
});

/** The six banded distance zones, ordered by where they start. */
shippingZoneSchema.statics.getActiveZones = function getActiveZones() {
  return this.find({ isActive: true, zoneKey: { $ne: null } }).sort({ distanceMinKm: 1 }).lean();
};

/**
 * The active zone whose band contains `distanceKm`, as a half-open interval
 * [minKm, maxKm). Returns null when the distance falls outside every band —
 * the caller decides what that means, because "no zone" is an error condition
 * and must never be resolved into a price here.
 */
shippingZoneSchema.statics.findByDistance = async function findByDistance(distanceKm) {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return null;
  }
  const zones = await this.getActiveZones();
  return zones.find((z) => distanceKm >= z.distanceMinKm && distanceKm < z.distanceMaxKm) || null;
};

// Neighbourhood match is the hot path for quote resolution — multikey index
// over the array plus city+active for the city-fallback query.
shippingZoneSchema.index({ neighborhoods: 1 });
shippingZoneSchema.index({ city: 1, isActive: 1 });

module.exports = mongoose.model("ShippingZone", shippingZoneSchema);
