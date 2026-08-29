const express = require("express");
const router = express.Router();
const { listPickups } = require("../controllers/pickupController");

// T80 E2 — public pickup reads for the checkout cascade. Auth-free; rate-
// limited via the global /api/ limiter. Admin CRUD lives in
// routes/adminPickupRoutes.js under /api/v1/admin/pickups.
router.get("/", listPickups);

module.exports = router;
