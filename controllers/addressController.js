/**
 * Saved delivery addresses — the customer's own address book.
 *
 * Every handler scopes its query by `req.user.id`. Ownership is never taken
 * from the URL or the body: an address id is guessable enough that a query
 * filtered only by `_id` would let any logged-in customer read, edit or delete
 * somebody else's home address.
 */
const Address = require("../models/Address");
const { sanitizeText, sanitizePhone } = require("../utils/sanitize");

// Free text that gets rendered back to the customer, so it is sanitised on the
// way in. Zod has already trimmed and length-capped these.
const clean = (body) => {
  const out = { ...body };
  if (out.label !== undefined) out.label = sanitizeText(out.label, 60);
  if (out.street !== undefined) out.street = sanitizeText(out.street, 200);
  if (out.neighborhood !== undefined) out.neighborhood = sanitizeText(out.neighborhood, 120);
  if (out.city !== undefined) out.city = sanitizeText(out.city, 120);
  if (out.region !== undefined) out.region = sanitizeText(out.region, 120);
  if (out.phone !== undefined) out.phone = sanitizePhone(out.phone) || "";
  return out;
};

// How many addresses one customer may keep. Three, as the embedded array this
// replaced allowed — a product decision, not a storage one: the checkout picker
// stays scannable and the list cannot be used as a spam surface.
//
// The cap is enforced on create only. A customer who somehow holds more keeps
// them and can still edit and delete; they simply cannot add another.
const MAX_ADDRESSES = 3;

/** Default first, then most recently touched — the order both screens want. */
const listForUser = (userId) =>
  Address.find({ user: userId }).sort({ isDefault: -1, updatedAt: -1 }).lean();

/** GET /api/v1/addresses */
const getAddresses = async (req, res, next) => {
  try {
    const addresses = await listForUser(req.user.id);
    res.json({ success: true, data: addresses });
  } catch (error) {
    next(error);
  }
};

/**
 * The four fields that decide whether two addresses are the same place. Label
 * and phone are deliberately not part of it: renaming "Home" to "Mum's" does
 * not make it a different house.
 */
const locationKey = (a) =>
  [a.street, a.neighborhood, a.city, a.region]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");

/**
 * POST /api/v1/addresses
 *
 * Idempotent by location: checkout saves the delivery address on every order,
 * so a customer who orders three times to the same house was getting three
 * identical rows. Saving a location already in the book returns the existing
 * address (200) instead of adding another.
 */
const createAddress = async (req, res, next) => {
  try {
    const body = clean(req.body);
    const saved = await Address.find({ user: req.user.id });

    // The duplicate check comes FIRST, before the cap. Checkout saves the
    // delivery address on every order, so a customer with a full address book
    // re-ordering to an address they already have is not adding one — capping
    // that would fail their save at the last step of the order.
    const existing = saved.find((a) => locationKey(a) === locationKey(body));
    if (existing) {
      // A label or phone supplied alongside a known location is an edit of it.
      if (body.label && body.label !== existing.label) existing.label = body.label;
      if (body.phone && body.phone !== existing.phone) existing.phone = body.phone;
      if (existing.isModified()) await existing.save();
      if (body.isDefault) await Address.setDefault(req.user.id, existing._id);
      return res.json({ success: true, data: await Address.findById(existing._id).lean() });
    }

    if (saved.length >= MAX_ADDRESSES) {
      return res.status(400).json({
        success: false,
        error: `You can save up to ${MAX_ADDRESSES} addresses. Delete one to add another.`,
      });
    }

    // The first address a customer saves is their default — otherwise checkout
    // would have a list with nothing preselected.
    const isDefault = body.isDefault || saved.length === 0;

    const address = await Address.create({ ...body, user: req.user.id, isDefault });
    if (isDefault) await Address.setDefault(req.user.id, address._id);

    res.status(201).json({ success: true, data: await Address.findById(address._id).lean() });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/addresses/:id
 * The operation the embedded array never had: correcting an address in place,
 * so a typo does not cost the customer the whole record.
 */
const updateAddress = async (req, res, next) => {
  try {
    const address = await Address.findOne({ _id: req.params.id, user: req.user.id });
    if (!address) {
      return res.status(404).json({ success: false, error: "Address not found." });
    }

    const body = clean(req.body);
    // `isDefault` is applied through the model helper below, never assigned
    // here — assigning it directly would leave the user with two defaults.
    const { isDefault, ...fields } = body;

    // Refused before anything is written, so a rejected edit does not still
    // save the other fields it came with.
    if (isDefault === false && address.isDefault) {
      return res.status(400).json({
        success: false,
        error: "Make another address the default instead of clearing this one.",
      });
    }

    Object.assign(address, fields);
    await address.save(); // schema re-checks it still has a deliverable location

    if (isDefault === true) await Address.setDefault(req.user.id, address._id);

    res.json({ success: true, data: await Address.findById(address._id).lean() });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/addresses/:id/default */
const setDefaultAddress = async (req, res, next) => {
  try {
    const updated = await Address.setDefault(req.user.id, req.params.id);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Address not found." });
    }
    res.json({ success: true, data: await listForUser(req.user.id) });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/v1/addresses/:id */
const deleteAddress = async (req, res, next) => {
  try {
    const removed = await Address.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!removed) {
      return res.status(404).json({ success: false, error: "Address not found." });
    }
    // Deleting the default promotes a survivor, so checkout still opens with
    // an address selected.
    if (removed.isDefault) await Address.ensureDefault(req.user.id);

    res.json({ success: true, data: await listForUser(req.user.id) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  MAX_ADDRESSES,
  getAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
};
