/**
 * Give every variant its own image, so choosing one visibly changes the picture.
 *
 *   node scripts/backfillVariantImages.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/backfillVariantImages.js --apply    # writes
 *   node scripts/backfillVariantImages.js --refresh --apply
 *                                                    # ALSO regenerates images that are
 *                                                    # themselves placeholders (never real photos)
 *
 * Why: the product page already prefers `variants[].images` over the product
 * gallery, but a variant with an empty array falls back to the product hero. So
 * with no images anywhere, switching Black to Blue changes nothing on screen and
 * the colour/size picker looks broken.
 *
 * These are PLACEHOLDERS, not photography — colour-matched to each variant's own
 * colour attribute and captioned with its values. They make the mechanism
 * visible and are meant to be replaced with real photos through the item form.
 *
 * ── Safe by construction ─────────────────────────────────────────────────
 * Only ever fills an EMPTY images array. A variant or product that already has
 * a picture is skipped, so running this can never overwrite real photography,
 * and running it twice does nothing the second time.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");
const { variantPlaceholder, productPlaceholder } = require("../utils/variantPlaceholder");

dotenv.config({ path: "./.env" });

const isEmpty = (arr) => !Array.isArray(arr) || arr.length === 0;

/** A placeholder we generated, as opposed to a photograph someone uploaded. */
const isPlaceholder = (url) => typeof url === "string" && url.includes("placehold.co");

/**
 * Should this image be written? Empty always. An existing one only under
 * --refresh, and even then only when it is one of ours — a real photo is never
 * touched, so the caption change cannot cost anyone their photography.
 */
const needsWrite = (images, refresh) =>
  isEmpty(images) || (refresh && images.every(isPlaceholder));

/**
 * What would change. Read-only: returns one entry per product needing work,
 * naming the hero and each variant that would be filled.
 */
function planFor(products, { refresh = false } = {}) {
  const plan = [];
  for (const p of products) {
    const needsHero = needsWrite(p.images, refresh);
    const variants = (p.variants || []).filter((v) => needsWrite(v.images, refresh));
    if (!needsHero && !variants.length) continue;
    plan.push({
      _id: p._id,
      name: p.name,
      hero: needsHero ? productPlaceholder(p.name) : null,
      variants: variants.map((v) => ({
        sku: v.sku,
        // Mongoose Maps need converting before the attributes read as an object.
        image: variantPlaceholder(v.attributes instanceof Map ? Object.fromEntries(v.attributes) : v.attributes, p.name),
      })),
    });
  }
  return plan;
}

/** Apply a plan. Returns how many products, heroes and variants were touched. */
async function applyPlan(plan, { refresh = false } = {}) {
  let heroes = 0;
  let variants = 0;
  for (const entry of plan) {
    const doc = await Product.findById(entry._id);
    if (!doc) continue;
    if (entry.hero) { doc.images = [entry.hero]; heroes += 1; }
    for (const v of entry.variants) {
      const target = doc.variants.find((x) => x.sku === v.sku);
      if (target && needsWrite(target.images, refresh)) { target.images = [v.image]; variants += 1; }
    }
    await doc.save();
  }
  return { products: plan.length, heroes, variants };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const refresh = process.argv.includes("--refresh");
  await mongoose.connect(requireMongoUrl());
  logDbTarget();

  const products = await Product.find({}).lean();
  const plan = planFor(products, { refresh });
  const variantCount = plan.reduce((n, p) => n + p.variants.length, 0);
  const heroCount = plan.filter((p) => p.hero).length;

  console.log(`\n${products.length} product(s) on record.`);
  console.log(`Would ${refresh ? "fill or regenerate" : "fill"}: ${heroCount} hero image(s), ${variantCount} variant image(s).\n`);
  for (const p of plan) {
    console.log(`  ${p.name}${p.hero ? "  [+hero]" : ""}`);
    for (const v of p.variants) console.log(`      ${v.sku.padEnd(22)} ${decodeURIComponent(v.image.split("text=")[1] || "")}`);
  }

  if (!apply) {
    console.log(plan.length ? "\nDry run — nothing written. Re-run with --apply.\n" : "\nNothing to fill.\n");
  } else {
    const r = await applyPlan(plan, { refresh });
    console.log(`\nUpdated ${r.products} product(s): ${r.heroes} hero image(s), ${r.variants} variant image(s).`);
    console.log(`Replace them with real photos through the item form when you have them.\n`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { planFor, applyPlan };
