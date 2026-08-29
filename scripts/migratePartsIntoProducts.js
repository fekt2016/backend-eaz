/**
 * Migration: fold the Part collection into Product, so one model serves the
 * shop, the POS counter and the repair bench.
 *
 *   node scripts/migratePartsIntoProducts.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/migratePartsIntoProducts.js --apply    # actually writes
 *
 * Why: a shop product and a repair part are the same thing — something we stock
 * and sell — that grew from two directions. The codebase already converts each
 * into the other in both directions (`partAsProduct` in productController for
 * the shop, `normalizeProduct` in pos/common for the counter), which is the
 * clearest possible sign there is one entity stored as two. Every feature that
 * touches "a sellable thing" has had to be written twice, and the ones where
 * somebody wrote it once are bugs: the shipping quote rejected parts outright,
 * parts had no view/sold counters, POS part sales never reached the sold count.
 *
 * ── Why this is safe to run ──────────────────────────────────────────────
 * Documents are copied INTO the products collection with their `_id`
 * PRESERVED. Five schemas hold `ref: 'Part'` pointers into live financial
 * history — Order, RepairJob, Sale, PartOrder, RepairOrder — and because the
 * ids do not change, every one of those stored pointers still resolves after
 * the ref target is switched to Product. No historical document is rewritten.
 *
 * The parts collection is NOT deleted or modified. It stays exactly as it is,
 * so rollback is "stop using the copies" rather than a restore.
 *
 * Idempotent: a part whose `_id` already exists in products is skipped, so a
 * second run reports nothing to do and never double-writes.
 *
 * The dry run pre-flights the plan: every document it would write is put
 * through the Product schema with `validateSync()`, and SKUs are checked
 * against the batch and against stored products (a unique partial index the
 * schema itself cannot see). --apply refuses to write a plan with any failure,
 * rather than discovering it partway through the batch.
 *
 * ── Field mapping ────────────────────────────────────────────────────────
 *   sellingPrice      → price          (both already integer pesewas)
 *   quantity          → stock
 *   category (enum)   → partCategory, and copied to `category` so the required
 *                       shop-facing field is populated. The two are different
 *                       namespaces (Screen/Battery vs Phones/Accessories),
 *                       which is why both are kept rather than merged.
 *   isRetail          → sellOnline + sellInStore  (a part sellable over the
 *                       counter is exactly the one listed in the shop today)
 *   —                 → useInRepairs: true        (every part can go on a job)
 *   description|notes → description
 *   costPrice, barcode, supplier, compatibleWith, lowStockThreshold,
 *   allowNegativeStock, notes, sku, images, views, sold → carried across as-is
 *
 * `slug` is required and unique on Product; parts never had one (the shop
 * addressed them through a synthetic `part-<id>` URL). One is generated from
 * the name here, with the id's tail appended on collision.
 *
 * Existing products are given the three channel flags in the same run:
 * sellOnline mirrors their current `isActive`, sellInStore is true (the POS
 * Sell page already searches products), useInRepairs is false.
 *
 * `costPrice` is left at 0 for products that have none — products never stored
 * a cost, so there is nothing to migrate. Those are listed in the report: until
 * someone fills them in, profit and inventory valuation exclude those lines
 * rather than inventing a margin.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Part = require("../models/Part");
const Product = require("../models/Product");
const { logDbTarget } = require("../utils/dbTarget");

dotenv.config({ path: "./.env" });

/** Mirror of productController's slugify so generated slugs match hand-made ones. */
function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A slug for a migrated part that no product is using. Falls back to the id's
 * tail, then to a counter — a part named only in punctuation still gets one.
 */
async function uniqueSlug(name, id, taken) {
  const base = slugify(name) || `part-${String(id)}`;
  if (!taken.has(base) && !(await Product.exists({ slug: base }))) {
    taken.add(base);
    return base;
  }

  const suffixed = `${base}-${String(id).slice(-6)}`;
  if (!taken.has(suffixed) && !(await Product.exists({ slug: suffixed }))) {
    taken.add(suffixed);
    return suffixed;
  }

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${suffixed}-${n}`;
    if (!taken.has(candidate) && !(await Product.exists({ slug: candidate }))) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not find a free slug for part ${id} ("${name}")`);
}

/** Shape one Part document as the Product it becomes. `_id` is preserved. */
function partAsProductDoc(part, slug) {
  return {
    _id: part._id,
    name: part.name,
    slug,
    description: part.description || part.notes || "",
    price: Math.round(Number(part.sellingPrice) || 0),
    costPrice: Math.round(Number(part.costPrice) || 0),
    category: part.category || "Other",
    partCategory: part.category || "Other",
    stock: Math.max(0, Math.round(Number(part.quantity) || 0)),
    sku: part.sku || "",
    barcode: part.barcode || "",
    images: Array.isArray(part.images) ? part.images : [],
    supplier: part.supplier || undefined,
    compatibleWith: Array.isArray(part.compatibleWith) ? part.compatibleWith : [],
    notes: part.notes || "",
    lowStockThreshold: Math.max(0, Number(part.lowStockThreshold) || 0),
    allowNegativeStock: Boolean(part.allowNegativeStock),
    // A part sellable over the counter is exactly the one the shop lists today.
    sellOnline: Boolean(part.isRetail),
    sellInStore: Boolean(part.isRetail),
    useInRepairs: true,
    // `isActive` still gates the shop until the cutover switches those reads to
    // sellOnline; keep the two saying the same thing meanwhile.
    isActive: Boolean(part.isRetail),
    views: Math.max(0, Number(part.views) || 0),
    sold: Math.max(0, Number(part.sold) || 0),
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
  };
}

/**
 * Give existing products the channel flags. Only touches documents where a flag
 * is absent, so re-running never overwrites a choice someone has since made.
 * Returns the number of products updated.
 */
async function backfillProductChannels({ apply = false, log = console.log } = {}) {
  const missing = await Product.countDocuments({ sellOnline: { $exists: false } });
  if (!missing) {
    log("✅ Every product already has the channel flags.");
    return 0;
  }

  log(`${missing} existing product(s) need channel flags (sellOnline ← isActive, sellInStore ← true).`);
  if (!apply) return 0;

  // sellOnline mirrors isActive, so an inactive product does not silently
  // reappear in the shop. A pipeline update so both branches are one pass.
  const res = await Product.updateMany({ sellOnline: { $exists: false } }, [
    {
      $set: {
        sellOnline: { $ifNull: ["$isActive", true] },
        sellInStore: true,
        useInRepairs: false,
      },
    },
  ]);
  return res.modifiedCount || 0;
}

/**
 * Put the planned documents through the Product schema — and through the one
 * uniqueness rule the schema cannot see — before anything is written, so a
 * problem shows up in the DRY RUN rather than as a per-document failure
 * halfway through an --apply.
 *
 * `validateSync` skips the pre("validate") hooks by design (those only run on
 * the async path). Both are no-ops here anyway: every planned doc already
 * carries an explicit `slug` and `sellOnline`.
 *
 * SKU is checked alongside because it carries a unique partial index and the
 * existing pre-flight (`npm run check:duplicate-skus`) groups within each
 * collection separately — a part sharing a SKU with a *product* is invisible to
 * it, and this migration is exactly what brings the two into one collection.
 *
 * Returns an array of { id, name, reasons }; empty means the plan is clean.
 */
async function preflightPlanned(planned, log = console.log) {
  const byId = new Map();
  const addReason = (doc, reason) => {
    const id = String(doc._id);
    if (!byId.has(id)) byId.set(id, { id, name: doc.name, reasons: [] });
    byId.get(id).reasons.push(reason);
  };

  for (const doc of planned) {
    const err = new Product(doc).validateSync();
    if (err) for (const e of Object.values(err.errors)) addReason(doc, e.message);
  }

  // SKU collisions: first within this batch, then against products already stored.
  const withSku = planned.filter((d) => d.sku);
  const firstUse = new Map();
  for (const doc of withSku) {
    const seen = firstUse.get(doc.sku);
    if (seen) addReason(doc, `SKU "${doc.sku}" is also used by "${seen.name}" in this batch`);
    else firstUse.set(doc.sku, doc);
  }

  if (firstUse.size) {
    const clashes = await Product.find({ sku: { $in: [...firstUse.keys()] } })
      .select("name sku")
      .lean();
    const bySku = new Map(clashes.map((p) => [p.sku, p]));
    for (const doc of withSku) {
      const clash = bySku.get(doc.sku);
      if (clash) addReason(doc, `SKU "${doc.sku}" already belongs to product "${clash.name}" (${clash._id})`);
    }
  }

  const problems = [...byId.values()];
  if (!problems.length) {
    log(`\n✅ Pre-flight: all ${planned.length} planned document(s) pass the Product schema, no SKU collisions.`);
    return problems;
  }

  log(`\n❌ Pre-flight: ${problems.length} planned document(s) would fail:`);
  for (const prob of problems) {
    log(`   ✗ ${prob.name} (${prob.id})`);
    for (const reason of prob.reasons) log(`       – ${reason}`);
  }
  return problems;
}

/**
 * Copy every Part into Product. Exported so the tests can drive it against
 * mongodb-memory-server without going near a real connection string.
 * Returns { scanned, migrated, skipped, failed, needCost, problems }.
 */
async function migratePartsIntoProducts({ apply = false, log = console.log } = {}) {
  const parts = await Part.find({}).sort({ createdAt: 1 }).lean();

  if (!parts.length) {
    log("✅ No parts to migrate.");
    return { scanned: 0, migrated: 0, skipped: 0, failed: 0, needCost: [], problems: [] };
  }

  // Ids already present in products — a previous run, or a part and product
  // that somehow share an id (not possible with ObjectIds, but checked anyway).
  const existing = await Product.find({ _id: { $in: parts.map((p) => p._id) } })
    .select("_id")
    .lean();
  const already = new Set(existing.map((p) => String(p._id)));

  const pending = parts.filter((p) => !already.has(String(p._id)));

  log(`Parts: ${parts.length} total, ${already.size} already migrated, ${pending.length} to copy.`);

  if (!pending.length) {
    log("✅ Nothing left to migrate.");
    return { scanned: parts.length, migrated: 0, skipped: already.size, failed: 0, needCost: [], problems: [] };
  }

  const taken = new Set();
  const planned = [];
  for (const part of pending) {
    const slug = await uniqueSlug(part.name, part._id, taken);
    planned.push(partAsProductDoc(part, slug));
  }

  for (const doc of planned) {
    log(
      `   • ${doc.name} → slug "${doc.slug}" · ${doc.stock} in stock · ` +
        `${doc.sellOnline ? "shop+POS" : "bench only"}${doc.costPrice ? "" : " · NO COST"}`,
    );
  }

  const problems = await preflightPlanned(planned, log);

  if (!apply) {
    log(`\nWould copy ${planned.length} part(s) into products, preserving each _id.`);
    log(
      problems.length
        ? "Dry run — nothing written. Fix the pre-flight failures above before --apply."
        : "Dry run — nothing written. Re-run with --apply.",
    );
    return { scanned: parts.length, migrated: 0, skipped: already.size, failed: 0, needCost: [], problems };
  }

  // All-or-nothing on a known-bad plan: the copy loop below tolerates a failure
  // per document, which would leave the batch half-applied for a problem that
  // was already visible here. Refuse instead — the run is idempotent, so fixing
  // the data and re-running picks up exactly where this stopped.
  if (problems.length) {
    log(`\nRefusing to write: ${problems.length} planned document(s) would fail. Nothing was written.`);
    return {
      scanned: parts.length,
      migrated: 0,
      skipped: already.size,
      failed: problems.length,
      needCost: [],
      problems,
    };
  }

  let migrated = 0;
  let failed = 0;
  for (const doc of planned) {
    try {
      await Product.create(doc);
      migrated += 1;
    } catch (err) {
      failed += 1;
      log(`   ✗ ${doc.name} (${doc._id}): ${err.message}`);
    }
  }

  // Everything now in products that still has no cost — the figure reports must
  // exclude rather than guess at.
  const needCost = await Product.find({ $or: [{ costPrice: 0 }, { costPrice: { $exists: false } }] })
    .select("name sku slug price")
    .sort({ name: 1 })
    .lean();

  return { scanned: parts.length, migrated, skipped: already.size, failed, needCost, problems };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const rawUri = process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!rawUri) {
    console.error("MONGO_URL (or mongo_url) is not defined in environment variables — refusing to run.");
    process.exit(1);
  }

  // Same resolution as server.js: the .env URI carries a <PASSWORD> placeholder.
  const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
  const uri =
    rawUri.includes("<PASSWORD>") && dbPassword ? rawUri.replace("<PASSWORD>", dbPassword) : rawUri;

  await mongoose.connect(uri);
  logDbTarget();
  console.log(apply ? "MODE: APPLY — writes are real.\n" : "MODE: DRY RUN — nothing will be written.\n");

  const flagged = await backfillProductChannels({ apply });
  if (flagged) console.log(`Updated ${flagged} existing product(s) with channel flags.\n`);

  const result = await migratePartsIntoProducts({ apply });

  console.log(
    `\nScanned ${result.scanned} part(s) · migrated ${result.migrated} · ` +
      `already present ${result.skipped} · failed ${result.failed}`,
  );

  if (apply && result.needCost.length) {
    console.log(
      `\n⚠️  ${result.needCost.length} item(s) have no cost price. They are excluded from ` +
        `profit and inventory valuation until a real cost is entered:`,
    );
    for (const p of result.needCost) console.log(`   • ${p.name}${p.sku ? ` (${p.sku})` : ""} — /${p.slug}`);
  }

  console.log("\nThe parts collection was not modified. Nothing has been switched over yet.");
  await mongoose.disconnect();

  // Non-zero so a failing plan stops a `&&` chain instead of reading as success.
  if (result.problems && result.problems.length) process.exitCode = 1;
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  migratePartsIntoProducts,
  backfillProductChannels,
  preflightPlanned,
  partAsProductDoc,
  uniqueSlug,
  slugify,
};
