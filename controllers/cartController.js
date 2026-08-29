const Cart = require('../models/Cart');

/**
 * GET /api/v1/cart
 * Return the authenticated user's cart (or an empty one).
 */
exports.getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = await Cart.create({ user: req.user.id, items: [] });
    res.status(200).json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/cart
 * Replace the entire cart with the provided items array.
 * Used on login to sync localStorage → DB (or a full client-side overwrite).
 */
exports.replaceCart = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'items must be an array.' });
    }
    const cart = await Cart.findOneAndUpdate(
      { user: req.user.id },
      { user: req.user.id, items },
      { upsert: true, new: true, runValidators: true }
    );
    res.status(200).json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/cart/merge
 * Merge an array of items (from localStorage) into the existing DB cart.
 * - If a lineId already exists in the DB cart, take the higher qty.
 * - Otherwise append the item.
 */
exports.mergeCart = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'items must be an array.' });
    }
    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = await Cart.create({ user: req.user.id, items: [] });

    for (const incoming of items) {
      const idx = cart.items.findIndex((i) => i.lineId === incoming.lineId);
      if (idx >= 0) {
        cart.items[idx].qty = Math.max(cart.items[idx].qty, incoming.qty);
      } else {
        cart.items.push(incoming);
      }
    }

    await cart.save();
    res.status(200).json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/cart/items
 * Add or update a single item in the cart.
 * Body: { lineId, slug, name, price, image, category, stock, qty, variant?, product? }
 */
exports.upsertItem = async (req, res, next) => {
  try {
    const { lineId, slug, name, price, image, category, stock, qty, variant, product } = req.body;
    if (!lineId || !slug || !name || price == null) {
      return res.status(400).json({ success: false, error: 'lineId, slug, name, and price are required.' });
    }
    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = await Cart.create({ user: req.user.id, items: [] });

    const idx = cart.items.findIndex((i) => i.lineId === lineId);
    const itemData = { lineId, slug, name, price, image, category, stock, qty: qty || 1, variant, product };

    if (idx >= 0) {
      cart.items[idx] = { ...cart.items[idx].toObject(), ...itemData };
    } else {
      cart.items.push(itemData);
    }

    await cart.save();
    res.status(200).json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/cart/items/:lineId
 * Remove a single item from the cart.
 */
exports.removeItem = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) return res.status(200).json({ success: true, data: { items: [] } });

    cart.items = cart.items.filter((i) => i.lineId !== req.params.lineId);
    await cart.save();
    res.status(200).json({ success: true, data: cart });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/cart
 * Clear all items from the cart.
 */
exports.clearCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    if (cart) {
      cart.items = [];
      await cart.save();
    }
    res.status(200).json({ success: true, data: { items: [] } });
  } catch (err) {
    next(err);
  }
};
