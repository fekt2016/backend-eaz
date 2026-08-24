/**
 * One-off migration (task T17): replace the legacy unique `email_1` index with the
 * unique-PARTIAL one the T17 User model declares, so phone-only accounts are allowed.
 *
 *   node scripts/migrateUserEmailIndex.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/migrateUserEmailIndex.js --apply    # actually drops + rebuilds the index
 *
 * Why this is needed: before T17, `email` was `required` + field-level `unique`, which
 * built a plain unique `email_1`. T17 replaced that with
 * `{ unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } }`
 * so accounts with no email don't collide. Mongoose's autoIndex CANNOT swap one for the
 * other — same name + different options fails with IndexKeySpecsConflict, the old index
 * survives, and the SECOND phone-only registration then dies with
 * `E11000 ... index: email_1 dup key: { email: null }` (the first succeeds, so the
 * breakage looks intermittent). The test suite misses this because
 * mongodb-memory-server starts every file with a fresh, index-free collection.
 *
 * Idempotent: a second run finds the partial index already present and makes no changes.
 * Mirrors the connection/style of scripts/normalizeUserPhones.js, which does the same
 * job for `phone`.
 *
 * NOTE: between the drop and the rebuild, email uniqueness is briefly unenforced. The
 * window is milliseconds, but prefer a quiet moment / maintenance window on a busy DB.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("../models/User");
const { logDbTarget } = require("../utils/dbTarget");

dotenv.config({ path: "./.env" });

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

// The index the T17 model declares — keep in sync with models/User.js.
const DESIRED_KEY = { email: 1 };
const DESIRED_OPTS = {
  unique: true,
  partialFilterExpression: { email: { $type: "string", $gt: "" } },
};

const isDesired = (i) =>
  i.name === "email_1" && Boolean(i.unique) && Boolean(i.partialFilterExpression);

async function run() {
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    // MUST stay false. With mongoose's default autoIndex, requiring the User model
    // starts a background build of every schema index the moment we connect —
    // including the very `email_1` partial index this script manages. That build
    // races the explicit drop/create below and fails against the legacy index with
    // IndexKeySpecsConflict. A migration has to be the sole authority on indexes.
    autoIndex: false,
  });
  // Say WHICH database out loud. `dotenv` falls back to .env, so a bare run with no
  // MONGO_URL in the shell quietly targets whatever that file points at — in this repo,
  // the live Atlas cluster. An operator about to pass --apply should see the target.
  console.log(`MongoDB connected — ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes)"}`);
  logDbTarget();
  console.log();

  const coll = User.collection;

  // ── 1. Inspect the current index state ─────────────────────────────────────
  const indexes = await coll.indexes();
  const existing = indexes.find((i) => i.name === "email_1");

  if (existing && isDesired(existing)) {
    console.log("✅ Index: unique-partial email index already present — nothing to reconcile.");
    await mongoose.connection.close();
    process.exit(0);
  }

  console.log(
    existing
      ? `Found legacy index: email_1 (unique=${Boolean(existing.unique)}, partial=no) — must be replaced.`
      : "No email_1 index present — it will simply be built.",
  );

  // ── 2. Safety check: the new index is unique, so non-empty emails must not collide ──
  // The legacy index already enforced this, but verify rather than assume — the drop
  // below removes the only thing currently preventing duplicates, and a rebuild that
  // fails would leave the collection with NO email index at all.
  const dupes = await coll
    .aggregate([
      { $match: { email: { $type: "string", $gt: "" } } },
      { $group: { _id: "$email", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 25 },
    ])
    .toArray();

  if (dupes.length) {
    console.error(`\n❌ ABORTING — ${dupes.length} duplicated email value(s) found:`);
    for (const d of dupes) console.error(`   • "${d._id}" × ${d.n}`);
    console.error(
      "\nThe unique-partial index cannot build while these exist. De-duplicate first\n" +
        "(see scripts/mergeCustomerDuplicates.js), then re-run this migration.",
    );
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log("✅ Data: no duplicate non-empty emails — the unique index can build.");

  // Informational: these are the docs the partial filter deliberately excludes.
  const emptyEmail = await coll.countDocuments({
    $or: [{ email: null }, { email: "" }, { email: { $exists: false } }],
  });
  if (emptyEmail) {
    console.log(
      `ℹ️  ${emptyEmail} account(s) have no email — excluded from the partial index ` +
        "(this is exactly what T17 makes possible).",
    );
  }

  // ── 3. Drop the legacy index and build the partial one ─────────────────────
  if (!APPLY) {
    console.log(
      `\nWould ${existing ? "DROP legacy email_1, then " : ""}BUILD the unique-partial email index.`,
    );
    console.log("Dry run — nothing written. Re-run with --apply.");
    await mongoose.connection.close();
    process.exit(0);
  }

  if (existing) {
    await coll.dropIndex("email_1");
    console.log("\n🗑️  Dropped legacy email_1 index.");
  }

  // From here until the build lands there is no email index. If the build fails,
  // put the legacy unique index back rather than leaving the collection unprotected.
  try {
    await coll.createIndex(DESIRED_KEY, DESIRED_OPTS);
  } catch (err) {
    console.error(`\n❌ Building the partial index FAILED: ${err.message}`);
    if (existing) {
      try {
        await coll.createIndex({ email: 1 }, { unique: true, name: "email_1" });
        console.error("↩️  Rolled back — the legacy unique email_1 index has been restored.");
      } catch (rollbackErr) {
        console.error(
          `🚨 ROLLBACK ALSO FAILED: ${rollbackErr.message}\n` +
            "   The users collection currently has NO email index. Restore it manually:\n" +
            '   db.users.createIndex({ email: 1 }, { unique: true, name: "email_1" })',
        );
      }
    }
    throw err;
  }
  console.log("✅ Built unique-partial email index.");

  // ── 4. Verify the end state rather than trusting the calls above ───────────
  const after = (await coll.indexes()).find((i) => i.name === "email_1");
  if (!after || !isDesired(after)) {
    console.error("❌ Verification FAILED — email_1 is not the expected unique-partial index:", after);
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log("✅ Verified: email_1 is unique with a partialFilterExpression.");

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
