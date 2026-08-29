const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * NeighborhoodDistance — the cached driving distance from the shop's origin
 * (the Nima warehouse) to one delivery neighbourhood.
 *
 * WHY A COLLECTION AND NOT A FIELD ON Location: `Location.neighborhoods` is a
 * plain string array read by the checkout picker, the zone matcher and
 * /locations/neighborhoods. Turning it into subdocuments to carry a distance
 * would ripple through all of them. A side table is additive — nothing that
 * reads the string array has to change.
 *
 * WHY CACHED AT ALL: Google bills per element and the quote path must not wait
 * on a third party. An admin resolves each neighbourhood once from business
 * settings; shippingCalculator only ever reads this collection. See
 * services/shipping/googleDistance.js.
 *
 * Distances are kilometres (2 dp floats) — a measurement, not money, so the
 * integer-pesewas rule does not apply here. The FEE derived from it is
 * pesewas.
 */

/**
 * A stable key for an origin address, so changing the warehouse address marks
 * every stored distance stale instead of silently keeping the old numbers.
 * Whitespace and case are normalised first — "Nima, Accra" and "nima,  accra"
 * are the same origin.
 */
function buildOriginKey(originAddress) {
  const normalized = String(originAddress || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

const neighborhoodDistanceSchema = new mongoose.Schema(
  {
    region: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    // Lowercased to match the Location/ShippingZone neighbourhood convention,
    // so lookups stay plain string compares.
    neighborhood: { type: String, required: true, trim: true, lowercase: true },

    // Which origin this distance was measured from. When it no longer matches
    // the configured origin the row is stale — see isStaleFor().
    originKey: { type: String, required: true, index: true },
    originAddress: { type: String, trim: true, default: "" },

    // What we actually sent to Google, kept so an admin can see why a lookup
    // resolved somewhere unexpected.
    resolvedAddress: { type: String, trim: true, default: "" },

    distanceKm: { type: Number, required: true, min: 0 },
    durationMins: { type: Number, min: 0, default: null },

    // 'google' — measured via the Routes/Distance Matrix API.
    // 'manual'  — an admin typed the number, e.g. where Google cannot route to
    //             an informal settlement. Manual rows are never overwritten by
    //             a bulk re-resolve unless the admin forces it.
    source: {
      type: String,
      enum: { values: ["google", "manual"], message: "Source must be google or manual" },
      default: "google",
      index: true,
    },

    resolvedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// One distance per neighbourhood per city. The quote path looks up exactly
// this triple, so it is both the uniqueness constraint and the read index.
neighborhoodDistanceSchema.index(
  { region: 1, city: 1, neighborhood: 1 },
  { unique: true },
);

/** True when this row was measured from a different origin than the current one. */
neighborhoodDistanceSchema.methods.isStaleFor = function isStaleFor(currentOriginKey) {
  return this.originKey !== currentOriginKey;
};

/**
 * Upsert one measured distance. Idempotent — re-resolving a neighbourhood
 * overwrites the previous number rather than accumulating rows.
 */
neighborhoodDistanceSchema.statics.record = function record(
  { region, city, neighborhood },
  { distanceKm, durationMins, originKey, originAddress, resolvedAddress, source = "google" },
) {
  return this.findOneAndUpdate(
    { region, city, neighborhood: String(neighborhood).toLowerCase() },
    {
      $set: {
        distanceKm,
        durationMins: durationMins ?? null,
        originKey,
        originAddress: originAddress || "",
        resolvedAddress: resolvedAddress || "",
        source,
        resolvedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

/**
 * The distance the calculator should use for a neighbourhood, or null when it
 * has never been resolved. Returns the number even if it is stale — a distance
 * measured from the previous warehouse is a far better estimate than falling
 * back to the zone's band midpoint, and the admin UI flags staleness so it
 * gets re-resolved deliberately.
 */
neighborhoodDistanceSchema.statics.lookupKm = async function lookupKm({ region, city, neighborhood }) {
  if (!neighborhood) return null;
  const query = {
    city,
    neighborhood: String(neighborhood).trim().toLowerCase(),
    ...(region ? { region } : {}),
  };
  const row = await this.findOne(query).select("distanceKm").lean();
  return row ? row.distanceKm : null;
};

module.exports = mongoose.model("NeighborhoodDistance", neighborhoodDistanceSchema);
module.exports.buildOriginKey = buildOriginKey;
