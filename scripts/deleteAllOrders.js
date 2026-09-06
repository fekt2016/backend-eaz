/**
 * Delete every shop order.
 *
 *   node scripts/deleteAllOrders.js                          # DRY RUN — prints the plan, writes nothing
 *   node scripts/deleteAllOrders.js --apply --confirm=<db>   # deletes
 *
 * ⚠️ ORDERS ARE FINANCIAL RECORDS. Read this before running it.
 *
 * Unlike products, an order is the record that money moved. Deleting them takes
 * out every revenue figure and sales report, the customers' own order history
 * and track-order lookups, and leaves Paystack holding payments with nothing to
 * reconcile against. Sale, DeliveryCharge and EmailLog documents keep pointers
 * to orders that no longer exist.
 *
 * It also does NOT put stock back. A fulfilled order already decremented it;
 * deleting the order leaves the counts where they are while removing the reason
 * for them. If restoring stock is the actual goal, cancel or refund the orders
 * instead — that path exists and gives the units back properly.
 *
 * ── What makes it recoverable ────────────────────────────────────────────
 * Every order is written to backups/orders-<timestamp>.json first, with _ids
 * preserved, so a restore puts the references back exactly as they were.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Order = require("../models/Order");
const { logDbTarget } = require("../utils/dbTarget");
const { requireMongoUrl } = require("../utils/mongoUrl");

dotenv.config({ path: "./.env" });

const BACKUP_DIR = path.join(__dirname, "..", "backups");

async function backupOrders() {
  const docs = await Order.find({}).lean();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `orders-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(docs, null, 2));
  return { file, count: docs.length };
}

function confirmPrompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function run() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(requireMongoUrl());
  const { host, name } = mongoose.connection;
  logDbTarget();

  const total = await Order.countDocuments();
  const byStatus = await Order.aggregate([
    { $group: { _id: "$status", n: { $sum: 1 }, value: { $sum: "$total" } } },
    { $sort: { n: -1 } },
  ]);
  const revenue = byStatus
    .filter((s) => ["paid", "processing", "shipped", "delivered"].includes(s._id))
    .reduce((sum, s) => sum + s.value, 0);

  console.log(`\n${total} order(s) would be PERMANENTLY DELETED.\n`);
  byStatus.forEach((s) => console.log(`  ${String(s._id).padEnd(12)} ${String(s.n).padStart(4)}   GH₵${(s.value / 100).toLocaleString()}`));
  console.log(`\nRevenue represented: GH₵${(revenue / 100).toLocaleString()}`);
  console.log(`Reports, customer order history and track-order all read from these rows.`);
  console.log(`Stock is NOT restored — cancel or refund instead if that is the goal.`);

  if (!apply) {
    console.log(`\nDry run — nothing written. To delete:`);
    console.log(`  node scripts/deleteAllOrders.js --apply --confirm=${name}\n`);
    return mongoose.disconnect();
  }

  const flag = (process.argv.find((a) => a.startsWith("--confirm=")) || "").split("=")[1];
  const answer = flag !== undefined
    ? flag
    : process.stdin.isTTY
      ? await confirmPrompt(`\nType the database name (${name}) to proceed: `)
      : null;

  if (answer === null) {
    console.log(`\nStdin is not a terminal. Re-run with --confirm=${name}\n`);
    return mongoose.disconnect();
  }
  if (answer !== name) {
    console.log("\nCancelled. Nothing was written.\n");
    return mongoose.disconnect();
  }

  const backup = await backupOrders();
  console.log(`\nBacked up ${backup.count} order(s) → ${backup.file}`);
  const del = await Order.deleteMany({});
  console.log(`Deleted ${del.deletedCount} order(s).\n`);

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { backupOrders };
