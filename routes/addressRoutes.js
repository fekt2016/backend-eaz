const express = require("express");
const router = express.Router();
const { protect, denyRoles } = require("../middleware/auth");
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
//
// Owner decision (2026-08-30): the address book is a CUSTOMER surface. Admin,
// superadmin, staff and technician have no use for a personal delivery address
// book on a staff account, so they are refused outright rather than shown an
// empty page they can quietly fill in.
//
// `denyRoles`, not `restrictTo('user')`, and the difference matters:
// restrictTo grants superadmin implicit access to EVERY role check
// (middleware/auth.js:46), so restrictTo('user') would have let superadmin
// straight through and silently missed one of the three roles named in the
// requirement. denyRoles has no such escape hatch.
const STAFF_SIDE_ROLES = ["superadmin", "admin", "staff", "technician"];

router.use(protect, denyRoles(...STAFF_SIDE_ROLES));

router.get("/", getAddresses);
router.post("/", validate(createAddressSchema), createAddress);
router.patch("/:id", validate(updateAddressSchema), updateAddress);
router.patch("/:id/default", setDefaultAddress);
router.delete("/:id", deleteAddress);

module.exports = router;
