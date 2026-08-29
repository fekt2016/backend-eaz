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

// All admin shipping routes require authentication + admin role.
router.use(protect, restrictTo("admin"));

// ── Zones ────────────────────────────────────────────────────────────────────
router.route("/zones")
  .get(listZones)
  .post(createZone);
router.route("/zones/:id")
  .get(getZone)
  .patch(updateZone)
  .delete(deleteZone);

// ── Tiers ────────────────────────────────────────────────────────────────────
router.route("/tiers")
  .get(listTiers)
  .post(createTier);
router.route("/tiers/:id")
  .get(getTier)
  .patch(updateTier)
  .delete(deleteTier);

// ── Settings (singleton) ─────────────────────────────────────────────────────
router.route("/settings")
  .get(getSettings)
  .patch(updateSettings);

// ── Courier payout config ────────────────────────────────────────────────────
router.route("/courier-rate")
  .get(getOrCreateCourierRate)
  .patch(updateCourierRate);

// ── Delivery charges (Phase 5) ──────────────────────────────────────────────
router.route("/delivery-charges")
  .get(deliveryChargeSummary);
router.route("/delivery-charges/:id/refund")
  .patch(manualRefundDeliveryCharge);

// ── Neighbourhood distances (Google Maps) ───────────────────────────────────
router.route("/distances")
  .get(listNeighborhoodDistances)
  .patch(setManualNeighborhoodDistance);
router.route("/distances/resolve")
  .post(resolveNeighborhoodDistances);

module.exports = router;
