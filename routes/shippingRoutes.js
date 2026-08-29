const express = require("express");
const router = express.Router();
const { getQuote, getMethods, getFreeDelivery, getNeighborhoods, listPublicZones } = require("../controllers/shippingController");
const { validate } = require("../middleware/validate");
const { quoteSchema, methodsQuerySchema } = require("../validation/shippingSchema");

// Public shipping endpoints — no auth required. The quote endpoint is
// rate-limited separately in app.js to protect the DB from checkout floods.
router.post("/quote",         validate(quoteSchema, "body"),  getQuote);
router.get("/methods",        validate(methodsQuerySchema, "query"), getMethods);
router.get("/neighborhoods",  getNeighborhoods);
router.get("/free-delivery",  getFreeDelivery);
// Public rate table — what each distance zone costs.
router.get("/zones",          listPublicZones);

module.exports = router;
