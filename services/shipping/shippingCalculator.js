/**
 * shippingCalculator.js — THE only place an EazWorld shipping fee is computed.
 *
 * Controllers call quoteShipping(); nothing recomputes fees inline anywhere
 * else. Every rate/multiplier/threshold is read from the database through
 * shippingCache.js (zones, tiers, settings) or arrives on the product documents
 * the caller loaded from the DB — the only constants here are documented final
 * fallbacks (the frozen DEFAULT_TIER lives in models/ShippingTier.js) and unit
 * conversion maths, neither of which is a price.
 *
 * Money convention: integer pesewas end-to-end. Multipliers are dimensionless
 * floats applied to pesewas and rounded HALF-UP to whole pesewas at each step
 * of the formula (roundPesewas below) — GHS floats are never stored compared
 * or returned.
 */
const ShippingSettingsModel = require("../../models/ShippingSettings");
const ShippingZone = require("../../models/ShippingZone");
const ShippingTier = require("../../models/ShippingTier");
const Location = require("../../models/Location");
const NeighborhoodDistance = require("../../models/NeighborhoodDistance");
const { resolveZoneByNeighborhoodId, resolveZoneByName, ZoneResolutionError } = require("./zoneResolver");
const { calcShippingWithBreakdown } = require("./distanceFee");
const { DEFAULT_TIER, DEFAULT_TIER_CATEGORY } = require("../../models/ShippingTier");
const logger = require("../../utils/logger");

const {
  DisabledDeliveryMethodError,
  OutOfRangeError,
  UnsupportedDeliveryAreaError,
  InvalidFulfilmentMethodError,
} = require("./shippingErrors");
const { shippingCache } = require("./shippingCache");

// Catalogue gaps happen: `weight: 0` means "unknown" (models/Product.js), and
// an unknown line is priced at this many kilograms with weightAssumed flagged,
// so support can explain the charge and the catalogue can be fixed.
const ASSUMED_WEIGHT_KG = 0.5;
const KG_PER_LB = 0.453592;
const KG_PER_G = 0.001;

// Fulfilment methods in this build. Delivery happened under T78 (no shop
// pickup). The E2 expansion adds `bus_station_pickup` for outside Greater
// Accra — a real pickup method, distinct from the T78 decision that there is
// no in-shop self-service pickup for walk-in orders.
const DELIVERY_METHODS = ["in_house_delivery", "courier_dispatch"];
const PICKUP_METHODS = ["bus_station_pickup"];
const DELIVERY_SPEEDS = ["standard", "same_day", "next_day", "express"];

/**
 * Split a compound courier method id ("courier_dispatch_express") into the
 * method and speed the calculator wants.
 *
 * GET /shipping/methods builds those ids from each zone's own `speedTiers`,
 * precisely so the offer list cannot drift from the rate card. Every consumer
 * then re-derived the valid speeds from a list typed out at the call site, and
 * those lists drifted instead: the seeded zones carry a `next_day` tier that
 * none of them accepted, so the one option the endpoint offered and the schema
 * rejected failed with "Validation failed". DELIVERY_SPEEDS is the one source.
 *
 * The compound id wins over a separately-supplied `deliverySpeed`: it is the
 * row the customer actually clicked. A method that is not a compound courier id
 * is passed through untouched.
 */
function splitCourierMethodId(method, deliverySpeed) {
  const PREFIX = "courier_dispatch_";
  if (typeof method !== "string" || !method.startsWith(PREFIX)) {
    return { method, deliverySpeed };
  }
  const speed = method.slice(PREFIX.length);
  if (!DELIVERY_SPEEDS.includes(speed)) return { method, deliverySpeed };
  return { method: "courier_dispatch", deliverySpeed: speed };
}

// The Greater-Accra core under the legacy city enum. Used only when a caller
// does not send `region` (backward compat) — the authoritative in-core test
// is Location.inAccraCore.
const LEGACY_CORE_CITIES = ["Accra", "Tema"];

// Speeds that promise delivery TODAY, and so answer to the cutoff hour and the
// closed-day set. `express` joined this list when it became the same-day
// service ("same day — within a few hours"); before that an express order at
// 9pm on a Sunday promised delivery within hours and nobody was there to make
// it happen.
const SAME_DAY_SPEEDS = ["same_day", "express"];

/**
 * Whether a same-day promise can still be honoured right now.
 *
 * Exported because two callers must agree: quoteShipping refuses the order,
 * and GET /shipping/methods stops offering the tier. When those two disagree
 * the customer picks an option that then fails — which is exactly the class of
 * bug that produced "Validation failed" on the next-day tier.
 *
 * Returns { open, reason } — `reason` is customer-facing copy naming the speed
 * that was refused, so the message never tells someone to choose the very
 * option they just chose.
 */
function sameDayWindowOpen(settings, deliverySpeed = "same_day", now = new Date()) {
  const isExpress = deliverySpeed === "express";
  const name = isExpress ? "Express" : "Same-day";
  // Express is the same-day service, so it points at Next Day; same-day points
  // at the tiers below it.
  const alternatives = isExpress ? "Next Day or Standard" : "Standard or Next Day";

  const cutoffHour = Number.isFinite(settings.sameDayCutoffHour) ? settings.sameDayCutoffHour : 12;
  if (now.getHours() >= cutoffHour) {
    const stated = cutoffHour === 12 ? "12:00 PM" : `${cutoffHour}:00`;
    return {
      open: false,
      reason: `${name} delivery closes at ${stated}. Please choose ${alternatives} for this order.`,
    };
  }

  const closedDays =
    Array.isArray(settings.deliveryClosedDays) && settings.deliveryClosedDays.length
      ? new Set(settings.deliveryClosedDays)
      : new Set([0]); // 0 = Sunday
  if (closedDays.has(now.getDay())) {
    return {
      open: false,
      reason: `${name} delivery is not available today. Please choose ${alternatives}.`,
    };
  }

  return { open: true, reason: null };
}

/** Half-up rounding to whole pesewas. Inputs are non-negative money. */
function roundPesewas(amount) {
  return Math.floor(Number(amount) + 0.5);
}

/**
 * One order line's weight in kilograms, read ONLY from the DB product record.
 * Missing, zero, negative or non-numeric weight ⇒ ASSUMED_WEIGHT_KG with
 * `assumed: true`, so the quote can flag it and support can explain the charge.
 */
function convertWeightToKg(weight, unit) {
  const raw = Number(weight);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { kg: ASSUMED_WEIGHT_KG, assumed: true };
  }
  const factor =
    unit === "g" ? KG_PER_G : unit === "lb" ? KG_PER_LB : 1; // 'kg' + anything unexpected
  return { kg: raw * factor, assumed: false };
}

/**
 * Zone resolution:
 *   1. Direct neighbourhood match — the customer picked a neighbourhood from
 *      the dropdown, so we do an exact lookup against each zone's neighbourhoods
 *      array (already lowercased in the DB).
 *   2. Fallback — the city's default zone (isDefault), else lowest
 *      distanceMinKm then name asc, so an unflagged setup still quotes.
 *   3. Nothing active in the city ⇒ UnsupportedDeliveryAreaError naming the
 *      supported cities. Never fall through to a zero fee.
 */
function pickZoneByNeighborhood(cityZones, neighborhood) {
  const needle = String(neighborhood || "").trim().toLowerCase();
  if (!needle) return null;

  for (const zone of cityZones) {
    if ((zone.neighborhoods || []).includes(needle)) {
      return zone;
    }
  }
  return null;
}

function pickFallbackZone(cityZones) {
  const sorted = [...cityZones].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const aMin = a.distanceMinKm == null ? Number.MAX_VALUE : a.distanceMinKm;
    const bMin = b.distanceMinKm == null ? Number.MAX_VALUE : b.distanceMinKm;
    if (aMin !== bMin) return aMin - bMin;
    return a.name < b.name ? -1 : 1;
  });
  return sorted[0];
}

/**
 * Tier resolution — highest `level` across ALL items wins (one screen + twenty
 * cables prices at the screen tier); ties break on the higher multiplier.
 * Unmapped categories are expected, never an error: they simply contribute no
 * candidate. A cart of entirely unmapped categories resolves to the editable
 * `__default__` tier row, falling back to the frozen code constant.
 */
function selectTier(activeTiers, categories) {
  let winner = null;
  for (const category of categories) {
    const tier = activeTiers.find((t) => t.category === category);
    if (!tier) continue;
    if (
      !winner ||
      tier.level > winner.level ||
      (tier.level === winner.level && tier.multiplier > winner.multiplier)
    ) {
      winner = tier;
    }
  }
  if (winner) return winner;
  return (
    activeTiers.find((t) => t.category === DEFAULT_TIER_CATEGORY) || { ...DEFAULT_TIER }
  );
}

/**
 * The fee formula (brief Phase 2), evaluated in integer pesewas:
 *   fee = round(baseRate × tier.multiplier)
 *   fee = round(fee × speedMultiplier)
 *   billableKg = max(0, totalWeight − tier.weightThresholdKg)   // exactly at the threshold bills nothing
 *   fee = round(fee + billableKg × (tier.weightSurchargePerKg || perKgRate))
 *   fee += anyItemFragile ? tier.fragileSurcharge + zone.fragileSurcharge : 0
 *
 * When method is 'courier_dispatch', courierBaseRate / courierPerKgRate
 * are used instead of baseRate / perKgRate (falling back to the base values
 * when the courier-specific field is null).
 */
function computeFee({ zone, tier, totalWeightKg, speedMultiplier, anyItemFragile, method }) {
  const isCourier = method === "courier_dispatch";
  const baseRate = isCourier && zone.courierBaseRate != null ? zone.courierBaseRate : zone.baseRate;
  const fallbackPerKg = isCourier && zone.courierPerKgRate != null ? zone.courierPerKgRate : (zone.perKgRate || 0);

  let fee = roundPesewas(baseRate * tier.multiplier);
  fee = roundPesewas(fee * speedMultiplier);

  const billableKg = Math.max(0, totalWeightKg - (tier.weightThresholdKg || 0));
  const perKg = tier.weightSurchargePerKg || fallbackPerKg;
  fee = roundPesewas(fee + billableKg * perKg);

  if (anyItemFragile) {
    fee += (tier.fragileSurcharge || 0) + (zone.fragileSurcharge || 0);
  }
  return fee;
}

/**
 * The customer-facing name for a fulfilment choice — "Courier — Next Day",
 * "In-House Delivery", "Bus Station Pickup".
 *
 * Built from the zone's own speed tier so it matches exactly what the customer
 * was shown when choosing. Orders snapshot the result (like pickupLocationName)
 * so a later tier rename never rewrites what someone actually bought.
 */
function describeMethod(zone, method, deliverySpeed) {
  if (method === "bus_station_pickup") return "Bus Station Pickup";
  if (method === "in_house_delivery") return "In-House Delivery";
  const tier = (zone?.speedTiers || []).find((t) => t.code === deliverySpeed);
  if (tier) return `Courier — ${tier.label}`;
  // No tier configured: fall back to a readable form of the code rather than
  // showing a raw enum like "next_day".
  const pretty = String(deliverySpeed || "standard")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `Courier — ${pretty}`;
}

function speedMultiplierFor(zone, deliverySpeed) {
  if (deliverySpeed === "same_day") return zone.sameDayMultiplier || 1;
  if (deliverySpeed === "express") return zone.expressMultiplier || 1;
  return 1; // standard
}

/**
 * Estimated one-way distance for the zone, from its configured distance band.
 * No external maps/geocoding API is called (a paid dependency we avoid) — the
 * zone's distanceMinKm/distanceMaxKm serve as the estimator. Returns the band
 * midpoint, or 0 when the band is absent.
 */
function estimateDistanceKm(zone) {
  const min = zone.distanceMinKm;
  const max = zone.distanceMaxKm;
  if (min == null && max == null) return 0;
  const lo = min == null ? 0 : min;
  const hi = max == null ? lo : max;
  return (lo + hi) / 2;
}

/**
 * The distance to price this delivery from, in kilometres.
 *
 * Prefers the neighbourhood's measured Google driving distance (resolved by an
 * admin from business settings and cached in NeighborhoodDistance — see
 * services/shipping/googleDistance.js for why the API is never called here).
 * Falls back to the zone's distance band whenever the toggle is off, the
 * customer gave no neighbourhood, or that neighbourhood has never been
 * measured. The fallback is what makes enabling the toggle safe: a
 * half-populated distance table still quotes every address.
 *
 * The lookup rides the same TTL cache as the rest of the rate card, so a
 * repeat checkout from a popular neighbourhood costs no extra query.
 */
async function resolveDistanceKm({ settings, zone, city, neighborhood, region }) {
  if (!settings.useGoogleDistance || !neighborhood) {
    return { distanceKm: estimateDistanceKm(zone), distanceSource: "zone_band" };
  }

  const key = `dist:${String(region || "")}:${city}:${String(neighborhood).trim().toLowerCase()}`;
  const measured = await shippingCache.wrap(key, () =>
    NeighborhoodDistance.lookupKm({ region, city, neighborhood }),
  );

  if (measured == null) {
    logger.debug(
      `[shipping] no measured distance for "${neighborhood}" (${city}) — ` +
        "falling back to the zone distance band",
    );
    return { distanceKm: estimateDistanceKm(zone), distanceSource: "zone_band" };
  }
  return { distanceKm: measured, distanceSource: "google" };
}

/**
 * E2 Greater-Accra distance formula (pesewas):
 *   fee = round(distanceBaseFee + distanceKm × pricePerKm + weightKg × pricePerKg)
 * Falls back to the legacy fields when the E2 ones are missing, so a zone that
 * only has baseRate/perKgRate quotes exactly as T78 did. Fragile surcharge is
 * added once for the whole order (zone.fragileSurcharge — caller adds tier's).
 */
function computeDistanceFee({ zone, distanceKm, totalWeightKg, anyItemFragile }) {
  const baseFee = zone.distanceBaseFee != null ? zone.distanceBaseFee : zone.baseRate;
  const perKm = zone.pricePerKm || 0;
  const perKg = zone.pricePerKg != null ? zone.pricePerKg : (zone.perKgRate || 0);
  let fee = roundPesewas(
    baseFee + distanceKm * perKm + totalWeightKg * perKg,
  );
  if (anyItemFragile) fee += zone.fragileSurcharge || 0;
  return fee;
}

/**
 * E2 regional bus-station-pickup formula (pesewas):
 *   fee = round(regionalBaseFee + weightKg × regionalPricePerKg)
 * Fragile surcharge added once for the whole order. When regionalBaseFee is
 * null (unconfigured pickup), falls back to the legacy distance fields so the
 * formula never yields an accidental zero.
 */
function computeRegionalFee({ zone, totalWeightKg, anyItemFragile }) {
  const baseFee = zone.regionalBaseFee != null ? zone.regionalBaseFee : (zone.distanceBaseFee != null ? zone.distanceBaseFee : zone.baseRate);
  const perKg = zone.regionalPricePerKg != null ? zone.regionalPricePerKg : (zone.pricePerKg != null ? zone.pricePerKg : (zone.perKgRate || 0));
  let fee = roundPesewas(baseFee + totalWeightKg * perKg);
  if (anyItemFragile) fee += zone.fragileSurcharge || 0;
  return fee;
}

module.exports = {
  ASSUMED_WEIGHT_KG,
  DELIVERY_METHODS,
  PICKUP_METHODS,
  DELIVERY_SPEEDS,
  SAME_DAY_SPEEDS,
  sameDayWindowOpen,
  splitCourierMethodId,
  roundPesewas,
  convertWeightToKg,
  pickZoneByNeighborhood,
  pickFallbackZone,
  selectTier,
  computeFee,
  computeDistanceFee,
  computeRegionalFee,
  estimateDistanceKm,
  resolveDistanceKm,
  describeMethod,
  speedMultiplierFor,

  /**
   * Quote one order-level shipping fee.
   *
   * @param {object} params
   * @param {string} params.city  Delivery city ('Accra'|'Tema') — validated upstream by Zod too.
   * @param {string} params.neighborhood  Customer-selected neighbourhood (from the dropdown).
   * @param {string} [params.address] Free-text street address — for delivery instructions only.
   * @param {string} params.method 'in_house_delivery' | 'courier_dispatch'
   * @param {string} [params.deliverySpeed='standard'] 'standard' | 'same_day' | 'express'
   * @param {Array<{product: object, quantity: number}>} params.items
   *   Products MUST already be loaded from the DB by the caller (active checks
   *   included). Weight/category/fragility are read from these records only.
   * @param {number} params.subtotal Cart subtotal in pesewas (excludes shipping),
   *   server-computed — drives the free-delivery threshold.
   * @returns {object} quote — see README/docs for the field-by-field shape.
   */
  async quoteShipping({
    city, neighborhood, address, method, deliverySpeed = "standard", items, subtotal,
    region, pickupLocationId, neighborhoodId,
  }) {
    const settings = await shippingCache.wrap("settings", () =>
      ShippingSettingsModel.getSettings(),
    );

    const isPickup = PICKUP_METHODS.includes(method);
    const isDelivery = DELIVERY_METHODS.includes(method);
    if (!isDelivery && !isPickup) {
      const all = [...DELIVERY_METHODS, ...PICKUP_METHODS];
      throw new DisabledDeliveryMethodError(
        `Unsupported delivery method "${method}". Available methods: ${all.join(", ")}.`,
      );
    }

    // Method switches fail fast, before any zone/tier maths.
    if (method === "in_house_delivery" && !settings.inHouseDeliveryAvailable) {
      throw new DisabledDeliveryMethodError(
        "In-house delivery is currently unavailable. Please choose courier dispatch.",
      );
    }
    if (method === "courier_dispatch" && !settings.courierDispatchAvailable) {
      throw new DisabledDeliveryMethodError(
        "Courier dispatch is currently unavailable. Please contact support.",
      );
    }
    if (isPickup && !settings.pickupAvailable) {
      throw new DisabledDeliveryMethodError(
        "Bus-station pickup is currently unavailable. Please contact support.",
      );
    }
    if (deliverySpeed === "express" && !settings.expressAvailable) {
      throw new DisabledDeliveryMethodError("Express delivery is currently unavailable.");
    }

    // ── T80 same-day + Mon-Sat delivery rules ──────────────────────────────
    // Same-day has a hard 12:00 PM cutoff and is not offered on Sundays. The
    // server is the final authority — storefronts must not display same-day
    // past 12 PM and then fail server-side; instead they ask the calculator
    // (via getMethods) which speeds are bookable *now*.
    //
    // Configuration knobs (future-proof, defaulted): settings can override
    // the cutoff hour (defaults to 12) and the closed-day set (default
    // {Sunday}). Bus-station pickup is unaffected by either rule — the
    // pickup happens at a future bus departure, not a same-day window.
    // The `same_day` tier additionally needs its master switch on; express is
    // sold, so it answers to the window alone.
    if (deliverySpeed === "same_day" && isDelivery && !settings.sameDayAvailable) {
      throw new DisabledDeliveryMethodError(
        "Same-day delivery is not available. Please choose Standard or Express.",
      );
    }
    if (SAME_DAY_SPEEDS.includes(deliverySpeed) && isDelivery) {
      const window = sameDayWindowOpen(settings, deliverySpeed);
      if (!window.open) throw new DisabledDeliveryMethodError(window.reason);
    }

    // Rate reads ride the TTL cache; every admin write invalidates explicitly
    // (Phase 3), so the TTL is a safety net, not the invalidation story.
    const zones = await shippingCache.wrap("zones", () =>
      ShippingZone.find({ isActive: true }).lean(),
    );

    // ── Region resolution → fulfilment gate ───────────────────────────────
    // The authoritative in-core test is Location.inAccraCore. When the caller
    // supplies `region` we look it up; without it (legacy callers/tests) we
    // fall back to the closed Accra/Tema enum so nothing breaks.
    let inAccraCore;
    let zonePool;
    let regionLabel;
    if (region) {
      const LocationModel = Location;
      // Matched case-insensitively for the same reason as locationController:
      // an address saved while the region field was free text may carry
      // "greater accra", and an exact match there would silently drop the
      // customer out of the delivery core and into pickup.
      const loc = await shippingCache.wrap(`location:${String(region).toLowerCase()}:${String(city || "").toLowerCase()}`, () =>
        LocationModel.findOne({
          region: new RegExp(`^\\s*${String(region).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"),
          city: new RegExp(`^\\s*${String(city || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"),
          isActive: true,
        }).lean(),
      );
      inAccraCore = loc ? Boolean(loc.inAccraCore) : false;
      regionLabel = region;
      zonePool = zones.filter(
        (z) => z.region && z.region.toLowerCase() === String(region).toLowerCase(),
      );
      if (!zonePool.length) {
        zonePool = zones.filter((z) => z.city.toLowerCase() === String(city || "").toLowerCase());
      }
    } else {
      inAccraCore = LEGACY_CORE_CITIES.includes(city);
      regionLabel = null;
      zonePool = zones.filter((z) => z.city === city);
    }

    const supportedCities = ShippingSettingsModel.CITIES;
    if (!zonePool.length) {
      throw new UnsupportedDeliveryAreaError(supportedCities);
    }
    const zone = pickZoneByNeighborhood(zonePool, neighborhood) || pickFallbackZone(zonePool);

    // Delivery is only served in the Greater-Accra core; everywhere else is
    // pickup. Server-enforced — a client cannot smuggle home delivery into a
    // regional address, nor a pickup into the core (except the Nima warehouse
    // path handled at the checkout layer, distinct from bus_station_pickup).
    if (isDelivery && !inAccraCore) {
      throw new InvalidFulfilmentMethodError(
        "We only deliver within Greater Accra. For your area, please choose bus-station pickup.",
      );
    }
    if (isPickup && inAccraCore) {
      throw new InvalidFulfilmentMethodError(
        "Your area is served by home delivery — no bus-station pickup needed.",
      );
    }

    // In-house radius: a zone whose band reaches beyond the configured radius
    // goes to courier instead — suggest it by name so the storefront copy works.
    if (
      method === "in_house_delivery" &&
      settings.inHouseRadiusKm != null &&
      zone.distanceMaxKm != null &&
      zone.distanceMaxKm > settings.inHouseRadiusKm
    ) {
      throw new OutOfRangeError(
        "Your area is outside our own rider's range. Please choose courier dispatch instead.",
      );
    }

    // Tiers are used by the legacy delivery formula only; the E2 branches
    // price from the zone's own rate card, so tier resolution is deferred to
    // the legacy branch below to avoid a wasted query.
    const categories = [
      ...new Set(items.map(({ product }) => String(product.category || "").trim()).filter(Boolean)),
    ];

    // Weight: sum of line weights × quantities; any unknown line flags the quote.
    let totalWeightKg = 0;
    let weightAssumed = false;
    for (const { product, quantity } of items) {
      const { kg, assumed } = convertWeightToKg(product.weight, product.weightUnit);
      totalWeightKg += kg * quantity;
      if (assumed) {
        weightAssumed = true;
        logger.debug(
          `[shipping] product ${product._id || product.id} (${product.name}) has no usable ` +
            `weight — pricing its line at ${ASSUMED_WEIGHT_KG} kg`,
        );
      }
    }

    const anyItemFragile = items.some(({ product }) => Boolean(product.isFragile));

    // ── Fee computation (single source, branches on fulfilment) ────────────
    // Distance is resolved lazily, inside the one branch that prices from it —
    // a pickup or legacy-tier zone must not pay for a lookup it never reads.
    let grossShippingFee;
    let tierLevel;
    let distanceKm = null;
    let distanceSource = null;
    let feeBreakdown = null;
    let zoneSource = "legacy";
    let distanceZoneKey = null;

    // ── A–F distance-zone pricing ──────────────────────────────────────────
    // Takes precedence for Greater-Accra core delivery when switched on. The
    // resolver throws rather than guessing, and that error is deliberately NOT
    // caught here: an unresolvable zone must surface as a refused quote, never
    // decay into the cheapest rate. See ShippingSettings.useDistanceZones.
    if (settings.useDistanceZones && isDelivery && inAccraCore) {
      const resolved = neighborhoodId
        ? await resolveZoneByNeighborhoodId(neighborhoodId)
        : await resolveZoneByName(neighborhood, city);

      const priced = calcShippingWithBreakdown(
        resolved.zone, totalWeightKg, deliverySpeed, anyItemFragile,
      );

      // Courier dispatch is NEVER free: a third party is paid per delivery, so
      // there is a real cost to absorb and the customer is always shown it.
      // Only our own rider (in_house_delivery) is free.
      const isFree = method === "in_house_delivery";

      return {
        shippingFee: isFree ? 0 : priced.fee,
        grossShippingFee: priced.fee,
        freeDeliveryApplied: isFree,
        breakdown: priced.breakdown,
        method,
        methodLabel: describeMethod(resolved.zone, method, deliverySpeed),
        deliverySpeed,
        isPickup: false,
        zoneCode: resolved.zone.code,
        zoneName: resolved.zone.name,
        distanceZoneKey: resolved.zone.zoneKey,
        zoneSource: resolved.zoneSource,
        neighborhoodId: String(resolved.neighborhood._id),
        region: regionLabel,
        tierLevel: 0,
        distanceKm: resolved.neighborhood.distanceKm,
        distanceSource: resolved.neighborhood.distanceSource,
        totalWeightKg: Math.round(totalWeightKg * 100) / 100,
        weightAssumed,
        estimatedDays: resolved.zone.estimatedDays,
        estimatedDaysLabel: resolved.zone.estimatedDaysLabel || "",
        currency: "GHS",
      };
    }

    if (isPickup) {
      grossShippingFee = computeRegionalFee({ zone, totalWeightKg, anyItemFragile });
      tierLevel = 0;
    } else if (
      zone.distanceBaseFee != null ||
      zone.pricePerKm != null ||
      zone.pricePerKg != null
    ) {
      // E2 Greater-Accra distance formula (additive — only when the zone opts in).
      ({ distanceKm, distanceSource } = await resolveDistanceKm({
        settings, zone, city, neighborhood, region: regionLabel,
      }));
      grossShippingFee = computeDistanceFee({ zone, distanceKm, totalWeightKg, anyItemFragile });
      const tiers = await shippingCache.wrap("tiers", () =>
        ShippingTier.find({ isActive: true }).lean(),
      );
      tierLevel = selectTier(tiers, categories).level || 0;
    } else {
      // Legacy T78 delivery formula — unchanged behavior.
      const tiers = await shippingCache.wrap("tiers", () =>
        ShippingTier.find({ isActive: true }).lean(),
      );
      const tier = selectTier(tiers, categories);
      tierLevel = tier.level || 0;
      const speedMultiplier = speedMultiplierFor(zone, deliverySpeed);
      grossShippingFee = computeFee({ zone, tier, totalWeightKg, speedMultiplier, anyItemFragile, method });
    }

    // In-house delivery is always free; free delivery threshold only applies
    // to courier dispatch. A threshold of 0 (or null) disables free delivery —
    // only a positive value triggers it. Pickup is always charged its regional
    // fee (a service fee, not a delivery charge).
    // Free delivery is a property of WHO delivers, not of basket size:
    //   in_house_delivery  — our own rider, so nothing to recover: free.
    //   courier_dispatch   — a third party is paid per drop: never free.
    //   bus_station_pickup — a service fee, not a delivery charge: never free.
    const freeDeliveryApplied = method === "in_house_delivery";

    return {
      shippingFee: freeDeliveryApplied ? 0 : grossShippingFee,
      grossShippingFee,
      freeDeliveryApplied,
      method,
      methodLabel: describeMethod(zone, method, deliverySpeed),
      deliverySpeed,
      isPickup,
      zoneCode: zone.code,
      zoneName: zone.name,
      distanceZoneKey,
      zoneSource,
      breakdown: feeBreakdown,
      distanceKm,
      distanceSource,
      region: regionLabel,
      tierLevel,
      totalWeightKg: Math.round(totalWeightKg * 100) / 100,
      weightAssumed,
      estimatedDays: isPickup ? null : zone.estimatedDays,
      currency: "GHS",
    };
  },
};
