/**
 * One-off migration (task T1): normalize User.phone and de-duplicate so a
 * unique phone index can be built.
 *
 *   node scripts/normalizeUserPhones.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/normalizeUserPhones.js --apply    # actually writes the changes
 *
 * For every account with a non-empty phone, processed OLDEST-FIRST:
 *   1. Normalize to the canonical 0XXXXXXXXX form (via sanitizePhone).
 *   2. If it can't be canonicalized → BLANK it ("").
 *   3. If its canonical form is already claimed by an OLDER account
 *      → BLANK this one ("keep oldest, clear others").
 *
 * Idempotent: a second run finds everything already canonical + unique and makes
 * no changes. Safe to re-run. Mirrors the connection/style of the other scripts.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("../models/User");
const { sanitizePhone } = require("../utils/sanitize");

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

function canonicalOf(phone) {
  const canon = sanitizePhone(phone);
  return typeof canon === "string" && /^0\d{9}$/.test(canon) ? canon : null;
}

async function run() {
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log(`MongoDB connected — ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes)"}\n`);

  // Oldest-first so the earliest account keeps a contested number.
  const users = await User.find({ phone: { $type: "string", $gt: "" } })
    .select("_id name email role phone createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const claimed = new Map(); // canonical phone → email of the older owner
  const plan = [];           // { id, email, from, to, reason }

  for (const u of users) {
    const canon = canonicalOf(u.phone);

    if (!canon) {
      plan.push({ id: u._id, email: u.email, from: u.phone, to: "", reason: "blank (uncanonicalizable)" });
      continue;
    }

    if (claimed.has(canon)) {
      plan.push({ id: u._id, email: u.email, from: u.phone, to: "", reason: `blank (duplicate of ${claimed.get(canon)})` });
      continue;
    }

    claimed.set(canon, u.email);
    if (canon !== u.phone) {
      plan.push({ id: u._id, email: u.email, from: u.phone, to: canon, reason: "normalize" });
    }
    // else: already canonical + unique → no change
  }

  // ── 1. Data: normalize / de-duplicate phones ───────────────────────────────
  if (!plan.length) {
    console.log("✅ Data: all phones already canonical and unique — no changes.");
  } else {
    console.log(`${plan.length} phone change(s) ${APPLY ? "to apply" : "planned"}:`);
    for (const p of plan) {
      console.log(`   • ${p.email} : "${p.from}" → "${p.to}"   [${p.reason}]`);
    }
    if (APPLY) {
      for (const p of plan) {
        await User.updateOne({ _id: p.id }, { $set: { phone: p.to } });
      }
      console.log(`✅ Applied ${plan.length} phone change(s).`);
    } else {
      console.log("Dry run — no data written. Re-run with --apply.");
    }
  }

  // ── 2. Index: replace the legacy sparse phone_1 with the unique-partial one ──
  // The old field-level `sparse:true` created a non-unique `phone_1`. Building
  // the new unique-partial index (also named phone_1) collides with it, so drop
  // the legacy one first. Safe now that data is canonical + unique.
  const indexes = await User.collection.indexes();
  const legacy  = indexes.find((i) => i.name === "phone_1" && !i.unique);
  const desired = indexes.find((i) => i.name === "phone_1" && i.unique);

  if (desired) {
    console.log("\n✅ Index: unique phone index already present — nothing to reconcile.");
  } else if (!APPLY) {
    console.log(
      `\nIndex: would ${legacy ? "DROP legacy sparse phone_1, then " : ""}BUILD the unique-partial phone index (run with --apply).`,
    );
  } else {
    if (legacy) {
      await User.collection.dropIndex("phone_1");
      console.log("\n🗑️  Dropped legacy sparse phone_1 index.");
    }
    await User.collection.createIndex(
      { phone: 1 },
      { unique: true, partialFilterExpression: { phone: { $type: "string", $gt: "" } } },
    );
    console.log("✅ Built unique-partial phone index.");
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
