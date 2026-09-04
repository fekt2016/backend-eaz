/**
 * Correct variant products whose stored `stock` has drifted from their variants.
 *
 *   node scripts/repairVariantStock.js            # DRY RUN
 *   node scripts/repairVariantStock.js --apply    # writes
 *
 * Fulfilment decrements `variants.$.stock` and never the top-level field, so
 * anything sold before utils/syncVariantStock.js existed is still carrying its
 * pre-sale number — iPhone 15 Pro read 12 while its variants held 7. Lists hid
 * it (they report the variant total), but the stored value still reached the
 * admin edit form and the product page before a variant is chosen.
 *
 * Products without variants are untouched: there the top-level field IS the
 * stock, and rewriting it would be inventing a number.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");

dotenv.config({ path: "./.env" });

/** Products whose stored stock disagrees with the sum of their variants. */
async function findDrift() {
  const products = await Product.find({ "variants.0": { $exists: true } })
    .select("name sku stock variants.stock")
    .lean();
  return products
    .map((p) => ({
      _id: p._id, name: p.name, sku: p.sku,
      stored: p.stock ?? 0,
      actual: p.variants.reduce((n, v) => n + (Number(v.stock) || 0), 0),
    }))
    .filter((p) => p.stored !== p.actual);
}

async function applyDrift(rows) {
  for (const r of rows) {
    await Product.updateOne({ _id: r._id }, { $set: { stock: r.actual } });
  }
  return rows.length;
}

async function run() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(requireMongoUrl());
  logDbTarget();

  const drift = await findDrift();
  console.log(`\n${drift.length} variant product(s) with a stale top-level stock:\n`);
  for (const d of drift) {
    console.log(`  ${String(d.sku || "—").padEnd(14)} ${d.name.slice(0, 34).padEnd(36)} ${String(d.stored).padStart(4)} → ${d.actual}`);
  }

  if (!apply) {
    console.log(drift.length ? `\nDry run — nothing written. Re-run with --apply.\n` : `\nNothing to repair.\n`);
  } else {
    console.log(`\nCorrected ${await applyDrift(drift)} product(s).\n`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { findDrift, applyDrift };
