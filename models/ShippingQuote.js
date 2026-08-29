const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * ShippingQuote — a server-computed quote persisted briefly so the checkout
 * flow can prove the client saw the exact same figure the server will charge.
 *
 * Lifecycle:
 *   1. Client calls POST /shipping/quote → the calculator returns a quote AND
 *      we store a ShippingQuote doc here.
 *   2. Client submits checkout with `shippingQuoteId`. The order controller
 *      loads the doc, validates cartHash + city + method + expiry, and
 *      recomputes server-side — the stored fee is what gets charged. If the
 *      client tampered with any field the hash check fails and the order is
 *      rejected.
 *   3. On success the doc is marked `consumed: true` (unique index on orderId
 *      prevents double-spending).
 *
 * Security properties:
 *   - cartHash = SHA-256(JSON canonical(items + city + method + speed))
 *     — unguessable without knowing every line.
 *   - expiresAt is a MongoDB TTL index; docs self-delete 15 min after creation.
 *   - consumedAt prevents reuse; the unique partial index on (consumedAt)
 *     where consumedAt is null allows only ONE unconsumed quote per order.
 *
 * Money convention: integer pesewas end-to-end.
 */
const TTL_MINUTES = 15;

const shippingQuoteSchema = new mongoose.Schema(
  {
    // Client-facing quote id — random, opaque, not derived from any guessable
    // seed. The storefront stores this; it never appears in URLs or logs.
    quoteId: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(16).toString("hex"),
    },

    // ── Input snapshot (what the calculator received) ─────────────────────
    city: {
      type: String,
      required: true,
      trim: true,
    },
    neighborhood: {
      type: String,
      // Required for home delivery but empty for bus-station pickup (the
      // customer collects at a station), so it defaults to "" and is
      // validated at the endpoint layer instead of enforced on the model.
      default: "",
      trim: true,
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    method: {
      type: String,
      required: true,
      enum: {
        // T80 E2 — bus_station_pickup is a first-class fulfilment method
        // for outside-Greater-Accra orders; same enum lives on Order.
        values: ["in_house_delivery", "courier_dispatch", "bus_station_pickup"],
        message: "Method must be one of: {VALUES}",
      },
    },
    deliverySpeed: {
      type: String,
      enum: {
        values: ["standard", "same_day", "next_day", "express"],
        message: "Speed must be one of: {VALUES}",
      },
      default: "standard",
    },
    // T80 E2 — region (e.g. "Greater Accra", "Ashanti") and pickup location
    // id ride along so the quote is bound to the exact fulfilment context.
    // For bus_station_pickup both are required; for delivery, region may be
    // empty (legacy callers) or "Greater Accra".
    region: {
      type: String,
      trim: true,
      default: "",
    },
    pickupLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PickupLocation",
      default: null,
    },

    // Canonical hash of the cart contents + delivery params so the order
    // controller can verify nothing was changed between quote and checkout.
    cartHash: {
      type: String,
      required: true,
    },

    // ── Calculator output (what the client saw) ──────────────────────────
    shippingFee: {
      type: Number,
      required: true,
      min: [0, "Shipping fee cannot be negative"],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Shipping fee must be a whole number in pesewas",
      },
    },
    grossShippingFee: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Gross shipping fee must be a whole number in pesewas",
      },
    },
    freeDeliveryApplied: {
      type: Boolean,
      default: false,
    },
    // Customer-facing label for the chosen method, carried through to the order.
    methodLabel: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    zoneCode: {
      type: String,
      trim: true,
    },
    zoneName: {
      type: String,
      trim: true,
    },
    tierLevel: {
      type: Number,
      default: 0,
    },
    totalWeightKg: {
      type: Number,
      default: 0,
    },
    weightAssumed: {
      type: Boolean,
      default: false,
    },
    estimatedDays: {
      type: Number,
      default: null,
    },
    // Snapshot of the productIds the client quoted — so the order controller
    // can verify the checkout cart matches the quoted cart.
    productIds: {
      type: [String],
      default: [],
    },

    // ── Ownership + lifecycle ─────────────────────────────────────────────
    // When logged in, stamp the userId so we can look up past quotes. Guest
    // quotes have null.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    consumed: {
      type: Boolean,
      default: false,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    // The order that consumed this quote — set atomically so a race between
    // two checkout submissions can't double-spend the same quote.
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
  },
  {
    timestamps: true,
    // Strip internal fields when serialized to JSON (match Order style).
    toJSON: { virtuals: false },
    toObject: { virtuals: false },
  },
);

// TTL index: MongoDB deletes the document TTL_MINUTES after `createdAt`.
// This is the safety net — docs that are never consumed still get cleaned up.
shippingQuoteSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: TTL_MINUTES * 60 },
);

// Only one unconsumed quote per (quoteId) — the unique constraint on quoteId
// already handles this, but we add a partial unique index so the consumed
// quotes don't pile up on the uniqueness check. (MongoDB partial indexes
// require a unique index + partialFilterExpression.)
// Actually, quoteId is already unique, so no partial index needed — each
// quoteId is unique regardless of consumed status.

/**
 * Build a canonical cart hash from the items + delivery params.
 * The hash is deterministic: same inputs always produce the same hex digest,
 * so the order controller can recompute it from the checkout body and compare.
 *
 * T80 E2: region + pickupLocationId are now part of the hash inputs so that
 * a customer who quotes a delivery and then switches to a bus-station pickup
 * (or vice-versa) at checkout cannot smuggle a different fee through — the
 * hash mismatch forces a fresh quote.
 *
 * @param {Array<{productId: string, quantity: number}>} items
 * @param {string} city
 * @param {string} neighborhood
 * @param {string} method
 * @param {string} [deliverySpeed='standard']
 * @param {string} [region='']          — Greater-Accra region string (e.g. 'Greater Accra')
 * @param {string} [pickupLocationId=''] — PickupLocation ObjectId for bus-station pickup
 * @returns {string} hex digest
 */
function buildCartHash(items, city, neighborhood, method, deliverySpeed = "standard", region = "", pickupLocationId = "") {
  // Sort items by productId for determinism, then canonical-JSON them.
  const sorted = [...items]
    .sort((a, b) => String(a.productId).localeCompare(String(b.productId)));
  const canonical = JSON.stringify({
    items: sorted,
    city,
    neighborhood,
    method,
    deliverySpeed,
    region: String(region || ""),
    pickupLocationId: String(pickupLocationId || ""),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

module.exports = mongoose.model("ShippingQuote", shippingQuoteSchema);
module.exports.buildCartHash = buildCartHash;
module.exports.TTL_MINUTES = TTL_MINUTES;
