/**
 * Give the current catalogue real photographs, taken from the 104 products the
 * replacement deleted.
 *
 *   node scripts/adoptRealImages.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/adoptRealImages.js --apply    # writes
 *
 * The old catalogue carried real manufacturer imagery — apple.com, samsung.com,
 * jbl.com, spigen, ugreen — which is why next.config.mjs allowlists those hosts.
 * The backup written before the delete still has all of it, so the honest source
 * of real photos is that file, not something invented.
 *
 * ── Matching is EXPLICIT, and deliberately incomplete ────────────────────
 * Each entry below names the backup products to draw from. Where the old
 * catalogue had no genuine equivalent — no Tecno, no Infinix, no Oraimo — the
 * product is left on its generated placeholder ON PURPOSE. Dressing an Infinix
 * Hot 40i in a Samsung Galaxy S24 photograph would mislead a customer about what
 * they are buying, which is worse than an honest placeholder.
 *
 * The hero is the first match's main image. The gallery is every image the
 * matched products carry (their own hero plus their gallery), deduplicated and
 * capped, so a product ends up with several real angles rather than one.
 *
 * Only ever replaces a placehold.co URL. A photograph already on a product —
 * including one uploaded since — is never touched.
 */
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");

dotenv.config({ path: "./.env" });

const MAX_GALLERY = 5;

/**
 * SKU → the backup products to take imagery from, most representative first.
 * A missing entry means "no honest match; keep the placeholder".
 */
const SOURCES = {
  // Anchored on the capacity suffix every phone listing carried. Without it,
  // "iPhone 15 Pro Max Telephoto Camera" and "…OLED Screen Replacement" matched,
  // and the phone's gallery filled with pictures of loose repair parts.
  "EZW-IPH-001": [/^iPhone 15 Pro \(\d+(GB|TB)\)$/i, /^iPhone 15 Pro Max \(\d+(GB|TB)\)$/i],
  "EZW-IPH-005": [/^iPhone 13 OLED Screen Replacement/i, /OLED Screen Replacement/i],
  "EZW-ANK-007": [/^Anker PowerCore 10000/i, /^Anker PowerCore 20000/i, /^Anker PowerCore Slim/i],
  "EZW-AIR-010": [/^Apple AirPods Pro 2/i],                               // exact model
  "EZW-BRA-009": [/^UGREEN 100W Braided USB-C Cable/i, /^Belkin BoostCharge Braided Cable/i],
  "EZW-TEM-012": [/^Spigen Tempered Glass Screen Protector/i, /^ESR Screen Protector/i],
  "EZW-SIL-013": [/^Spigen Liquid Crystal Case/i, /^Nillkin Air Case/i, /^Olixar Clear Case/i],
  "EZW-CHA-015": [/^iPhone 13 Lightning Charging Port Flex/i, /Charging Port Flex/i],
};

/**
 * Second tier: the nearest thing in the old catalogue, for products it never
 * carried. Applied at the owner's instruction (2026-09-04) after the mismatch
 * was flagged.
 *
 * ⚠️ These are the RIGHT KIND of product, not the right model — a Galaxy S24
 * standing in for an A55, an Anker charger for an Oraimo. Good enough to make
 * the catalogue look finished; NOT good enough to ship to a customer, who would
 * receive something visibly different from the picture. Each is listed in the
 * run output under "approximate" so it is obvious what still needs real
 * photography.
 */
const APPROXIMATE = {
  // Samsung phones — right brand, wrong model.
  "EZW-SAM-002": [/^Samsung Galaxy S24 \(/i, /^Samsung Galaxy S24\+/i, /^Samsung Galaxy S23 FE/i],
  // Every budget Android in the old catalogue (Realme, Itel, OPPO, OnePlus) had
  // only placeholder images itself, so the nearest REAL photo of an Android
  // handset is a Galaxy S. Visibly not a Tecno or an Infinix — the most
  // approximate entries here by some distance.
  "EZW-TEC-003": [/^Samsung Galaxy S23 FE/i, /^Samsung Galaxy S24 \(/i],
  "EZW-INF-004": [/^Samsung Galaxy S24\+/i, /^Samsung Galaxy S24 \(/i],
  // A phone battery is a phone battery visually, even across brands.
  "EZW-SAM-006": [/Battery \(\d+mAh\)$/i],
  // 20W USB-C chargers — Anker rather than Oraimo.
  "EZW-ORA-008": [/^Anker Nano 20W USB-C Charger/i, /^Anker 20W USB-C Power Adapter/i, /^Anker 30W 3-Port Charger/i],
  // Wireless earbuds — Samsung/Anker rather than Oraimo.
  "EZW-ORA-011": [/^Samsung Galaxy Buds2/i, /^Anker Soundcore Space A40/i, /^Sony WF-1000XM4/i],
  // Phone cases — none is a leather wallet, but they are cases.
  "EZW-LEA-014": [/^Moshi Syber Case/i, /^Lamicall Nylon Case/i, /^OtterBox Defender Case/i],
};

/** Why an approximate source was used — printed so the compromise is visible. */
const APPROXIMATE_REASON = {
  "EZW-SAM-002": "Samsung S-series stands in — no A55 in the old catalogue",
  "EZW-TEC-003": "Galaxy S photo stands in — every budget Android in the backup was itself a placeholder",
  "EZW-INF-004": "Galaxy S photo stands in — every budget Android in the backup was itself a placeholder",
  "EZW-SAM-006": "iPhone battery photos stand in for a Samsung A-series part",
  "EZW-ORA-008": "Anker 20W chargers stand in for Oraimo",
  "EZW-ORA-011": "Samsung/Anker earbuds stand in for Oraimo FreePods",
  "EZW-LEA-014": "generic cases stand in — none is a leather wallet",
};

/*
 * next/image refuses any host absent from the frontend's remotePatterns, and
 * throws a runtime error rather than falling back — one image on an unlisted
 * host takes the whole product page down. T124 deliberately NARROWED that list,
 * so hosts the old catalogue used (otterbox.com among them) are no longer
 * allowed, and adopting an image without checking broke the Leather Wallet Case
 * page. Read the list from the frontend so it cannot drift; fall back to
 * adopting nothing rather than guessing if the file moves.
 */
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

/** Will next/image actually render this URL? */
function hostAllowed(url) {
  if (!ALLOWED_HOSTS) return false;
  try { return ALLOWED_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

const isPlaceholder = (u) => typeof u === "string" && u.includes("placehold.co");
/**
 * Replaceable: nothing there, our own placeholder, or an image on a host
 * next/image will reject — that last one renders as a crashed page, so it is
 * worse than no image at all. A real photo on an allowed host is never touched.
 */
const allPlaceholder = (arr) =>
  !Array.isArray(arr) ||
  arr.length === 0 ||
  arr.every((u) => isPlaceholder(u) || !hostAllowed(u));

/**
 * A gallery needs rebuilding if ANY single image is on a blocked host — one is
 * enough to crash the page, and the rest being fine does not save it. This is
 * what the "every" test above missed: the Leather Wallet Case gallery held two
 * usable images and one OtterBox, so it read as healthy while the page threw.
 */
const anyBlocked = (arr) => Array.isArray(arr) && arr.some((u) => !hostAllowed(u));

/** Every image a backup product carries, hero first. */
function imagesOf(doc) {
  return [...(doc.images || []), ...((doc.gallery && doc.gallery.images) || [])].filter(Boolean);
}

/** Real imagery for one SKU, or null when there is no honest source. */
function imageryFor(sku, backup) {
  const exact = Boolean(SOURCES[sku]);
  const patterns = SOURCES[sku] || APPROXIMATE[sku];
  if (!patterns) return null;
  const matched = [];
  for (const re of patterns) {
    for (const doc of backup) {
      if (re.test(doc.name || "") && !matched.includes(doc)) matched.push(doc);
    }
  }
  if (!matched.length) return null;
  const images = [...new Set(matched.flatMap(imagesOf))]
    .filter((u) => !isPlaceholder(u))
    // A blocked host would crash the product page, so it is not a usable photo.
    .filter(hostAllowed);
  if (!images.length) return null;
  return {
    hero: images[0],
    // The hero is in the gallery too, so the first thumbnail matches the main shot.
    gallery: images.slice(0, MAX_GALLERY),
    from: matched.map((m) => m.name),
    exact,
  };
}

/** What would change. Read-only. */
function planFor(products, backup) {
  const plan = [];
  for (const p of products) {
    const imagery = imageryFor(p.sku, backup);
    if (!imagery) continue;
    // Never overwrite a real photograph, only our own placeholder.
    const heroNeeded = allPlaceholder(p.images) || anyBlocked(p.images);
    const galleryImages = p.gallery && p.gallery.images;
    const galleryNeeded = allPlaceholder(galleryImages) || anyBlocked(galleryImages);
    if (!heroNeeded && !galleryNeeded) continue;
    plan.push({
      _id: p._id, sku: p.sku, name: p.name,
      hero: heroNeeded ? imagery.hero : null,
      gallery: galleryNeeded ? imagery.gallery : null,
      from: imagery.from,
      exact: imagery.exact,
    });
  }
  return plan;
}

async function applyPlan(plan) {
  let heroes = 0;
  let galleries = 0;
  for (const entry of plan) {
    const doc = await Product.findById(entry._id);
    if (!doc) continue;
    if (entry.hero) { doc.images = [entry.hero]; heroes += 1; }
    if (entry.gallery) {
      doc.gallery = { images: entry.gallery, videos: (doc.gallery && doc.gallery.videos) || [] };
      galleries += 1;
    }
    await doc.save();
  }
  return { products: plan.length, heroes, galleries };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const backup = require(path.join(__dirname, "..", "backups", process.env.BACKUP_FILE || "products-2026-09-04T16-27-46-034Z.json"));

  await mongoose.connect(requireMongoUrl());
  logDbTarget();

  const products = await Product.find({}).lean();
  const plan = planFor(products, backup);

  const exact = plan.filter((e) => e.exact);
  const approx = plan.filter((e) => !e.exact);

  console.log(`\nReal imagery for ${plan.length} of ${products.length} product(s).\n`);
  console.log(`EXACT — the product's own photography:`);
  for (const e of exact) {
    console.log(`  ${e.sku.padEnd(13)} ${e.name}`);
    console.log(`      ${e.gallery ? e.gallery.length : 0} image(s) from: ${e.from.join(", ")}`);
  }
  if (approx.length) {
    console.log(`\n⚠️  APPROXIMATE — right kind of product, WRONG MODEL. Replace before`);
    console.log(`    anyone buys from these pictures:`);
    for (const e of approx) {
      console.log(`  ${e.sku.padEnd(13)} ${e.name}`);
      console.log(`      ${APPROXIMATE_REASON[e.sku] || ""}`);
      console.log(`      ${e.gallery ? e.gallery.length : 0} image(s) from: ${e.from.join(", ")}`);
    }
  }
  const left = products.filter((p) => !SOURCES[p.sku] && !APPROXIMATE[p.sku]);
  if (left.length) {
    console.log(`\nStill on placeholders:`);
    for (const p of left) console.log(`  ${p.sku.padEnd(13)} ${p.name}`);
  }

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply.\n`);
  } else {
    const r = await applyPlan(plan);
    console.log(`\nUpdated ${r.products} product(s): ${r.heroes} hero image(s), ${r.galleries} gallery/galleries.\n`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { planFor, applyPlan, imageryFor, SOURCES };
