const express = require("express");
const router = express.Router();
const {
  listLocations,
  listRegions,
  listCities,
  listNeighborhoods,
} = require("../controllers/locationController");

// T80 E2 — public Location reads for the checkout cascade. Auth-free; rate-
// limited via the global /api/ limiter. Order matters: /regions and /cities
// are static-named paths and must precede the /:id-style pattern in
// adminLocationRoutes (which is mounted under /admin/locations, so there is
// no collision here).
router.get("/", listLocations);
router.get("/regions", listRegions);
router.get("/cities", listCities);
router.get("/neighborhoods", listNeighborhoods);

module.exports = router;
