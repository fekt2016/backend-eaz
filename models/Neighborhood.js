const mongoose = require("mongoose");

/**
 * Neighborhood — one serviceable delivery area, pre-assigned to a distance zone.
 *
 * This is what makes checkout fast and free of third-party calls: the buyer
 * picks a neighbourhood, and its zone is already known. Geocoding and distance
 * measurement happen at seed/admin time only (see the recalculate endpoints).
 *
 * `distanceKm` is stored NEXT TO `assignedZone` on purpose. Keeping only the
 * zone throws away the evidence for it — you can then neither audit an
 * assignment, nor re-derive zones after a rate change, nor tell a deliberate
 * override from a data-entry slip.
 *
 * Distances are kilometres (a measurement, not money). Zone RATES are integer
 * pesewas and live on models/ShippingZone.js.
 */
const ZONE_KEYS = ["A", "B", "C", "D", "E", "F"];

const neighborhoodSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true, index: true },
    city: { type: String, required: [true, "City is required"], trim: true, index: true },
    // The district / MMDA. Used to group the checkout picker, and to sanity-
    // check a geocode that lands implausibly far from its stated district.
    municipality: { type: String, required: [true, "Municipality is required"], trim: true },

    lat: { type: Number, required: [true, "Latitude is required"], min: -90, max: 90 },
    lng: { type: Number, required: [true, "Longitude is required"], min: -180, max: 180 },

    formattedAddress: { type: String, trim: true, default: "" },
    placeId: { type: String, trim: true, default: "" },

    // Driving distance from the warehouse. Required once seeded — a null here
    // means the assignment below cannot be justified or reproduced.
    distanceKm: {
      type: Number,
      required: [true, "distanceKm is required — do not store a zone without the distance behind it"],
      min: [0, "Distance cannot be negative"],
    },
    // How distanceKm was obtained, so a straight-line estimate is never
    // mistaken for a measured road distance.
    distanceSource: {
      type: String,
      enum: { values: ["google", "manual", "estimated"], message: "distanceSource must be google, manual or estimated" },
      default: "estimated",
    },
    distanceMeasuredAt: { type: Date, default: null },

    assignedZone: {
      type: String,
      required: [true, "An assigned zone is required"],
      enum: { values: ZONE_KEYS, message: "Zone must be one of: {VALUES}" },
      uppercase: true,
      index: true,
    },
    // True when an admin set the zone by hand — a business decision (a corridor
    // with bad roads that deserves a dearer zone), not a measurement. The
    // recalculation job must leave these alone, and re-seeding must not clobber
    // them, so intent is recorded rather than inferred.
    zoneOverride: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

// One row per (city, name) — the seeder upserts on exactly this pair.
neighborhoodSchema.index({ city: 1, name: 1 }, { unique: true });
// The checkout picker lists active neighbourhoods for a city.
neighborhoodSchema.index({ city: 1, isActive: 1 });

/** Active neighbourhoods, optionally for one city, ordered for a picker. */
neighborhoodSchema.statics.listActive = function listActive(city) {
  return this.find({ isActive: true, ...(city ? { city } : {}) })
    .select("name city municipality assignedZone distanceKm")
    .sort({ city: 1, municipality: 1, name: 1 })
    .lean();
};

module.exports = mongoose.model("Neighborhood", neighborhoodSchema);
module.exports.ZONE_KEYS = ZONE_KEYS;
