const ShippingZone = require("../models/ShippingZone");
const ShippingTier = require("../models/ShippingTier");
const ShippingSettings = require("../models/ShippingSettings");
const { DEFAULT_TIER_CATEGORY } = require("../models/ShippingTier");
const { shippingCache } = require("../services/shipping/shippingCache");
const Location = require("../models/Location");
const NeighborhoodDistance = require("../models/NeighborhoodDistance");
const { buildOriginKey } = require("../models/NeighborhoodDistance");
const googleDistance = require("../services/shipping/googleDistance");
const { logFromRequest, ACTIONS } = require("../services/activityLogService");

const invalidate = () => shippingCache.invalidateAll();

const audit = async (req, { action, resourceType, resourceId, resourceName, description, changes, metadata }) => {
  await logFromRequest(req, {
    action,
    resourceType: resourceType || "SETTINGS",
    resourceId: String(resourceId || ""),
    resourceName: String(resourceName || ""),
    description: String(description || ""),
    changes: Array.isArray(changes) ? changes : [],
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  });
};

// ── Zones ────────────────────────────────────────────────────────────────────

const listZones = async (req, res, next) => {
  try {
    const zones = await ShippingZone.find().sort({ city: 1, name: 1 }).lean();
    res.status(200).json({ success: true, count: zones.length, data: zones });
  } catch (err) { next(err); }
};

const getZone = async (req, res, next) => {
  try {
    const zone = await ShippingZone.findById(req.params.id).lean();
    if (!zone) return res.status(404).json({ success: false, error: "Shipping zone not found." });
    res.status(200).json({ success: true, data: zone });
  } catch (err) { next(err); }
};

const createZone = async (req, res, next) => {
  try {
    const body = { ...req.body };
    // When a new zone is marked default, clear the flag on every other zone in
    // the same city so there is exactly one default per city.
    if (body.isDefault && body.city) {
      await ShippingZone.updateMany(
        { city: body.city, isDefault: true },
        { $set: { isDefault: false } },
      );
    }
    const zone = await ShippingZone.create(body);
    invalidate();
    await audit(req, {
      action: "SHIPPING_ZONE_CREATED",
      resourceType: "SETTINGS",
      resourceId: zone._id,
      resourceName: zone.name,
      description: `Shipping zone "${zone.name}" (${zone.code}) created for ${zone.city}`,
    });
    res.status(201).json({ success: true, data: zone });
  } catch (err) { next(err); }
};

const updateZone = async (req, res, next) => {
  try {
    const body = { ...req.body };
    // Same isDefault-housekeeping as createZone.
    if (body.isDefault) {
      const existing = await ShippingZone.findById(req.params.id).lean();
      const city = body.city || (existing && existing.city);
      if (city) {
        await ShippingZone.updateMany(
          { city, isDefault: true, _id: { $ne: req.params.id } },
          { $set: { isDefault: false } },
        );
      }
    }
    const zone = await ShippingZone.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    if (!zone) return res.status(404).json({ success: false, error: "Shipping zone not found." });
    invalidate();
    await audit(req, {
      action: "SHIPPING_ZONE_UPDATED",
      resourceType: "SETTINGS",
      resourceId: zone._id,
      resourceName: zone.name,
      description: `Shipping zone "${zone.name}" (${zone.code}) updated`,
    });
    res.status(200).json({ success: true, data: zone });
  } catch (err) { next(err); }
};

const deleteZone = async (req, res, next) => {
  try {
    const zone = await ShippingZone.findByIdAndDelete(req.params.id);
    if (!zone) return res.status(404).json({ success: false, error: "Shipping zone not found." });
    invalidate();
    await audit(req, {
      action: "SHIPPING_ZONE_DELETED",
      resourceType: "SETTINGS",
      resourceId: zone._id,
      resourceName: zone.name,
      description: `Shipping zone "${zone.name}" (${zone.code}) deleted`,
    });
    res.status(200).json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
};

// ── Tiers ────────────────────────────────────────────────────────────────────

const listTiers = async (req, res, next) => {
  try {
    const tiers = await ShippingTier.find().sort({ level: -1, multiplier: -1 }).lean();
    res.status(200).json({ success: true, count: tiers.length, data: tiers });
  } catch (err) { next(err); }
};

const getTier = async (req, res, next) => {
  try {
    const tier = await ShippingTier.findById(req.params.id).lean();
    if (!tier) return res.status(404).json({ success: false, error: "Shipping tier not found." });
    res.status(200).json({ success: true, data: tier });
  } catch (err) { next(err); }
};

const createTier = async (req, res, next) => {
  try {
    const tier = await ShippingTier.create(req.body);
    invalidate();
    await audit(req, {
      action: "SHIPPING_TIER_CREATED",
      resourceType: "SETTINGS",
      resourceId: tier._id,
      resourceName: tier.name,
      description: `Shipping tier "${tier.name}" (category: ${tier.category}) created`,
    });
    res.status(201).json({ success: true, data: tier });
  } catch (err) { next(err); }
};

const updateTier = async (req, res, next) => {
  try {
    const tier = await ShippingTier.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!tier) return res.status(404).json({ success: false, error: "Shipping tier not found." });
    invalidate();
    await audit(req, {
      action: "SHIPPING_TIER_UPDATED",
      resourceType: "SETTINGS",
      resourceId: tier._id,
      resourceName: tier.name,
      description: `Shipping tier "${tier.name}" (category: ${tier.category}) updated`,
    });
    res.status(200).json({ success: true, data: tier });
  } catch (err) { next(err); }
};

const deleteTier = async (req, res, next) => {
  try {
    const tier = await ShippingTier.findByIdAndDelete(req.params.id);
    if (!tier) return res.status(404).json({ success: false, error: "Shipping tier not found." });
    if (tier.category === DEFAULT_TIER_CATEGORY) {
      return res.status(400).json({ success: false, error: "The default tier cannot be deleted." });
    }
    invalidate();
    await audit(req, {
      action: "SHIPPING_TIER_DELETED",
      resourceType: "SETTINGS",
      resourceId: tier._id,
      resourceName: tier.name,
      description: `Shipping tier "${tier.name}" (category: ${tier.category}) deleted`,
    });
    res.status(200).json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
};

// ── Settings ─────────────────────────────────────────────────────────────────

const getSettings = async (req, res, next) => {
  try {
    const settings = await ShippingSettings.getSettings();
    res.status(200).json({ success: true, data: settings });
  } catch (err) { next(err); }
};

const updateSettings = async (req, res, next) => {
  try {
    const settings = await ShippingSettings.getSettings();
    const allowed = [
      "inHouseDeliveryAvailable", "courierDispatchAvailable", "expressAvailable",
      "sameDayAvailable",
      "freeDeliveryThreshold", "inHouseRadiusKm",
      "sameCityFee", "crossCityFee", "heavyItemFee", "heavyItemThresholdKg",
      "expressSurcharge",
      // T80 — same-day cutoff + closed-day knobs.
      "sameDayCutoffHour", "deliveryClosedDays",
      // Google-Maps distance pricing: the measurement origin + master switch.
      "originAddress", "useGoogleDistance",
      // A–F distance-zone pricing.
      "useDistanceZones",
    ];
    const changes = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined && req.body[key] !== settings[key]) {
        changes.push({ field: key, label: key, before: settings[key], after: req.body[key] });
        settings[key] = req.body[key];
      }
    }
    if (!changes.length) {
      return res.status(200).json({ success: true, data: settings, meta: { noChanges: true } });
    }
    await settings.save();
    invalidate();
    await audit(req, {
      action: ACTIONS.SETTINGS_UPDATED,
      resourceType: "SETTINGS",
      resourceId: settings._id,
      resourceName: "Shipping Settings",
      description: `Shipping settings updated: ${changes.map((c) => c.field).join(", ")}`,
      changes,
    });
    res.status(200).json({ success: true, data: settings });
  } catch (err) { next(err); }
};

// ── Courier Rate ────────────────────────────────────────────────────────────

const getOrCreateCourierRate = async (req, res, next) => {
  try {
    const CourierRate = require("../models/CourierRate");
    const doc = await CourierRate.getOrCreate();
    res.status(200).json({ success: true, data: doc });
  } catch (err) { next(err); }
};

const updateCourierRate = async (req, res, next) => {
  try {
    const CourierRate = require("../models/CourierRate");
    let doc = await CourierRate.findOne({ code: "COURIER_PAYOUT" });
    if (!doc) doc = await CourierRate.create({ code: "COURIER_PAYOUT" });

    const allowed = ["mode", "percentage", "flatAmount", "zoneRates", "isActive"];
    const changes = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        changes.push({ field: key, label: key, before: doc[key], after: req.body[key] });
        doc[key] = req.body[key];
      }
    }
    await doc.save();
    invalidate();
    await audit(req, {
      action: "SHIPPING_COURIER_RATE_UPDATED",
      resourceType: "SETTINGS",
      resourceId: doc._id,
      resourceName: doc.code,
      description: `Courier payout config updated: ${changes.map((c) => c.field).join(", ")}`,
      changes,
    });
    res.status(200).json({ success: true, data: doc });
  } catch (err) { next(err); }
};

// ── Delivery Charges (Phase 5) ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/shipping/delivery-charges?from=&to=&method=
 * Aggregated summary grouped by zone and method. Read-only.
 */
const deliveryChargeSummary = async (req, res, next) => {
  try {
    const DeliveryCharge = require("../models/DeliveryCharge");
    const match = {};
    if (req.query.from || req.query.to) {
      match.createdAt = {};
      if (req.query.from) match.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) match.createdAt.$lte = new Date(req.query.to);
    }
    if (req.query.method) match.method = req.query.method;

    const [totals, byZone, byMethod] = await Promise.all([
      // Overall totals
      DeliveryCharge.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalCollected: { $sum: "$shippingFeeCollected" },
            totalPayout: { $sum: "$courierPayout" },
            totalMargin: { $sum: "$retainedMargin" },
            refundedCount: { $sum: { $cond: ["$refunded", 1, 0] } },
            refundedAmount: { $sum: { $cond: ["$refunded", "$shippingFeeCollected", 0] } },
          },
        },
      ]),
      // Grouped by zoneCode
      DeliveryCharge.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $ifNull: ["$zoneCode", "UNKNOWN"] },
            count: { $sum: 1 },
            totalCollected: { $sum: "$shippingFeeCollected" },
            totalPayout: { $sum: "$courierPayout" },
            totalMargin: { $sum: "$retainedMargin" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Grouped by method
      DeliveryCharge.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $ifNull: ["$method", "UNKNOWN"] },
            count: { $sum: 1 },
            totalCollected: { $sum: "$shippingFeeCollected" },
            totalPayout: { $sum: "$courierPayout" },
            totalMargin: { $sum: "$retainedMargin" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totals: totals[0] || { count: 0, totalCollected: 0, totalPayout: 0, totalMargin: 0, refundedCount: 0, refundedAmount: 0 },
        byZone,
        byMethod,
      },
    });
  } catch (err) { next(err); }
};

/**
 * PATCH /api/v1/admin/shipping/delivery-charges/:id/refund
 * Manually mark a DeliveryCharge as refunded (for orders settled outside
 * Paystack, e.g. bank transfer or cash-on-delivery refunds).
 */
const manualRefundDeliveryCharge = async (req, res, next) => {
  try {
    const DeliveryCharge = require("../models/DeliveryCharge");
    const charge = await DeliveryCharge.findById(req.params.id);
    if (!charge) return res.status(404).json({ success: false, error: "Delivery charge not found." });
    if (charge.refunded) return res.status(409).json({ success: false, error: "Already refunded." });

    charge.refunded = true;
    charge.refundedAt = new Date();
    await charge.save();
    await audit(req, {
      action: "DELIVERY_CHARGE_REFUNDED",
      resourceType: "SETTINGS",
      resourceId: charge._id,
      resourceName: `Order ${charge.orderId}`,
      description: `Delivery charge for order ${charge.orderId} manually marked refunded`,
    });
    res.status(200).json({ success: true, data: charge });
  } catch (err) { next(err); }
};


// ── Neighbourhood distances (Google Maps) ────────────────────────────────────
//
// The admin flow: add neighbourhoods to a city (Location), then resolve their
// driving distances from the configured origin. The quote path only ever reads
// the resolved numbers — see services/shipping/googleDistance.js.

/**
 * GET /api/v1/admin/shipping/distances?region=&city=
 * Every neighbourhood in the city with its measured distance (or null when it
 * has never been resolved), so the admin sees the gaps at a glance.
 */
const listNeighborhoodDistances = async (req, res, next) => {
  try {
    const { region, city } = req.query;
    if (!city) {
      return res.status(400).json({ success: false, error: "A city is required." });
    }

    const settings = await ShippingSettings.getSettings();
    const originKey = buildOriginKey(settings.originAddress);

    const location = await Location.findOne({
      city,
      ...(region ? { region } : {}),
    }).lean();
    const neighborhoods = location?.neighborhoods || [];

    const rows = await NeighborhoodDistance.find({
      city,
      ...(region ? { region } : {}),
    }).lean();
    const byName = new Map(rows.map((r) => [r.neighborhood, r]));

    // Drive the list off Location, not off the distance table, so a
    // neighbourhood that has never been resolved still shows up as a gap.
    const data = neighborhoods.map((neighborhood) => {
      const row = byName.get(neighborhood);
      return {
        neighborhood,
        distanceKm: row ? row.distanceKm : null,
        durationMins: row ? row.durationMins : null,
        source: row ? row.source : null,
        resolvedAddress: row ? row.resolvedAddress : null,
        resolvedAt: row ? row.resolvedAt : null,
        // Measured from an origin that is no longer the configured one.
        stale: row ? row.originKey !== originKey : false,
      };
    });

    res.status(200).json({
      success: true,
      data,
      meta: {
        region: region || null,
        city,
        originAddress: settings.originAddress || "",
        useGoogleDistance: settings.useGoogleDistance,
        googleConfigured: googleDistance.hasConfig(),
        resolved: data.filter((d) => d.distanceKm != null).length,
        total: data.length,
      },
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/v1/admin/shipping/distances/resolve
 * Body: { region, city, neighborhoods?: string[], force?: boolean }
 *
 * Measures driving distance from the configured origin to each neighbourhood
 * and caches the result. Skips ones already resolved from the current origin
 * unless `force` is set, so a re-run after adding two neighbourhoods bills for
 * two lookups, not the whole city. Manually-entered distances are never
 * overwritten unless forced.
 */
const resolveNeighborhoodDistances = async (req, res, next) => {
  try {
    const { region, city, neighborhoods, force } = req.body;
    if (!city) {
      return res.status(400).json({ success: false, error: "A city is required." });
    }
    if (!googleDistance.hasConfig()) {
      return res.status(400).json({
        success: false,
        error: "GOOGLE_MAPS_API_KEY is not configured on the server.",
      });
    }

    const settings = await ShippingSettings.getSettings();
    const origin = String(settings.originAddress || "").trim();
    if (!origin) {
      return res.status(400).json({
        success: false,
        error: "Set the origin address in shipping settings before resolving distances.",
      });
    }
    const originKey = buildOriginKey(origin);

    const location = await Location.findOne({
      city,
      ...(region ? { region } : {}),
    }).lean();
    if (!location) {
      return res.status(404).json({ success: false, error: "No such city." });
    }

    // Either the explicit subset the admin ticked, or the whole city.
    const requested = Array.isArray(neighborhoods) && neighborhoods.length
      ? neighborhoods.map((n) => String(n).trim().toLowerCase()).filter(Boolean)
      : location.neighborhoods;

    // Only measure what actually needs measuring, so a re-run is cheap.
    const existing = await NeighborhoodDistance.find({
      city,
      neighborhood: { $in: requested },
      ...(region ? { region } : {}),
    }).lean();
    // Skip a neighbourhood when it is already measured from the CURRENT origin,
    // or when an admin typed the number by hand — a bulk re-resolve must never
    // silently overwrite a manual override. `force` ignores both.
    const skip = new Set(
      force
        ? []
        : existing
            .filter((r) => r.source === "manual" || r.originKey === originKey)
            .map((r) => r.neighborhood),
    );
    const todo = requested.filter((n) => !skip.has(n));

    if (!todo.length) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: { resolved: 0, failed: 0, skipped: requested.length, origin },
      });
    }

    const addresses = todo.map((neighborhood) =>
      googleDistance.buildDestinationAddress({ neighborhood, city, region: region || location.region }),
    );

    let results;
    try {
      results = await googleDistance.resolveDistances(origin, addresses);
    } catch (err) {
      // A hard failure is a configuration problem (bad key, quota, network) —
      // surface it rather than writing partial garbage.
      return res.status(502).json({
        success: false,
        error: `Google Maps lookup failed: ${err.message}`,
      });
    }

    const saved = [];
    const failed = [];
    for (let i = 0; i < todo.length; i += 1) {
      const neighborhood = todo[i];
      const result = results[i];
      if (!result || result.distanceKm == null) {
        failed.push({ neighborhood, reason: result?.status || "NOT_FOUND" });
        continue;
      }
      const row = await NeighborhoodDistance.record(
        { region: region || location.region, city, neighborhood },
        {
          distanceKm: result.distanceKm,
          durationMins: result.durationMins,
          originKey,
          originAddress: origin,
          resolvedAddress: addresses[i],
          source: "google",
        },
      );
      saved.push({
        neighborhood,
        distanceKm: row.distanceKm,
        durationMins: row.durationMins,
      });
    }

    // New distances must reach the quote path immediately, not after the TTL.
    invalidate();

    await audit(req, {
      action: ACTIONS.SETTINGS_UPDATED,
      resourceType: "SETTINGS",
      resourceId: "shipping-distances",
      resourceName: `${city} neighbourhood distances`,
      description:
        `Resolved ${saved.length} neighbourhood distance(s) for ${city} from "${origin}"` +
        (failed.length ? ` (${failed.length} unresolved)` : ""),
    });

    res.status(200).json({
      success: true,
      data: saved,
      meta: {
        resolved: saved.length,
        failed: failed.length,
        skipped: requested.length - todo.length,
        failures: failed,
        origin,
      },
    });
  } catch (err) { next(err); }
};

/**
 * PATCH /api/v1/admin/shipping/distances
 * Body: { region, city, neighborhood, distanceKm }
 * Manual override for a neighbourhood Google cannot route to (informal
 * settlements, new developments). Stored with source 'manual' so a bulk
 * re-resolve leaves it alone.
 */
const setManualNeighborhoodDistance = async (req, res, next) => {
  try {
    const { region, city, neighborhood, distanceKm } = req.body;
    if (!city || !neighborhood) {
      return res.status(400).json({
        success: false,
        error: "A city and neighbourhood are required.",
      });
    }
    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km < 0) {
      return res.status(400).json({
        success: false,
        error: "distanceKm must be a non-negative number.",
      });
    }

    const settings = await ShippingSettings.getSettings();
    const origin = String(settings.originAddress || "").trim();

    const row = await NeighborhoodDistance.record(
      { region: region || "", city, neighborhood },
      {
        distanceKm: Math.round(km * 100) / 100,
        durationMins: null,
        originKey: buildOriginKey(origin),
        originAddress: origin,
        resolvedAddress: "",
        source: "manual",
      },
    );
    invalidate();

    await audit(req, {
      action: ACTIONS.SETTINGS_UPDATED,
      resourceType: "SETTINGS",
      resourceId: row._id,
      resourceName: `${neighborhood} (${city})`,
      description: `Distance for ${neighborhood}, ${city} set manually to ${row.distanceKm} km`,
      changes: [{ field: "distanceKm", label: "Distance (km)", before: null, after: row.distanceKm }],
    });

    res.status(200).json({ success: true, data: row });
  } catch (err) { next(err); }
};

module.exports = {
  listZones, getZone, createZone, updateZone, deleteZone,
  listTiers, getTier, createTier, updateTier, deleteTier,
  getSettings, updateSettings,
  getOrCreateCourierRate, updateCourierRate,
  deliveryChargeSummary, manualRefundDeliveryCharge,
  listNeighborhoodDistances, resolveNeighborhoodDistances, setManualNeighborhoodDistance,
};
