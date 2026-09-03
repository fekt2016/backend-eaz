/**
 * SKU generator — guarantees the returned SKU is not already in use.
 *
 * Product SKUs follow the house style EZW-<BRAND>-<NNN> (e.g. EZW-IPH-004),
 * variant SKUs are <parent SKU>-<attr suffix> (e.g. EZW-IPH-004-NAT128).
 *
 * Uniqueness is checked across BOTH top-level `sku` and nested `variants[].sku`,
 * because they live in the same field namespace and the unique index only covers
 * the top-level field — a nested variant SKU can otherwise silently collide.
 */
const Product = require('../models/Product');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** All sku strings (top-level + nested variants) on record. */
async function allSkus() {
  const docs = await Product.find({})
    .select('sku variants.sku')
    .lean();
  const out = new Set();
  for (const d of docs) {
    if (d.sku) out.add(String(d.sku));
    for (const v of d.variants || []) {
      if (v.sku) out.add(String(v.sku));
    }
  }
  return out;
}

/**
 * Next free `prefix-NNN`. The base (e.g. "EZW-IPH") is passed in from the caller;
 * the numeric suffix is chosen so the full SKU is unique against every record.
 */
async function nextProductSku(base) {
  const clean = String(base || '').trim().replace(/\s+/g, '-');
  if (!clean) throw new Error('A SKU prefix is required');
  const re = new RegExp(`^${escapeRegex(clean)}-(\\d+)$`);
  let max = 0;
  const used = await allSkus();
  for (const sku of used) {
    const m = sku.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const n = max + 1;
  return `${clean}-${String(n).padStart(3, '0')}`;
}

/**
 * A variant SKU is `<parent>-<suffix>`. It must be unique too — if that exact
 * string is taken, append `-2`, `-3`, … until a free slot is found.
 */
async function nextVariantSku(parentSku, suffix) {
  const parent = String(parentSku || '').trim();
  const safeSuffix = String(suffix || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  const base = parent && safeSuffix ? `${parent}-${safeSuffix}` : (parent || safeSuffix);
  if (!base) throw new Error('A parent SKU or attribute suffix is required');

  const used = await allSkus();
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

module.exports = { nextProductSku, nextVariantSku };
