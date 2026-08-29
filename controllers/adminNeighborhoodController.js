/**
 * adminNeighborhoodController.js — CRUD + distance recalculation for the
 * serviceable neighbourhoods.
 *
 * Geocoding and distance measurement live HERE, never on the checkout path.
 */
const Neighborhood = require("../models/Neighborhood");
const ShippingZone = require("../models/ShippingZone");
const { classifyZone } = require("../services/shipping/zoneClassification");
const googleDistance = require("../services/shipping/googleDistance");
const { WAREHOUSE_LOCATION, warehouseOriginCoords } = require("../config/warehouseConfig");
const { shippingCache } = require("../services/shipping/shippingCache");
const { logFromRequest, ACTIONS } = require("../services/activityLogService");

const invalidate = () => shippingCache.invalidateAll();

const audit = (req, payload) =>
  logFromRequest(req, {
    action: payload.action || ACTIONS.SETTINGS_UPDATED,
    resourceType: "SETTINGS",
    resourceId: String(payload.resourceId || ""),
    resourceName: String(payload.resourceName || ""),
    description: String(payload.description || ""),
    changes: Array.isArray(payload.changes) ? payload.changes : [],
    metadata: {},
  });

const listNeighborhoods = async (req, res, next) => {
  try {
    const { city, zone, q, includeInactive } = req.query;
    const filter = {
      ...(city ? { city } : {}),
      ...(zone ? { assignedZone: String(zone).toUpperCase() } : {}),
      ...(includeInactive === "true" ? {} : { isActive: true }),
      ...(q ? { name: new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } : {}),
    };
    const rows = await Neighborhood.find(filter).sort({ city: 1, name: 1 }).lean();
    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) { next(err); }
};

const createNeighborhood = async (req, res, next) => {
  try {
    const row = await Neighborhood.create(req.body);
    invalidate();
    await audit(req, {
      resourceId: row._id,
      resourceName: `${row.name}, ${row.city}`,
      description: `Neighbourhood ${row.name} created in zone ${row.assignedZone}`,
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
};

const updateNeighborhood = async (req, res, next) => {
  try {
    const row = await Neighborhood.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Neighbourhood not found" });

    const before = row.assignedZone;
    const allowed = [
      "name", "city", "municipality", "lat", "lng",
      "distanceKm", "distanceSource", "assignedZone", "zoneOverride", "isActive",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) row[key] = req.body[key];
    }
    // An admin who sets the zone by hand is recording a business decision, not
    // a measurement — flag it so the recalculation job never quietly undoes it.
    if (req.body.assignedZone !== undefined && req.body.assignedZone !== before) {
      row.zoneOverride = req.body.zoneOverride !== undefined ? req.body.zoneOverride : true;
    }
    await row.save();
    invalidate();

    await audit(req, {
      resourceId: row._id,
      resourceName: `${row.name}, ${row.city}`,
      description: `Neighbourhood ${row.name} updated`,
      changes: before !== row.assignedZone
        ? [{ field: "assignedZone", label: "Zone", before, after: row.assignedZone }]
        : [],
    });
    res.status(200).json({ success: true, data: row });
  } catch (err) { next(err); }
};

const deleteNeighborhood = async (req, res, next) => {
  try {
    const row = await Neighborhood.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Neighbourhood not found" });
    // Deactivate rather than delete: historical orders reference these by id.
    row.isActive = false;
    await row.save();
    invalidate();
    await audit(req, {
      resourceId: row._id,
      resourceName: `${row.name}, ${row.city}`,
      description: `Neighbourhood ${row.name} deactivated`,
    });
    res.status(200).json({ success: true, data: { deactivated: true } });
  } catch (err) { next(err); }
};

/**
 * Measure one neighbourhood's real driving distance and reassign its zone.
 * Skips the reassignment when zoneOverride is set — the measurement is still
 * stored, so the override and the evidence sit side by side.
 */
async function recalculateOne(row) {
  const destination = `${row.lat},${row.lng}`;
  const [result] = await googleDistance.resolveDistances(warehouseOriginCoords(), [destination]);
  if (!result || result.distanceKm == null) {
    return { name: row.name, ok: false, reason: result?.status || "NOT_FOUND" };
  }

  const previousZone = row.assignedZone;
  row.distanceKm = result.distanceKm;
  row.distanceSource = "google";
  row.distanceMeasuredAt = new Date();

  let newZone = previousZone;
  if (!row.zoneOverride) {
    newZone = await classifyZone(result.distanceKm);
    row.assignedZone = newZone;
  }
  await row.save();

  return {
    name: row.name,
    ok: true,
    distanceKm: result.distanceKm,
    previousZone,
    assignedZone: newZone,
    zoneChanged: newZone !== previousZone,
    overrideRespected: row.zoneOverride,
  };
}

const recalculateNeighborhood = async (req, res, next) => {
  try {
    if (!googleDistance.hasConfig()) {
      return res.status(400).json({
        success: false,
        error: "GOOGLE_MAPS_API_KEY is not configured on the server.",
      });
    }
    const row = await Neighborhood.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Neighbourhood not found" });

    let result;
    try {
      result = await recalculateOne(row);
    } catch (err) {
      return res.status(502).json({ success: false, error: `Google Maps lookup failed: ${err.message}` });
    }
    invalidate();
    await audit(req, {
      resourceId: row._id,
      resourceName: `${row.name}, ${row.city}`,
      description: `Recalculated ${row.name}: ${result.distanceKm} km → zone ${result.assignedZone}`,
    });
    res.status(200).json({ success: true, data: result, meta: { origin: WAREHOUSE_LOCATION.address } });
  } catch (err) { next(err); }
};

/**
 * Batch recalculation. Deliberately capped per request: this is the only place
 * in the app that can spend real money in a loop.
 */
const recalculateAll = async (req, res, next) => {
  try {
    if (!googleDistance.hasConfig()) {
      return res.status(400).json({
        success: false,
        error: "GOOGLE_MAPS_API_KEY is not configured on the server.",
      });
    }
    const { city, limit } = req.body || {};
    const cap = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);

    const rows = await Neighborhood.find({
      isActive: true,
      ...(city ? { city } : {}),
      // Cheapest first: never re-measure what already has a real measurement.
      $or: [{ distanceSource: { $ne: "google" } }, { distanceMeasuredAt: null }],
    }).limit(cap);

    const results = [];
    for (const row of rows) {
      try {
        results.push(await recalculateOne(row));
      } catch (err) {
        results.push({ name: row.name, ok: false, reason: err.message });
        // A hard failure (billing, quota) will hit every subsequent row too.
        break;
      }
    }
    invalidate();

    const changed = results.filter((r) => r.zoneChanged);
    await audit(req, {
      resourceId: "neighborhood-recalc",
      resourceName: city || "all cities",
      description:
        `Recalculated ${results.filter((r) => r.ok).length} neighbourhood distance(s); ` +
        `${changed.length} zone change(s)`,
    });

    res.status(200).json({
      success: true,
      data: results,
      meta: {
        attempted: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        zoneChanges: changed,
        remaining: await Neighborhood.countDocuments({
          isActive: true,
          ...(city ? { city } : {}),
          $or: [{ distanceSource: { $ne: "google" } }, { distanceMeasuredAt: null }],
        }),
        origin: WAREHOUSE_LOCATION.address,
      },
    });
  } catch (err) { next(err); }
};

/** Coverage report — which neighbourhoods still lack a measured distance. */
const distanceCoverage = async (req, res, next) => {
  try {
    const [total, measured, overrides, zones] = await Promise.all([
      Neighborhood.countDocuments({ isActive: true }),
      Neighborhood.countDocuments({ isActive: true, distanceSource: "google" }),
      Neighborhood.countDocuments({ isActive: true, zoneOverride: true }),
      ShippingZone.getActiveZones(),
    ]);
    const byZone = await Neighborhood.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$assignedZone", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    // The full city list, so the admin filter keeps every option available
    // even while filtered down to one city.
    const cities = await Neighborhood.distinct("city", { isActive: true });
    res.status(200).json({
      success: true,
      data: {
        total,
        measured,
        estimated: total - measured,
        overrides,
        byZone: byZone.map((z) => ({ zone: z._id, count: z.count })),
        cities: cities.sort(),
        zones: zones.map((z) => ({ zone: z.zoneKey, range: `${z.distanceMinKm}-${z.distanceMaxKm} km` })),
        origin: WAREHOUSE_LOCATION.address,
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  listNeighborhoods,
  createNeighborhood,
  updateNeighborhood,
  deleteNeighborhood,
  recalculateNeighborhood,
  recalculateAll,
  distanceCoverage,
};
