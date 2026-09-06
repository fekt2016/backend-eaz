/**
 * Give variants real per-colour photographs where the backup has one.
 *
 *   node scripts/adoptVariantImages.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/adoptVariantImages.js --apply    # writes
 *
 * The swatch row on the product page is built from variants[].images, and those
 * are currently flat colour placeholders. The deleted catalogue carried real
 * per-colour shots for nine products — Spigen/Olixar/UAG cases, Sony XM5, and
 * the iPhone 14 family — so where a colour genuinely matches, a shopper can see
 * the actual thing instead of a coloured square.
 *
 * ── Matching is (category, colour), never colour alone ───────────────────
 * A photo of a black Spigen CASE is not a picture of a black POWER BANK. Colour
 * alone would put one on the other, so a match must come from the same category.
 * That is strict enough to leave most variants on placeholders, which is the
 * right outcome: a coloured square is honest, a photo of a different product is
 * not.
 *
 * Only ever replaces a placehold.co URL, and never adopts an image whose host is
 * missing from the frontend's remotePatterns — next/image throws on those and
 * takes the whole product page down (it did, for the Leather Wallet Case).
 */
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");

dotenv.config({ path: "./.env" });

const ALLOWED_HOSTS = (() => {
  try {
    const cfg = require("fs").readFileSync(
      path.join(__dirname, "..", "..", "frontend-eaz", "next.config.mjs"), "utf8"
    );
    const hosts = [...cfg.matchAll(/hostname:\s*["']([^"']+)["']/g)].map((m) => m[1]);
    if (hosts.length) return new Set(hosts);
  } catch { /* fall through */ }
  return null;
})();

const hostAllowed = (url) => {
  if (!ALLOWED_HOSTS) return false;
  try { return ALLOWED_HOSTS.has(new URL(url).hostname); } catch { return false; }
};
const isPlaceholder = (u) => typeof u === "string" && u.includes("placehold.co");
const asObject = (a) => (a instanceof Map ? Object.fromEntries(a) : a || {});
const colourOf = (attrs) => {
  const entry = Object.entries(asObject(attrs)).find(([k]) => /colou?r/i.test(k));
  return entry ? String(entry[1] || "").trim() : "";
};

/*
 * Marketing colour names rarely match between catalogues. The backup has photos
 * filed under Black, Blue, White, Silver, Gold, Space Black, Midnight; the
 * current products say "Moonlit Black", "Awesome Navy", "Blue Titanium",
 * "Iceblue". Exact string matching therefore found almost nothing.
 *
 * Reduce both sides to a base colour so they meet: the LAST recognised colour
 * word in the name wins, because these read as modifier-then-colour ("Sunset
 * Gold", "Awesome Navy"), and shades collapse onto the colour that has a photo.
 */
const SHADES = {
  navy: "blue", iceblue: "blue", skyblue: "blue", lilac: "purple", violet: "purple",
  midnight: "black", graphite: "black", onyx: "black", space: "black", titanium: "silver",
  starlight: "white", ivory: "white", grey: "silver", gray: "silver", platinum: "silver",
  rose: "pink", crimson: "red", burgundy: "red", cream: "white",
};
const BASE_COLOURS = new Set([
  "black", "white", "blue", "red", "green", "gold", "silver", "purple", "pink",
  "brown", "grey", "gray", "orange", "yellow", "clear", "camouflage",
]);

/**
 * "Awesome Navy" → "blue"; "Moonlit Black" → "black"; "" when nothing reads as
 * a colour.
 *
 * A real colour word always beats a shade word, whatever the order. Taking the
 * last match alone turned "Blue Titanium" and "Black Titanium" both into silver,
 * because `titanium` is a material sitting after the colour that matters.
 */
function baseColour(name) {
  const words = String(name || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  let base = "";
  let shade = "";
  for (const w of words) {
    if (BASE_COLOURS.has(w)) base = w;
    else if (SHADES[w]) shade = SHADES[w];
  }
  const found = base || shade;
  return SHADES[found] || found;
}

/*
 * Phone brands, so a swatch never crosses one. Near-colour matching found real
 * photos for the Galaxy A55, Tecno and Infinix — all of them iPhones. A stand-in
 * HERO shot is a compromise the owner accepted; an iPhone on the button a
 * customer clicks to choose their Galaxy's colour is a different thing, and the
 * one place the picture is doing real work. Accessories carry no brand here on
 * purpose: a generic case is fairly illustrated by any case.
 */
const BRANDS = ["iphone", "apple", "airpods", "samsung", "galaxy", "tecno", "infinix", "xiaomi", "redmi", "oppo", "realme", "oneplus", "itel", "sony", "anker", "oraimo", "jbl"];
const BRAND_ALIASES = { apple: "apple", iphone: "apple", airpods: "apple", samsung: "samsung", galaxy: "samsung", xiaomi: "xiaomi", redmi: "xiaomi" };

/** The brand a product name names, or "" when it is generic. */
function brandOf(name) {
  const lower = String(name || "").toLowerCase();
  const hit = BRANDS.find((b) => lower.includes(b));
  return hit ? (BRAND_ALIASES[hit] || hit) : "";
}

/** Only block when BOTH sides name a brand and they differ. */
function brandsClash(targetName, sourceName) {
  const a = brandOf(targetName);
  const b = brandOf(sourceName);
  return Boolean(a && b && a !== b);
}

/** category → lowercased colour → { image, from }. Built from the backup. */
function buildColourIndex(backup) {
  const index = {};
  for (const p of backup) {
    for (const v of p.variants || []) {
      const colour = colourOf(v.attributes);
      const image = (v.images || [])[0];
      if (!colour || !image || !hostAllowed(image)) continue;
      const byColour = (index[p.category] ||= {});
      // First writer wins, so the most representative product for a category
      // keeps the colour rather than a later one overwriting it.
      byColour[colour.toLowerCase()] ||= { image, from: p.name, colour };
      const base = baseColour(colour);
      if (base) byColour[base] ||= { image, from: p.name, colour };
    }
  }
  return index;
}

/** What would change. Read-only. */
function planFor(products, index) {
  const plan = [];
  const clashes = [];
  for (const p of products) {
    const byColour = index[p.category] || {};
    const hits = [];
    for (const v of p.variants || []) {
      // Never overwrite a photograph someone uploaded.
      if (!(v.images || []).every(isPlaceholder) && (v.images || []).length) continue;
      const colour = colourOf(v.attributes);
      if (!colour) continue;
      const exact = byColour[colour.toLowerCase()];
      const match = exact || byColour[baseColour(colour)];
      if (match && brandsClash(p.name, match.from)) {
        clashes.push(`${p.sku} ${colour} — would have taken ${match.from}`);
        continue;
      }
      if (match) {
        hits.push({
          sku: v.sku, colour, image: match.image, from: match.from,
          // Flagged so a loose match is visible rather than passing as exact.
          via: exact ? null : `${baseColour(colour)} ← ${match.colour}`,
        });
      }
    }
    if (hits.length) plan.push({ _id: p._id, sku: p.sku, name: p.name, variants: hits });
  }
  plan.clashes = clashes;
  return plan;
}

async function applyPlan(plan) {
  let variants = 0;
  for (const entry of plan) {
    const doc = await Product.findById(entry._id);
    if (!doc) continue;
    for (const h of entry.variants) {
      const target = doc.variants.find((x) => x.sku === h.sku);
      if (target && (target.images || []).every(isPlaceholder)) {
        target.images = [h.image];
        variants += 1;
      }
    }
    await doc.save();
  }
  return { products: plan.length, variants };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const backup = require(path.join(__dirname, "..", "backups", process.env.BACKUP_FILE || "products-2026-09-04T16-27-46-034Z.json"));

  await mongoose.connect(requireMongoUrl());
  logDbTarget();

  const index = buildColourIndex(backup);
  const products = await Product.find({}).lean();
  const plan = planFor(products, index);
  const total = plan.reduce((n, p) => n + p.variants.length, 0);

  console.log(`\nReal per-colour photos for ${total} variant(s) across ${plan.length} product(s).\n`);
  for (const e of plan) {
    console.log(`  ${e.sku.padEnd(13)} ${e.name}`);
    for (const v of e.variants) {
      console.log(`      ${v.colour.padEnd(18)} ← ${v.from}${v.via ? `   [via ${v.via}]` : ""}`);
    }
  }

  // Everything still on a coloured square, and why.
  const remaining = [];
  for (const p of products) {
    const byColour = index[p.category] || {};
    for (const v of p.variants || []) {
      const colour = colourOf(v.attributes);
      if (colour && !byColour[colour.toLowerCase()] && !byColour[baseColour(colour)]) {
        remaining.push(`${p.sku} ${colour}`);
      }
    }
  }
  if (plan.clashes && plan.clashes.length) {
    console.log(`\nSkipped — the only photo of that colour is another brand's:`);
    for (const c of plan.clashes) console.log(`  ${c}`);
  }
  if (remaining.length) {
    console.log(`\n${remaining.length} variant(s) keep their colour placeholder — no real photo of`);
    console.log(`that colour exists for that kind of product.`);
  }

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply.\n`);
  } else {
    const r = await applyPlan(plan);
    console.log(`\nUpdated ${r.variants} variant(s) across ${r.products} product(s).\n`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { buildColourIndex, planFor, applyPlan, baseColour };
