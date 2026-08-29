const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const {
  listPickups,
  getPickup,
  createPickup,
  updatePickup,
  deletePickup,
} = require("../controllers/adminPickupController");

// T80 E2 — admin CRUD for PickupLocation (warehouse + bus_station kinds).
// All routes require auth + admin role; the public read endpoint lives in
// routes/pickupRoutes.js (mounted under /api/v1/pickups, no auth, for the
// checkout pickup-location selector).
router.use(protect, restrictTo("admin"));

router.route("/")
  .get(listPickups)
  .post(createPickup);

router.route("/:id")
  .get(getPickup)
  .patch(updatePickup)
  .delete(deletePickup);

module.exports = router;
