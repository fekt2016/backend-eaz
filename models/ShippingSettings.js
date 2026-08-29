const mongoose = require("mongoose");

/**
 * ShippingSettings — THE store-wide shipping configuration (singleton).
 *
 * One document governs the whole single-vendor store; there is no per-seller
 * config anywhere in this system. Enforced by the fixed unique `key`, same
 * pattern as models/Settings.js (`key: 'global'`).
 *
 * `getSettings()` creates the document with documented defaults on first
 * read, so an empty collection can never 500 a quote — but note the seed
 * script (src/seedShipping.js) is what installs real rates; defaults here
 * are only a safe floor.
 *
 * Money convention: integer pesewas.
 */
const CITIES = ["Accra", "Tema"];

const shippingSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },

    // ── Reserved simple-mode knobs (pesewas) ───────────────────────────────
    // Flat fees kept configurable for a future "simple mode" price card.
    // The Phase-2 fee formula (zone × tier × speed + weight + fragile) does
    // NOT read these today — they exist so admins can stage values before any
    // switch-over, and so the schema matches the approved design. Changing
    // them has no effect until a calculator path consumes them; do not wire
    // them in silently.
    sameCityFee: {
      type: Number,
      min: 0,
      default: 0,
      validate: { validator: (v) => Number.isInteger(v), message: "sameCityFee must be a whole number in pesewas" },
    },
    crossCityFee: {
      type: Number,
      min: 0,
      default: 0,
      validate: { validator: (v) => Number.isInteger(v), message: "crossCityFee must be a whole number in pesewas" },
    },
    heavyItemFee: {
      type: Number,
      min: 0,
      default: 0,
      validate: { validator: (v) => Number.isInteger(v), message: "heavyItemFee must be a whole number in pesewas" },
    },
    heavyItemThresholdKg: { type: Number, min: 0, default: 10 },

    // Cart subtotal (pesewas) at or above which delivery is free. `null`
    // disables the feature entirely. A value of 0 is treated as disabled too
    // (only a positive value triggers free delivery).
    freeDeliveryThreshold: {
      type: Number,
      min: [0, "Free delivery threshold cannot be negative"],
      default: null,
      validate: { validator: (v) => v == null || (Number.isInteger(v) && v > 0), message: "Free delivery threshold must be a positive whole number in pesewas, or null to disable" },
    },

    // ── Fulfilment method switches ─────────────────────────────────────────
    // T78 decision: no shop pickup anywhere in this build — the only methods
    // are in-house rider and courier dispatch, so there is deliberately no
    // `shopPickupAvailable` knob to resurrect.
    inHouseDeliveryAvailable: { type: Boolean, default: true },
    // Off by default: courier dispatch also needs an active CourierRate doc
    // before money can settle (Phase 5), so don't advertise it out of the box.
    courierDispatchAvailable: { type: Boolean, default: false },
    expressAvailable: { type: Boolean, default: true },
    // Off: EazWorld does not offer courier same-day. The cutoff/closed-day
    // knobs below still govern it, but this switch is the one that decides
    // whether it is offered at all — a knob rather than a deletion, so the
    // tier's pricing stays intact if the service is ever turned back on.
    sameDayAvailable: { type: Boolean, default: false },
    // Expansion (T78 → E2): shop pickup / bus-station pickup is a distinct
    // fulfilment method. Off by default; the seed turns it on. Unlike the T78
    // delivery switches there is a real `pickupAvailable` knob here because
    // pickup (bus_station_pickup) is a first-class method in this expansion.
    pickupAvailable: { type: Boolean, default: false },
    // Reserved flat express add-on (pesewas) — see reserved-knobs note above;
    // speed pricing today is the zone's expressMultiplier.
    expressSurcharge: {
      type: Number,
      min: 0,
      default: 0,
      validate: { validator: (v) => Number.isInteger(v), message: "expressSurcharge must be a whole number in pesewas" },
    },

    // Max one-way km the in-house rider covers; zones beyond it are pushed to
    // courier dispatch. `null` = unlimited (no radius check).
    inHouseRadiusKm: { type: Number, min: 0, default: null },

    // ── T80 same-day + delivery-day rules ─────────────────────────────────
    // The hour of day (0–23, server local time) past which same-day requests
    // are refused. 17 = 5 PM (owner, 2026-08-29, raised from noon): express is
    // the same-day service, and a noon cutoff withdrew the only "today" option
    // halfway through the working day. `null` falls back to the calculator's
    // hard-coded default, which matches this.
    sameDayCutoffHour: {
      type: Number,
      min: [0, "Same-day cutoff hour cannot be negative"],
      max: [23, "Same-day cutoff hour cannot exceed 23"],
      default: 17,
    },
    // The set of weekday indices (0 = Sunday, 6 = Saturday) on which same-day
    // delivery is not offered. Empty array = no closed days (same-day is
    // always bookable, subject to the time cutoff). Default: Sundays only.
    deliveryClosedDays: {
      type: [Number],
      default: [0],
      validate: {
        validator: (v) => Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: "deliveryClosedDays must be an array of weekday integers (0=Sun … 6=Sat)",
      },
    },

    // ── Google-Maps distance pricing ──────────────────────────────────────
    // The address every neighbourhood distance is measured FROM: the shop's
    // own origin (the Nima warehouse). Free text — Google geocodes it. When
    // this changes, every stored NeighborhoodDistance is marked stale (the
    // originKey no longer matches) so the admin can re-resolve deliberately.
    originAddress: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    // Master switch for distance pricing. When ON, the calculator prices a
    // Greater-Accra delivery from the neighbourhood's measured driving
    // distance instead of the zone's distanceMin/Max band midpoint. Falls back
    // to the band whenever a neighbourhood has no measured distance, so
    // turning this on can never leave a quote unpriced.
    useGoogleDistance: { type: Boolean, default: false },

    // ── Distance-zone pricing (A–F) ────────────────────────────────────────
    // When ON, a Greater-Accra core delivery is priced from the customer's
    // neighbourhood → assigned zone → that zone's rate card, via the formula in
    // services/shipping/distanceFee.js.
    //
    // With it ON, a delivery whose zone cannot be resolved is REFUSED, not
    // quoted from a fallback. That is the point: the fallback available here is
    // the cheapest zone, and a pricing default that errs cheap produces no
    // error, no complaint and no alert — just margin leaking quietly. Better a
    // visible 400 than an invisible under-charge.
    useDistanceZones: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const DEFAULT_KEY = "default";

/**
 * Fetch the singleton, creating it with schema defaults on first read.
 * Safe against races between concurrent cold reads: the final create wins,
 * both readers end up with a valid document.
 */
shippingSettingsSchema.statics.getSettings = async function getSettings() {
  const existing = await this.findOne({ key: DEFAULT_KEY });
  if (existing) return existing;
  try {
    return await this.create({ key: DEFAULT_KEY });
  } catch (err) {
    if (err.code === 11000) return this.findOne({ key: DEFAULT_KEY });
    throw err;
  }
};

module.exports = mongoose.model("ShippingSettings", shippingSettingsSchema);
module.exports.DEFAULT_KEY = DEFAULT_KEY;
module.exports.CITIES = CITIES;
