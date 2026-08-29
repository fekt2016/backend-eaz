const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { createAddressSchema, updateAddressSchema } = require("../validation/addressSchema");
const {
  getAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
} = require("../controllers/addressController");

// A customer's own address book. Every route is scoped to the logged-in user
// inside the controller — `protect` establishes who that is, and nothing here
// takes an owner from the request.
router.use(protect);

router.get("/", getAddresses);
router.post("/", validate(createAddressSchema), createAddress);
router.patch("/:id", validate(updateAddressSchema), updateAddress);
router.patch("/:id/default", setDefaultAddress);
router.delete("/:id", deleteAddress);

module.exports = router;
