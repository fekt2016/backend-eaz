/**
 * Remove documents left pointing at orders that no longer exist.
 *
 *   node scripts/clearOrphanedOrderRefs.js                          # DRY RUN
 *   node scripts/clearOrphanedOrderRefs.js --apply --confirm=<db>   # deletes
 *
 * Deleting orders leaves delivery charges and email logs referencing ids that
 * are gone. This clears exactly those and nothing else.
 *
 * ── What it deliberately does NOT touch ──────────────────────────────────
 * POS sales. They look like order residue in a raw collection count, but not
 * one of them references an order — they are counter sales, a separate stream
 * of real revenue. Deleting them would not be clearing orphans, it would be
 * deleting the repair shop's takings.
 *
 * Email logs unrelated to orders — welcome, two-factor, repair reminders —
 * are kept for the same reason: nothing about them is dangling.
 *
 * Everything removed is backed up first, with _ids preserved.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");

dotenv.config({ path: "./.env" });

const BACKUP_DIR = path.join(__dirname, "..", "backups");

/** Documents whose order pointer no longer resolves. */
async function findOrphans(db) {
  const liveIds = new Set(
    (await db.collection("orders").find({}, { projection: { _id: 1 } }).toArray()).map((o) => String(o._id))
  );
  const dangling = (doc) => {
    const ref = doc.order || doc.orderId;
    return ref ? !liveIds.has(String(ref)) : false;
  };

  const charges = (await db.collection("deliverycharges").find({}).toArray()).filter(dangling);
  const logs = (await db.collection("emaillogs").find({}).toArray()).filter(dangling);
  return { deliverycharges: charges, emaillogs: logs };
}

async function run() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(requireMongoUrl());
  const db = mongoose.connection.db;
  const { name } = mongoose.connection;
  logDbTarget();

  const orphans = await findOrphans(db);
  const total = orphans.deliverycharges.length + orphans.emaillogs.length;

  console.log(`\n${total} orphaned document(s):`);
  console.log(`  deliverycharges  ${orphans.deliverycharges.length}`);
  console.log(`  emaillogs        ${orphans.emaillogs.length}`);
  console.log(`\nLeft alone: POS sales (no order reference — separate revenue),`);
  console.log(`and email logs unrelated to orders (welcome, two-factor, reminders).`);

  if (!apply) {
    console.log(`\nDry run — nothing written. To clear:`);
    console.log(`  node scripts/clearOrphanedOrderRefs.js --apply --confirm=${name}\n`);
    return mongoose.disconnect();
  }

  const flag = (process.argv.find((a) => a.startsWith("--confirm=")) || "").split("=")[1];
  if (flag !== name) {
    console.log(`\nCancelled — pass --confirm=${name} to proceed.\n`);
    return mongoose.disconnect();
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `orphaned-order-refs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(orphans, null, 2));
  console.log(`\nBacked up ${total} document(s) → ${file}`);

  for (const [collection, docs] of Object.entries(orphans)) {
    if (!docs.length) continue;
    const res = await db.collection(collection).deleteMany({ _id: { $in: docs.map((d) => d._id) } });
    console.log(`Deleted ${res.deletedCount} from ${collection}.`);
  }
  console.log();
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { findOrphans };
