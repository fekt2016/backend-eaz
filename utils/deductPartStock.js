const Part = require('../models/Part');

/**
 * Safely decrement a Part's stock by `qty`.
 *
 * Mirrors the guard in utils/fulfilShopOrder.js so the repair/POS paths can
 * never oversell: the decrement only happens when there is enough stock, OR
 * when the Part explicitly opts in with `allowNegativeStock: true` (an admin
 * override). If neither holds, stock is left untouched and `{ ok: false }` is
 * returned so callers can log it.
 *
 * @param {import('mongoose').Types.ObjectId|string} partId
 * @param {number} qty  units to remove (coerced to a positive integer)
 * @returns {Promise<{ ok: boolean, wentNegative?: boolean, part?: object }>}
 */
async function deductPartStock(partId, qty) {
  const amount = Math.max(1, Math.floor(Number(qty) || 1));

  // Fast path: atomic guarded decrement — never drops below zero.
  const guarded = await Part.findOneAndUpdate(
    { _id: partId, quantity: { $gte: amount } },
    { $inc: { quantity: -amount } },
    { new: true },
  );
  if (guarded) return { ok: true, part: guarded };

  // Not enough stock. Only proceed if this Part allows negative stock.
  const part = await Part.findById(partId).select('allowNegativeStock name quantity');
  if (part && part.allowNegativeStock) {
    const updated = await Part.findByIdAndUpdate(
      partId,
      { $inc: { quantity: -amount } },
      { new: true },
    );
    return { ok: true, wentNegative: true, part: updated };
  }

  return { ok: false, part: part || undefined };
}

module.exports = { deductPartStock };
