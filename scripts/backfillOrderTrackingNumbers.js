/**
 * One-off migration: give every shop order a `trackingNumber`.
 *
 *   node scripts/backfillOrderTrackingNumbers.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/backfillOrderTrackingNumbers.js --apply    # actually writes the numbers
 *
 * Why this is needed: `createOrder` mints a tracking number for every order, but
 * it did not always — orders created before that line landed have no
 * `trackingNumber` at all. Every place the storefront and dashboard render a
 * tracking link is guarded by `order.trackingNumber && …`, so for those orders no
 * link appears anywhere: the customer cannot follow their delivery, and staff have
 * nothing to open in order to post a tracking update. Confirmed against the live
 * Atlas database on 2026-08-25: 7 of 8 orders were missing it, including one
 * already marked `shipped`.
 *
 * Idempotent: only ever touches orders where the field is absent/null/empty, so a
 * second run reports nothing to do. Never regenerates a number an order already
 * has — those are printed on receipts and shared with customers.
 *
 * `Order.trackingNumber` is a unique sparse index and the generator's timestamp
 * half is identical within a millisecond, so each write is retried on E11000 with
 * a freshly minted number rather than aborting the run.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Order = require("../models/Order");
const { generateTrackingNumber } = require("../utils/trackingNumber");
const { logDbTarget } = require("../utils/dbTarget");

dotenv.config({ path: "./.env" });

// Orders the storefront can never build a tracking link for.
const MISSING = {
  $or: [
    { trackingNumber: { $exists: false } },
    { trackingNumber: null },
    { trackingNumber: "" },
  ],
};

const MAX_ATTEMPTS = 5;

/**
 * Fill in the missing numbers. Exported so the tests can drive it against
 * mongodb-memory-server without going near a real connection string.
 * Returns { scanned, updated, failed }.
 */
async function backfillOrderTrackingNumbers({ apply = false, log = console.log } = {}) {
  const pending = await Order.find(MISSING)
    .select("orderNumber status createdAt")
    .sort({ createdAt: 1 })
    .lean();

  if (!pending.length) {
    log("✅ Every order already has a tracking number — nothing to backfill.");
    return { scanned: 0, updated: 0, failed: 0 };
  }

  log(`Found ${pending.length} order(s) with no tracking number:`);
  for (const o of pending) {
    const when = o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "unknown date";
    log(`   • ${o.orderNumber} (${o.status}, ${when})`);
  }

  if (!apply) {
    log(`\nWould assign a tracking number to ${pending.length} order(s).`);
    log("Dry run — nothing written. Re-run with --apply.");
    return { scanned: pending.length, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;

  for (const o of pending) {
    let assigned = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !assigned; attempt++) {
      const candidate = generateTrackingNumber();
      try {
        // Re-assert the "still missing" condition in the filter: if a concurrent
        // write gave this order a number since the scan above, leave it alone.
        const res = await Order.updateOne(
          { _id: o._id, ...MISSING },
          { $set: { trackingNumber: candidate } },
        );
        if (res.matchedCount === 0) {
          log(`   ↷ ${o.orderNumber} — already had one by the time we wrote; skipped.`);
          assigned = "skipped";
          break;
        }
        assigned = candidate;
      } catch (err) {
        // The unique index rejected it. Two numbers minted in the same
        // millisecond differ only in 3 random bytes, so just mint another.
        if (err?.code !== 11000) throw err;
        if (attempt === MAX_ATTEMPTS) {
          failed++;
          console.error(`   ✗ ${o.orderNumber} — ${MAX_ATTEMPTS} collisions in a row, giving up.`);
        }
      }
    }

    if (assigned && assigned !== "skipped") {
      updated++;
      log(`   ✓ ${o.orderNumber} → ${assigned}`);
    }
  }

  log(`\n✅ Assigned ${updated} tracking number(s).${failed ? ` ${failed} failed.` : ""}`);
  return { scanned: pending.length, updated, failed };
}

async function run() {
  const APPLY = process.argv.includes("--apply");

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

  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    // A migration should be the sole authority on writes it makes; leaving
    // autoIndex on means requiring a model kicks off background index builds
    // that race the script. Same reasoning as migrateUserEmailIndex.js.
    autoIndex: false,
  });

  // Say WHICH database out loud — dotenv falls back to .env, and in this repo
  // that points at the live Atlas cluster.
  console.log(`MongoDB connected — ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes)"}`);
  logDbTarget();
  console.log();

  const result = await backfillOrderTrackingNumbers({ apply: APPLY });

  await mongoose.connection.close();
  process.exit(result.failed ? 1 : 0);
}

// Only self-run when invoked directly, so requiring it from a test is inert.
if (require.main === module) {
  run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}

module.exports = { backfillOrderTrackingNumbers };
