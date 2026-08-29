const Product = require('../models/Product');

/**
 * Safely decrement a stock item's quantity by `qty`.
 *
 * Stock lives in Product now — shop stock, counter stock and bench parts are
 * one collection — so this reads `stock`/`allowNegativeStock` off a Product
 * where it used to read `quantity` off a Part.
 *
 * Mirrors the guard in utils/fulfilShopOrder.js so the repair/POS paths can
 * never oversell: the decrement only happens when there is enough stock, OR
 * when the item explicitly opts in with `allowNegativeStock: true` (an admin
 * override). If neither holds, stock is left untouched and `{ ok: false }` is
 * returned so callers can log it.
 *
 * @param {import('mongoose').Types.ObjectId|string} partId
 * @param {number} qty  units to remove (coerced to a positive integer)
 * @returns {Promise<{ ok: boolean, wentNegative?: boolean, part?: object }>}
 */
async function deductPartStock(partId, qty) {
  const amount = Math.max(1, Math.floor(Number(qty) || 1));

  // Fast path: atomic guarded decrement — never drops below zero. T48's `sold`
  // counter rides along on the same update so a part billed at the counter or
  // on a repair job counts exactly like one bought in the shop, and a line that
  // fails the stock guard is not counted as sold either.
  const guarded = await Product.findOneAndUpdate(
    { _id: partId, stock: { $gte: amount } },
    { $inc: { stock: -amount, sold: amount } },
    { new: true },
  );
  if (guarded) return { ok: true, part: guarded };

  // Not enough stock. Only proceed if this Part allows negative stock.
  const item = await Product.findById(partId).select('allowNegativeStock name stock');
  if (item && item.allowNegativeStock) {
    const updated = await Product.findByIdAndUpdate(
      partId,
      { $inc: { stock: -amount, sold: amount } },
      { new: true },
    );
    return { ok: true, wentNegative: true, part: updated };
  }

  return { ok: false, part: item || undefined };
}

module.exports = { deductPartStock };
