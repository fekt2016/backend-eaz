/**
 * One-off migration: convert the POS/repair money snapshots from major GHS
 * (e.g. 50 = GH₵50, possibly fractional like 45.5) to integer minor units
 * (pesewas ×100), matching Part and the shop Order.
 *
 * Covered collections/fields (Group A in PHASE7_MONEY_MIGRATION_PLAN.md):
 *   repairjobs : laborCost, diagnosisFee, depositPaid, parts[].priceAtTime, parts[].costAtTime
 *   sales      : subtotal, discount, total, amountPaid, changeDue, items[].unitPrice, items[].subtotal
 *   partorders : unitPriceGhs, amountGhs                (NOT subtotalPesewas — already pesewas)
 *   repairorders: items[].unitPriceGhs                  (NOT *Pesewas fields — already pesewas)
 *   pospayments: amount
 *   expenses   : amount
 *
 * NOT touched (already pesewas): Order, Product, DeliveryZone, *Pesewas fields,
 * RepairJob.balancePayments[].amountPesewas. Out of scope: hosting/domain/service.
 *
 * Idempotent: each migrated document is stamped `moneyUnit: 'pesewas'` and
 * skipped on re-run. Safe to run twice. Non-destructive (no deletes).
 *
 * Run manually — never wired into app startup:
 *   npm run migrate:pos-money
 */

// ×100 with rounding, null-safe.
const toPesewas = (field) => ({
  $round: [{ $multiply: [{ $ifNull: [field, 0] }, 100] }, 0],
});

// Map a nested array, multiplying the named money fields by 100.
const mapItems = (arrayField, moneyFields) => ({
  $map: {
    input: { $ifNull: [arrayField, []] },
    as: "it",
    in: {
      $mergeObjects: [
        "$$it",
        moneyFields.reduce((acc, f) => {
          acc[f] = toPesewas(`$$it.${f}`);
          return acc;
        }, {}),
      ],
    },
  },
});

// Aggregation-pipeline update per collection (keyed by Mongo collection name).
const PIPELINES = {
  repairjobs: [
    {
      $set: {
        laborCost: toPesewas("$laborCost"),
        diagnosisFee: toPesewas("$diagnosisFee"),
        depositPaid: toPesewas("$depositPaid"),
        parts: mapItems("$parts", ["priceAtTime", "costAtTime"]),
        moneyUnit: "pesewas",
      },
    },
  ],
  sales: [
    {
      $set: {
        subtotal: toPesewas("$subtotal"),
        discount: toPesewas("$discount"),
        total: toPesewas("$total"),
        amountPaid: toPesewas("$amountPaid"),
        changeDue: toPesewas("$changeDue"),
        items: mapItems("$items", ["unitPrice", "subtotal"]),
        moneyUnit: "pesewas",
      },
    },
  ],
  partorders: [
    {
      $set: {
        unitPriceGhs: toPesewas("$unitPriceGhs"),
        amountGhs: toPesewas("$amountGhs"),
        moneyUnit: "pesewas",
      },
    },
  ],
  repairorders: [
    {
      $set: {
        items: mapItems("$items", ["unitPriceGhs"]),
        moneyUnit: "pesewas",
      },
    },
  ],
  pospayments: [
    { $set: { amount: toPesewas("$amount"), moneyUnit: "pesewas" } },
  ],
  expenses: [
    { $set: { amount: toPesewas("$amount"), moneyUnit: "pesewas" } },
  ],
};

// Only run against a DB when invoked directly — importing this file (e.g. in a
// test) must not connect or read env.
if (require.main === module) {
  const mongoose = require("mongoose");
  const dotenv = require("dotenv");
  dotenv.config({ path: "./.env" });

  const mongoUrlRaw =
    process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!mongoUrlRaw) {
    console.error("MONGO_URL is not defined in environment variables");
    process.exit(1);
  }
  const dbPassword =
    process.env.DATABASE_PASSWORD || process.env.database_password;
  const db =
    mongoUrlRaw.includes("<PASSWORD>") && dbPassword
      ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
      : mongoUrlRaw;

  (async () => {
    await mongoose.connect(db, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("MongoDB connected\n");

    for (const [coll, pipeline] of Object.entries(PIPELINES)) {
      const target = mongoose.connection.db.collection(coll);
      const pending = await target.countDocuments({ moneyUnit: { $ne: "pesewas" } });
      const res = await target.updateMany({ moneyUnit: { $ne: "pesewas" } }, pipeline);
      console.log(
        `${coll}: ${pending} pending → ${res.modifiedCount} converted` +
          (pending === 0 ? " (already migrated — no-op)" : ""),
      );
    }

    await mongoose.connection.close();
    console.log("\nMigration complete. Re-running is a safe no-op.");
    process.exit(0);
  })().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}

module.exports = { PIPELINES, toPesewas, mapItems };
