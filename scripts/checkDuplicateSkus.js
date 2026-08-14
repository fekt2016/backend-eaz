/**
 * Read-only pre-flight check for the unique SKU indexes on Part and Product.
 *
 * A unique (partial) index on `sku` will FAIL to build if the collection
 * already contains two docs with the same non-empty SKU. Run this first:
 *
 *   npm run check:duplicate-skus
 *
 * It only reports — it changes nothing. Resolve any duplicates it lists
 * (rename or blank one side) before deploying the models with the new index.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Part = require("../models/Part");
const Product = require("../models/Product");

dotenv.config({ path: "./.env" });

const mongoUrlRaw =
  process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
if (!mongoUrlRaw) {
  console.error("MONGO_URL is not defined in environment variables");
  process.exit(1);
}
const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
const db =
  mongoUrlRaw.includes("<PASSWORD>") && dbPassword
    ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
    : mongoUrlRaw;

async function findDuplicates(Model, label) {
  // Group non-empty SKUs and keep only those used more than once.
  const dupes = await Model.aggregate([
    { $match: { sku: { $type: "string", $gt: "" } } },
    { $group: { _id: "$sku", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  if (!dupes.length) {
    console.log(`✅ ${label}: no duplicate SKUs — safe to build the unique index.`);
    return 0;
  }

  console.log(`❌ ${label}: ${dupes.length} duplicated SKU(s):`);
  for (const d of dupes) {
    console.log(`   • "${d._id}" used ${d.count}× → ${d.ids.join(", ")}`);
  }
  return dupes.length;
}

async function run() {
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected\n");

  const partDupes = await findDuplicates(Part, "Part");
  const productDupes = await findDuplicates(Product, "Product");

  await mongoose.connection.close();

  const total = partDupes + productDupes;
  console.log(
    total === 0
      ? "\nAll clear. You can deploy the unique SKU indexes."
      : `\nFound ${total} duplicate SKU group(s). Resolve them before deploying.`,
  );
  process.exit(total === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});
