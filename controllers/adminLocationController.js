const Location = require("../models/Location");
const { logFromRequest, ACTIONS } = require("../services/activityLogService");
const { invalidateLocationCache } = require("./locationController");

// T80 E2 — admin CRUD over the Location taxonomy (region → city →
// neighborhoods). One row per (region, city) pair, neighborhoods are a
// lowercased + de-duped string array on save. Public listing lives in
// controllers/locationController.js (next file); this file is admin-only.

const audit = async (req, { action, resourceId, resourceName, description, changes }) => {
  await logFromRequest(req, {
    action,
    resourceType: "LOCATION",
    resourceId: String(resourceId || ""),
    resourceName: String(resourceName || ""),
    description: String(description || ""),
    changes: Array.isArray(changes) ? changes : [],
  });
};

// ── List ──────────────────────────────────────────────────────────────────────
// Optional `?region=` filter keeps a noisy dropdown from showing 200 cities at
// once. `?inAccraCore=true` is the Greater-Accra-only view the frontend uses
// to decide between delivery and bus-station pickup UX.
const listLocations = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.region) {
      filter.region = new RegExp(`^${String(req.query.region).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }
    if (req.query.inAccraCore === "true") filter.inAccraCore = true;
    if (req.query.inAccraCore === "false") filter.inAccraCore = false;
    if (req.query.isActive === "true") filter.isActive = true;
    if (req.query.isActive === "false") filter.isActive = false;

    const locations = await Location.find(filter)
      .sort({ region: 1, city: 1 })
      .lean();

    res.status(200).json({ success: true, count: locations.length, data: locations });
  } catch (err) { next(err); }
};

const getLocation = async (req, res, next) => {
  try {
    const loc = await Location.findById(req.params.id).lean();
    if (!loc) return res.status(404).json({ success: false, error: "Location not found." });
    res.status(200).json({ success: true, data: loc });
  } catch (err) { next(err); }
};

const createLocation = async (req, res, next) => {
  try {
    const { region, city, neighborhoods, inAccraCore, isActive } = req.body;
    if (!region || !city) {
      return res.status(400).json({
        success: false,
        error: "region and city are required.",
      });
    }
    // The unique { region, city } index rejects duplicates up front.
    const existing = await Location.findOne({ region, city });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: `Location "${region} → ${city}" already exists.`,
      });
    }

    const loc = await Location.create({
      region: String(region).trim(),
      city: String(city).trim(),
      neighborhoods: Array.isArray(neighborhoods) ? neighborhoods : [],
      inAccraCore: Boolean(inAccraCore),
      isActive: isActive !== false,
    });

    invalidateLocationCache();

    await audit(req, {
      action: "LOCATION_CREATED",
      resourceId: loc._id,
      resourceName: `${loc.region} → ${loc.city}`,
      description: `Location ${loc.region} → ${loc.city} created${loc.inAccraCore ? " (Greater-Accra core)" : ""}`,
    });

    res.status(201).json({ success: true, data: loc });
  } catch (err) {
    // Duplicate-key from the unique index — surface as 409, not 500.
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "A location with that region + city already exists.",
      });
    }
    next(err);
  }
};

const updateLocation = async (req, res, next) => {
  try {
    const existing = await Location.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Location not found." });
    }

    const changes = [];
    const { region, city, neighborhoods, inAccraCore, isActive } = req.body;
    const set = (field, before, after, label) => {
      if (after !== undefined && after !== before) {
        changes.push({ field, label: label || field, before, after });
        existing[field] = after;
      }
    };

    set("region", existing.region, region ? String(region).trim() : undefined, "Region");
    set("city", existing.city, city ? String(city).trim() : undefined, "City");
    if (neighborhoods !== undefined) {
      const before = existing.neighborhoods;
      existing.neighborhoods = Array.isArray(neighborhoods) ? neighborhoods : [];
      if (JSON.stringify(before) !== JSON.stringify(existing.neighborhoods)) {
        changes.push({ field: "neighborhoods", label: "Neighborhoods", before, after: existing.neighborhoods });
      }
    }
    set("inAccraCore", existing.inAccraCore, inAccraCore, "Greater-Accra Core");
    set("isActive", existing.isActive, isActive, "Active");

    if (!changes.length) {
      return res.status(200).json({ success: true, data: existing, meta: { noChanges: true } });
    }

    await existing.save();
    invalidateLocationCache();

    await audit(req, {
      action: "LOCATION_UPDATED",
      resourceId: existing._id,
      resourceName: `${existing.region} → ${existing.city}`,
      description: `Location ${existing.region} → ${existing.city} updated: ${changes.map((c) => c.field).join(", ")}`,
      changes,
    });

    res.status(200).json({ success: true, data: existing });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "A location with that region + city already exists.",
      });
    }
    next(err);
  }
};

// Soft-deactivate by default. Hard-delete is exposed via ?hard=true for the
// odd case where a typo'd row never shipped to any customer — in that case no
// historical orders reference it.
const deleteLocation = async (req, res, next) => {
  try {
    const loc = await Location.findById(req.params.id);
    if (!loc) {
      return res.status(404).json({ success: false, error: "Location not found." });
    }

    if (req.query.hard === "true") {
      await Location.findByIdAndDelete(req.params.id);
      invalidateLocationCache();
      await audit(req, {
        action: "LOCATION_DELETED",
        resourceId: loc._id,
        resourceName: `${loc.region} → ${loc.city}`,
        description: `Location ${loc.region} → ${loc.city} hard-deleted`,
      });
      return res.status(200).json({ success: true, data: { deleted: true, hard: true } });
    }

    loc.isActive = false;
    await loc.save();
    invalidateLocationCache();
    await audit(req, {
      action: "LOCATION_DEACTIVATED",
      resourceId: loc._id,
      resourceName: `${loc.region} → ${loc.city}`,
      description: `Location ${loc.region} → ${loc.city} deactivated`,
    });
    res.status(200).json({ success: true, data: loc, meta: { deactivated: true } });
  } catch (err) { next(err); }
};

module.exports = {
  listLocations,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
};
