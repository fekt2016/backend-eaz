const PickupLocation = require("../models/PickupLocation");
const { PICKUP_KINDS } = require("../models/PickupLocation");
const { logFromRequest, ACTIONS } = require("../services/activityLogService");

// T80 E2 — admin CRUD for PickupLocation. The model has two kinds:
//   `warehouse`    — the shop's own origin (Nima), one per system
//   `bus_station`  — regional pickup handoff points (one per served city)
//
// Hard-delete is risky: an order's snapshot has the id + name, so deletion
// leaves a dead reference. Default to soft-deactivate (isActive: false);
// expose ?hard=true for the rare typo case where no order ever referenced it.

const audit = async (req, { action, resourceId, resourceName, description, changes }) => {
  await logFromRequest(req, {
    action,
    resourceType: "PICKUP_LOCATION",
    resourceId: String(resourceId || ""),
    resourceName: String(resourceName || ""),
    description: String(description || ""),
    changes: Array.isArray(changes) ? changes : [],
  });
};

const listPickups = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.kind) filter.kind = String(req.query.kind);
    if (req.query.region) filter.region = String(req.query.region);
    if (req.query.city) filter.city = String(req.query.city);
    if (req.query.isActive === "true") filter.isActive = true;
    if (req.query.isActive === "false") filter.isActive = false;

    const pickups = await PickupLocation.find(filter)
      .sort({ kind: 1, isDefault: -1, region: 1, city: 1, name: 1 })
      .lean();

    res.status(200).json({ success: true, count: pickups.length, data: pickups });
  } catch (err) { next(err); }
};

const getPickup = async (req, res, next) => {
  try {
    const pickup = await PickupLocation.findById(req.params.id).lean();
    if (!pickup) return res.status(404).json({ success: false, error: "Pickup location not found." });
    res.status(200).json({ success: true, data: pickup });
  } catch (err) { next(err); }
};

const createPickup = async (req, res, next) => {
  try {
    const { name, kind, region, city, address, landmark, isDefault, isActive } = req.body;
    if (!name || !kind) {
      return res.status(400).json({
        success: false,
        error: "name and kind are required.",
      });
    }
    if (!PICKUP_KINDS.includes(kind)) {
      return res.status(400).json({
        success: false,
        error: `kind must be one of: ${PICKUP_KINDS.join(", ")}.`,
      });
    }

    // House-keeping: only one default per kind. If the new row is default,
    // clear isDefault on the others of the same kind first.
    if (isDefault) {
      await PickupLocation.updateMany(
        { kind, isDefault: true },
        { $set: { isDefault: false } },
      );
    }

    const pickup = await PickupLocation.create({
      name: String(name).trim(),
      kind,
      region: region ? String(region).trim() : "",
      city: city ? String(city).trim() : "",
      address: address ? String(address).trim() : "",
      landmark: landmark ? String(landmark).trim() : "",
      isDefault: Boolean(isDefault),
      isActive: isActive !== false,
    });

    await audit(req, {
      action: "PICKUP_LOCATION_CREATED",
      resourceId: pickup._id,
      resourceName: pickup.name,
      description: `Pickup location "${pickup.name}" (${pickup.kind}) created for ${pickup.region || "—"}/${pickup.city || "—"}`,
    });

    res.status(201).json({ success: true, data: pickup });
  } catch (err) { next(err); }
};

const updatePickup = async (req, res, next) => {
  try {
    const existing = await PickupLocation.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Pickup location not found." });
    }

    // If a new default is being set, clear the flag on siblings of the same
    // kind so the index stays one-default-per-kind.
    if (req.body.isDefault === true && !existing.isDefault) {
      await PickupLocation.updateMany(
        { kind: existing.kind, isDefault: true, _id: { $ne: existing._id } },
        { $set: { isDefault: false } },
      );
    }

    const changes = [];
    const set = (field, before, after, label) => {
      if (after !== undefined && after !== before) {
        changes.push({ field, label: label || field, before, after });
        existing[field] = after;
      }
    };

    set("name", existing.name, req.body.name ? String(req.body.name).trim() : undefined, "Name");
    set("region", existing.region, req.body.region !== undefined ? String(req.body.region).trim() : undefined, "Region");
    set("city", existing.city, req.body.city !== undefined ? String(req.body.city).trim() : undefined, "City");
    set("address", existing.address, req.body.address !== undefined ? String(req.body.address).trim() : undefined, "Address");
    set("landmark", existing.landmark, req.body.landmark !== undefined ? String(req.body.landmark).trim() : undefined, "Landmark");
    set("isDefault", existing.isDefault, req.body.isDefault, "Default");
    set("isActive", existing.isActive, req.body.isActive, "Active");

    if (req.body.kind !== undefined && req.body.kind !== existing.kind) {
      if (!PICKUP_KINDS.includes(req.body.kind)) {
        return res.status(400).json({
          success: false,
          error: `kind must be one of: ${PICKUP_KINDS.join(", ")}.`,
        });
      }
      changes.push({ field: "kind", label: "Kind", before: existing.kind, after: req.body.kind });
      existing.kind = req.body.kind;
    }

    if (!changes.length) {
      return res.status(200).json({ success: true, data: existing, meta: { noChanges: true } });
    }

    await existing.save();
    await audit(req, {
      action: "PICKUP_LOCATION_UPDATED",
      resourceId: existing._id,
      resourceName: existing.name,
      description: `Pickup location "${existing.name}" updated: ${changes.map((c) => c.field).join(", ")}`,
      changes,
    });

    res.status(200).json({ success: true, data: existing });
  } catch (err) { next(err); }
};

// Default: soft-deactivate (isActive: false). The row stays in the DB so
// historical orders that snapshot the id still resolve (the tracking payload
// reads `pickupLocationName` from the order, not the live doc, so the live
// doc is only used for display).
const deletePickup = async (req, res, next) => {
  try {
    const pickup = await PickupLocation.findById(req.params.id);
    if (!pickup) {
      return res.status(404).json({ success: false, error: "Pickup location not found." });
    }

    if (req.query.hard === "true") {
      await PickupLocation.findByIdAndDelete(req.params.id);
      await audit(req, {
        action: "PICKUP_LOCATION_DELETED",
        resourceId: pickup._id,
        resourceName: pickup.name,
        description: `Pickup location "${pickup.name}" hard-deleted`,
      });
      return res.status(200).json({ success: true, data: { deleted: true, hard: true } });
    }

    pickup.isActive = false;
    await pickup.save();
    await audit(req, {
      action: "PICKUP_LOCATION_DEACTIVATED",
      resourceId: pickup._id,
      resourceName: pickup.name,
      description: `Pickup location "${pickup.name}" deactivated`,
    });
    res.status(200).json({ success: true, data: pickup, meta: { deactivated: true } });
  } catch (err) { next(err); }
};

module.exports = {
  listPickups,
  getPickup,
  createPickup,
  updatePickup,
  deletePickup,
};
