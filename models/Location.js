const mongoose = require("mongoose");

/**
 * Location — the single source of truth for geography in the shipping system.
 *
 * Replaces the closed hardcoded `CITIES = ['Accra','Tema']` enums (that lived
 * in ShippingSettings, ShippingZone and the validation schemas) with an
 * open, admin-editable taxonomy of regions → cities → neighborhoods.
 *
 * The shop's private fulfilment detail (the Nima warehouse, bus-station pickup
 * points) lives in models/PickupLocation.js, NOT here — those are origins and
 * handoff points, while Location is purely "where a customer receives goods".
 *
 * Neighborhoods are lowercased on save so lookups stay plain string compares
 * (same convention as ShippingZone).
 */
const locationSchema = new mongoose.Schema(
  {
    region: {
      type: String,
      required: [true, "Region is required"],
      trim: true,
      index: true,
    },
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
      index: true,
    },
    // The selectable neighborhoods for this city, lowercased + de-duplicated.
    neighborhoods: {
      type: [String],
      default: [],
    },
    // Whether this city is part of the Greater-Accra core. Drives the
    // fulfilment-method gate in shippingCalculator.js: in-core cities may use
    // home delivery (in_house/courier); everything else is pickup only.
    inAccraCore: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

// One location row per (region, city).
locationSchema.index({ region: 1, city: 1 }, { unique: true });

// Lowercase + trim + de-dupe neighborhoods so lookups are exact matches.
locationSchema.pre("validate", function normalizeNeighborhoods(next) {
  if (Array.isArray(this.neighborhoods)) {
    this.neighborhoods = [
      ...new Set(
        this.neighborhoods
          .map((n) => String(n || "").trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
  }
  next();
});

// Hot path: resolving a city's region (for the fulfilment gate) and listing
// neighborhoods for the checkout cascade.
locationSchema.index({ city: 1, isActive: 1 });

module.exports = mongoose.model("Location", locationSchema);
