/**
 * Address — a customer's saved delivery address, in its own collection.
 *
 * This used to be `User.shippingAddresses`, an embedded array capped at three
 * with create/list/delete and no update: the only way to correct a typo in a
 * street name was to delete the address and retype it, and checkout was the
 * only screen that could touch the list at all. It is a record with its own
 * lifecycle — created, corrected, promoted to default, retired — so it gets its
 * own document rather than living inside the user's.
 *
 * `region` is REQUIRED for pricing, not decoration: it decides whether the
 * address is in the Greater-Accra delivery core or is a regional bus-station
 * pickup. It was dropped on save once, and a saved address then produced an
 * empty region, an empty city list and no delivery options at all, silently.
 *
 * Orders snapshot the address as text (`Order.customer.address`), so nothing in
 * financial history points at these documents — editing or deleting one never
 * rewrites what a past order says it was delivered to.
 */
const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "An address must belong to a user"],
      index: true,
    },
    // "Home", "Office" — free text the customer picks the address by.
    label: { type: String, trim: true, maxlength: [60, "Label cannot exceed 60 characters"], default: "" },
    street: { type: String, trim: true, maxlength: [200, "Street cannot exceed 200 characters"], default: "" },
    neighborhood: {
      type: String,
      trim: true,
      maxlength: [120, "Neighborhood cannot exceed 120 characters"],
      default: "",
    },
    // The priced delivery area (models/Neighborhood.js). Stored so a saved
    // address resolves to a shipping zone on its own, without the customer
    // re-picking their area every time they select it.
    neighborhoodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Neighborhood",
      default: null,
    },
    city: { type: String, trim: true, maxlength: [120, "City cannot exceed 120 characters"], default: "" },
    region: { type: String, trim: true, maxlength: [120, "Region cannot exceed 120 characters"], default: "" },
    // Optional per-address contact — a parcel going to the office may need the
    // receptionist's number, not the account holder's. Blank = use the account.
    phone: { type: String, trim: true, maxlength: [30, "Phone cannot exceed 30 characters"], default: "" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// The list screen and checkout both read "this user's addresses, default first,
// then most recently touched" — one index serves both.
addressSchema.index({ user: 1, isDefault: -1, updatedAt: -1 });

/**
 * An address with nothing in it is not an address. Mirrors the check the old
 * controller did by hand, so it holds no matter which caller writes.
 */
addressSchema.pre("validate", function requireSomeLocation(next) {
  if (!this.street && !this.neighborhood && !this.city) {
    this.invalidate("street", "Enter at least a street address, neighborhood, or city.");
  }
  return next();
});

/**
 * Make one address the user's default and clear the flag on every other one.
 *
 * A plain save cannot express "exactly one of these is true", and two defaults
 * is worse than none: checkout would pick whichever sorted first, so the
 * customer's choice would appear to be ignored at random. Done as one update
 * per side rather than a transaction — the pair is idempotent, and a re-run
 * converges.
 */
addressSchema.statics.setDefault = async function setDefault(userId, addressId) {
  await this.updateMany({ user: userId, _id: { $ne: addressId } }, { $set: { isDefault: false } });
  return this.findOneAndUpdate(
    { user: userId, _id: addressId },
    { $set: { isDefault: true } },
    { new: true },
  );
};

/**
 * Guarantee the user still has exactly one default after a delete. Promotes the
 * most recently updated survivor; a user whose last address is gone has none,
 * which is correct.
 */
addressSchema.statics.ensureDefault = async function ensureDefault(userId) {
  const hasDefault = await this.exists({ user: userId, isDefault: true });
  if (hasDefault) return null;
  const newest = await this.findOne({ user: userId }).sort({ updatedAt: -1 });
  if (!newest) return null;
  newest.isDefault = true;
  await newest.save();
  return newest;
};

module.exports = mongoose.model("Address", addressSchema);
