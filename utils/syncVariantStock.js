/**
 * Keep a variant product's top-level `stock` equal to the sum of its variants.
 *
 * Fulfilment decrements `variants.$.stock` and never the top-level field, so a
 * variant product's stored stock drifts with every sale — iPhone 15 Pro read 12
 * while its variants actually held 7. Lists hide it (the aggregation reports the
 * variant total), but the stored number still reaches the admin edit form and
 * the product detail page before a variant is chosen, where it reads as more
 * stock than exists.
 *
 * Call after any write that moves variant stock. Products without variants are
 * left alone: there, the top-level field IS the stock.
 */
const Product = require('../models/Product');

async function syncVariantStock(productId) {
  if (!productId) return null;
  const product = await Product.findById(productId).select('stock variants.stock').lean();
  if (!product || !Array.isArray(product.variants) || product.variants.length === 0) return null;

  const total = product.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  if (total === product.stock) return null;

  // updateOne, not save(): this runs alongside the guarded $inc that moved the
  // variant, and a full document save could clobber a concurrent one.
  await Product.updateOne({ _id: productId }, { $set: { stock: total } });
  return { productId, from: product.stock, to: total };
}

module.exports = { syncVariantStock };
