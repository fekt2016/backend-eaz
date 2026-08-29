const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const {
  listLocations,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
} = require("../controllers/adminLocationController");

// T80 E2 — admin CRUD for the Location taxonomy. All routes require auth +
// admin role; the public read endpoint lives in routes/locationRoutes.js
// (mounted under /api/v1/locations, no auth, for the checkout cascade).
router.use(protect, restrictTo("admin"));

router.route("/")
  .get(listLocations)
  .post(createLocation);

router.route("/:id")
  .get(getLocation)
  .patch(updateLocation)
  .delete(deleteLocation);

module.exports = router;
