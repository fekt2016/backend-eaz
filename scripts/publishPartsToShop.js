/**
 * Migration: put the bench parts on sale.
 *
 *   node scripts/publishPartsToShop.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/publishPartsToShop.js --apply    # actually writes
 *
 * Why: the product/part distinction is gone (owner request, 2026-09-04) — every
 * item is sold online and in store. New stock is created that way already, but
 * everything migrated in before the change still carries the old bench defaults
 * (`sellOnline:false`, `isActive:false`), so it stays invisible to customers.
 * This flips that stock over.
 *
 * ── What it changes ──────────────────────────────────────────────────────
 * Only the two visibility flags, and only on items that are currently hidden:
 *
 *   sellOnline: false → true      the shop's one visibility filter
 *   isActive:   false → true      the switch the admin UI reads; the model keeps
 *                                 the two in step, so leaving it behind would
 *                                 show an item in the shop that the dashboard
 *                                 reports as off
 *
 * Nothing else is touched. Prices, stock, categories, SKUs and repair-job
 * eligibility (`useInRepairs`) are left exactly as they are.
 *
 * ── What it does NOT fix ─────────────────────────────────────────────────
 * Bench parts were never written for customers: most have no image and no
 * description. They will be listed and buyable the moment this runs, looking
 * bare next to properly photographed stock. That is expected and was accepted —
 * they can be tidied afterwards through the same item form, which now shows
 * every field for every item. `--with-images-only` publishes just the ones that
 * already have a photo, if a staged rollout is wanted after all.
 *
 * Their categories (Screen, Battery, Charging Port, …) need no remapping: the
 * shop's browse bar is built from the categories actually in use, so each one
 * earns its own button as soon as an item carries it.
 *
 * Idempotent: an item already visible is not matched, so a second run reports
 * nothing to do. Reversible by hand — the printed plan names every item changed.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");

dotenv.config({ path: "./.env" });

/** Items the shop cannot currently show. `sellOnline` is the only filter it applies. */
function hiddenQuery({ withImagesOnly = false } = {}) {
  const query = { sellOnline: { $ne: true } };
  if (withImagesOnly) query.images = { $exists: true, $ne: [] };
  return query;
}

/**
 * The plan: what would be published, and what each item is missing. Read-only.
 */
async function planPublish(opts = {}) {
  const items = await Product.find(hiddenQuery(opts))
    .select("name category price images description sku stock")
    .lean();

  return items.map((it) => ({
    _id: it._id,
    name: it.name,
    category: it.category || "(none)",
    price: it.price,
    stock: it.stock ?? 0,
    // Flagged, not blocked — bare listings were accepted, but the operator
    // should see how many they are before saying yes.
    missing: [
      !it.images || it.images.length === 0 ? "image" : null,
      !it.description ? "description" : null,
      !it.price ? "price" : null,
    ].filter(Boolean),
  }));
}

/** Flip the visibility flags. Returns how many documents changed. */
async function publishParts(opts = {}) {
  const res = await Product.updateMany(hiddenQuery(opts), {
    $set: { sellOnline: true, isActive: true },
  });
  return res.modifiedCount ?? res.nModified ?? 0;
}

function summarise(plan) {
  const byCategory = plan.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});
  return {
    total: plan.length,
    noImage: plan.filter((p) => p.missing.includes("image")).length,
    noDescription: plan.filter((p) => p.missing.includes("description")).length,
    noPrice: plan.filter((p) => p.missing.includes("price")).length,
    byCategory,
  };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const withImagesOnly = process.argv.includes("--with-images-only");

  await mongoose.connect(requireMongoUrl());
  logDbTarget();

  const plan = await planPublish({ withImagesOnly });
  const s = summarise(plan);

  console.log(`\n${s.total} item(s) would be published${withImagesOnly ? " (photographed only)" : ""}.`);
  if (s.total) {
    console.log("\nBy category:");
    for (const [cat, n] of Object.entries(s.byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${cat}`);
    }
    console.log(`\nGaps customers would see:`);
    console.log(`  ${String(s.noImage).padStart(4)}  with no image`);
    console.log(`  ${String(s.noDescription).padStart(4)}  with no description`);
    if (s.noPrice) console.log(`  ${String(s.noPrice).padStart(4)}  with NO PRICE — these would list at GH₵ 0.00`);
  }

  if (!apply) {
    console.log(
      s.total
        ? "\nDry run — nothing written. Re-run with --apply.\n"
        : "\nNothing hidden. Dry run — nothing to do.\n"
    );
  } else {
    const changed = await publishParts({ withImagesOnly });
    console.log(`\nPublished ${changed} item(s). They are live in the shop now.\n`);
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { planPublish, publishParts, summarise, hiddenQuery };
