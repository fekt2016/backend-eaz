/**
 * Replace the product catalogue with the 15 sample products.
 *
 *   node scripts/replaceCatalogue.js                  # DRY RUN — shows the plan, writes nothing
 *   node scripts/replaceCatalogue.js --apply          # back up, delete every product, insert 15
 *   node scripts/replaceCatalogue.js --apply --confirm=eazworld
 *                                                     # same, naming the database up front, for
 *                                                     # shells where stdin is not a terminal
 *
 * ⚠️ THIS DELETES EVERY PRODUCT. Read this before running it.
 *
 * ── It targets whatever .env points at ───────────────────────────────────
 * This repo's .env points at the LIVE ATLAS CLUSTER (see utils/dbTarget.js).
 * The target host and database are printed before anything happens, and with
 * --apply the script pauses so you can read them and cancel. To aim it
 * somewhere safe instead:
 *
 *   MONGO_URL=mongodb://localhost:27017/eazworld_dev node scripts/replaceCatalogue.js --apply
 *
 * ── It orphans references, and that is not undone by re-seeding ──────────
 * Five collections point at products — Order, Sale, RepairJob, PartOrder and
 * RepairOrder — and those are records of money that actually moved. Deleting
 * the products leaves every one of those pointers dangling: past receipts,
 * sales reports, COGS and the parts on completed repair jobs all reference
 * documents that no longer exist. Re-inserting does NOT repair them, because
 * the new products get new _ids.
 *
 * The owner accepted this on 2026-09-04. It is written down because the next
 * person to read this file will not have been in that conversation.
 *
 * ── What makes it recoverable ────────────────────────────────────────────
 * Before deleting, every existing product is written to
 * backups/products-<timestamp>.json — the full documents, _ids included. Restore
 * with `mongoimport`, or a short script, if this turns out to be wrong.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");
const catalogue = require("./data/sampleCatalogue");

dotenv.config({ path: "./.env" });

const BACKUP_DIR = path.join(__dirname, "..", "backups");

/** Every existing product, verbatim, to a timestamped file. Returns the path. */
async function backupProducts() {
  const docs = await Product.find({}).lean();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `products-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(docs, null, 2));
  return { file, count: docs.length };
}

/** Ask before touching a database whose name does not look disposable. */
function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function run() {
  const apply = process.argv.includes("--apply");
  // .env keeps `<PASSWORD>` in MONGO_URL and the secret in DATABASE_PASSWORD;
  // connecting with the raw value fails as a confusing "bad auth".
  const url = requireMongoUrl();

  await mongoose.connect(url);
  const { host, name } = mongoose.connection;
  logDbTarget();

  const existing = await Product.countDocuments();
  console.log(`\nExisting products : ${existing}  (all would be DELETED)`);
  console.log(`Would insert      : ${catalogue.length} products, ${catalogue.reduce((n, p) => n + p.variants.length, 0)} variants`);
  console.log(`\nProducts to insert:`);
  catalogue.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${p.sku.padEnd(12)} ${p.name.padEnd(38)} GH₵${(p.price / 100).toLocaleString()}`);
  });

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.\n");
    return mongoose.disconnect();
  }

  // A live-looking target gets an explicit, typed confirmation. The point is to
  // make "I meant the dev database" impossible to do by accident.
  const looksLive = /mongodb\.net/i.test(host || "") || !/(test|dev|local)/i.test(name || "");
  if (looksLive) {
    console.log(`\n⚠️  ${host}/${name} does not look like a throwaway database.`);
    console.log(`⚠️  ${existing} product(s) will be permanently deleted, and past orders,`);
    console.log(`⚠️  sales and repair jobs will keep pointers to products that no longer exist.`);

    // The confirmation can arrive as --confirm=<dbname> instead of a prompt.
    // Not a weaker gate: the operator still has to name the database, and it is
    // the only form that works where stdin is not a terminal — a backgrounded
    // shell, CI, or a wrapper — where readline simply hangs forever.
    const flag = (process.argv.find((a) => a.startsWith("--confirm=")) || "").split("=")[1];
    const answer = flag !== undefined
      ? flag
      : process.stdin.isTTY
        ? await confirm(`\nType the database name (${name}) to proceed, anything else to cancel: `)
        : null;

    if (answer === null) {
      console.log(`\nStdin is not a terminal, so there is nothing to type into.`);
      console.log(`Re-run with the database name on the command line:\n`);
      console.log(`  npm run catalogue:replace -- --apply --confirm=${name}\n`);
      return mongoose.disconnect();
    }
    if (answer !== name) {
      console.log("\nCancelled. Nothing was written.\n");
      return mongoose.disconnect();
    }
  }

  const backup = await backupProducts();
  console.log(`\nBacked up ${backup.count} product(s) → ${backup.file}`);

  const del = await Product.deleteMany({});
  console.log(`Deleted ${del.deletedCount} product(s).`);

  const inserted = await Product.insertMany(catalogue, { ordered: true });
  console.log(`Inserted ${inserted.length} product(s), ${inserted.reduce((n, p) => n + p.variants.length, 0)} variants.`);
  console.log(`\nDone. Add the remaining 5 through the item form.\n`);

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { backupProducts, catalogue };
