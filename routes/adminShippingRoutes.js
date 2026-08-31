const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const {
  listZones, getZone, createZone, updateZone, deleteZone,
  listTiers, getTier, createTier, updateTier, deleteTier,
  getSettings, updateSettings,
  getOrCreateCourierRate, updateCourierRate,
  deliveryChargeSummary, manualRefundDeliveryCharge,
  listNeighborhoodDistances, resolveNeighborhoodDistances, setManualNeighborhoodDistance,
} = require("../controllers/adminShippingController");
const { validate } = require("../middleware/validate");
const {
  zoneCreateSchema, zoneUpdateSchema,
  tierCreateSchema, tierUpdateSchema,
  settingsUpdateSchema,
  courierRateUpdateSchema,
  distanceResolveSchema, distanceManualSchema,
} = require("../validation/shippingSchema");

// All admin shipping routes require authentication + admin role.
router.use(protect, restrictTo("admin"));

// ── Zones ────────────────────────────────────────────────────────────────────
router.route("/zones")
  .get(listZones)
  .post(validate(zoneCreateSchema), createZone);
router.route("/zones/:id")
  .get(getZone)
  .patch(validate(zoneUpdateSchema), updateZone)
  .delete(deleteZone);

// ── Tiers ────────────────────────────────────────────────────────────────────
router.route("/tiers")
  .get(listTiers)
  .post(validate(tierCreateSchema), createTier);
router.route("/tiers/:id")
  .get(getTier)
  .patch(validate(tierUpdateSchema), updateTier)
  .delete(deleteTier);

// ── Settings (singleton) ─────────────────────────────────────────────────────
router.route("/settings")
  .get(getSettings)
  .patch(validate(settingsUpdateSchema), updateSettings);

// ── Courier payout config ────────────────────────────────────────────────────
router.route("/courier-rate")
  .get(getOrCreateCourierRate)
  .patch(validate(courierRateUpdateSchema), updateCourierRate);

// ── Delivery charges (Phase 5) ──────────────────────────────────────────────
router.route("/delivery-charges")
  .get(deliveryChargeSummary);
router.route("/delivery-charges/:id/refund")
  .patch(manualRefundDeliveryCharge);

// ── Neighbourhood distances (Google Maps) ───────────────────────────────────
router.route("/distances")
  .get(listNeighborhoodDistances)
  .patch(validate(distanceManualSchema), setManualNeighborhoodDistance);
router.route("/distances/resolve")
  .post(validate(distanceResolveSchema), resolveNeighborhoodDistances);

module.exports = router;
