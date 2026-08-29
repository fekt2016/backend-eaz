const express = require("express");
const router = express.Router();
const { listNeighborhoods } = require("../controllers/shippingController");

// Public — the checkout neighbourhood picker. Each entry carries the id the
// client must send back as `neighborhoodId`, which is what lets the quote
// resolve a zone without geocoding anything.
router.get("/", listNeighborhoods);

module.exports = router;
