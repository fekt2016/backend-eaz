/**
 * Read-only pre-flight check for the unique phone index on User (task T1).
 *
 *   npm run check:duplicate-phones
 *
 * A unique (partial) index on User.phone requires that no two accounts share the
 * same non-empty phone. But two accounts can also carry the SAME number in
 * DIFFERENT formats (e.g. "0201234567" vs "233201234567") — those are distinct
 * strings, so the raw index would still build, yet login-by-phone stays
 * ambiguous. So this check groups by the CANONICAL form produced by
 * `sanitizePhone` (exactly what the Phase-2 migration will store), catching both
 * literal duplicates and cross-format duplicates.
 *
 * It only reports — it changes nothing. It classifies every account with a phone into:
 *   1. non-canonical   — phone will be rewritten by the migration (safe, no collision)
 *   2. uncanonicalizable — phone can't be normalized; migration will blank it (safe)
 *   3. duplicate clusters — >1 account resolves to the same canonical phone
 *      (BLOCKS a clean unique index / causes login ambiguity — must be resolved)
 *
 * Exit code: 0 when the users collection is already fully canonical and unique
 * (safe to build the index directly); 1 when the Phase-2 migration still has work
 * to do. Mirrors scripts/checkDuplicateSkus.js.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("../models/User");
const { sanitizePhone } = require("../utils/sanitize");
const { logDbTarget } = require("../utils/dbTarget");

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

// A phone is "canonical" when sanitizePhone leaves it unchanged AND it is the
// 10-digit local form (0XXXXXXXXX). Anything else is either normalizable or,
// if sanitizePhone can't produce that shape, uncanonicalizable.
function classify(phone) {
  const canon = sanitizePhone(phone);
  const valid = typeof canon === "string" && /^0\d{9}$/.test(canon);
  if (!valid) return { kind: "uncanonicalizable", canon: null };
  if (canon === phone) return { kind: "canonical", canon };
  return { kind: "non-canonical", canon };
}

async function run() {
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");
  logDbTarget();
  console.log();

  // Only accounts with a non-empty string phone are relevant. Absent/"" phones
  // never collide under the partial index.
  const users = await User.find({ phone: { $type: "string", $gt: "" } })
    .select("_id name email role phone createdAt")
    .sort({ createdAt: 1 })
    .lean();

  console.log(`Scanning ${users.length} account(s) with a phone set…\n`);

  const nonCanonical = [];
  const uncanonicalizable = [];
  const byCanon = new Map(); // canonical phone → [users], oldest first

  for (const u of users) {
    const { kind, canon } = classify(u.phone);
    if (kind === "uncanonicalizable") {
      uncanonicalizable.push(u);
      continue;
    }
    if (kind === "non-canonical") nonCanonical.push({ ...u, _canon: canon });
    const list = byCanon.get(canon) || [];
    list.push(u);
    byCanon.set(canon, list);
  }

  const duplicateClusters = [...byCanon.entries()].filter(([, list]) => list.length > 1);

  // ── 1. Non-canonical (will be normalized) ──────────────────────────────────
  if (nonCanonical.length) {
    console.log(`ℹ️  ${nonCanonical.length} phone(s) will be NORMALIZED by the migration (safe):`);
    for (const u of nonCanonical) {
      console.log(`   • ${u.email} (${u.role}) : "${u.phone}" → "${u._canon}"`);
    }
    console.log();
  } else {
    console.log("✅ All phones are already in canonical 0XXXXXXXXX form.\n");
  }

  // ── 2. Uncanonicalizable (will be blanked) ─────────────────────────────────
  if (uncanonicalizable.length) {
    console.log(`⚠️  ${uncanonicalizable.length} phone(s) can't be normalized — migration will BLANK them (safe):`);
    for (const u of uncanonicalizable) {
      console.log(`   • ${u.email} (${u.role}) : "${u.phone}"`);
    }
    console.log();
  }

  // ── 3. Duplicate clusters (must be resolved — "keep oldest, clear others") ──
  if (duplicateClusters.length) {
    console.log(`❌ ${duplicateClusters.length} duplicate phone cluster(s) — BLOCKS the unique index:`);
    for (const [canon, list] of duplicateClusters) {
      const [keep, ...clear] = list; // list is oldest-first (sorted above)
      console.log(`   Phone ${canon} — used by ${list.length} accounts:`);
      console.log(`     KEEP  : ${keep.email} (${keep.role}, created ${new Date(keep.createdAt).toISOString()})`);
      for (const u of clear) {
        console.log(`     CLEAR : ${u.email} (${u.role}, created ${new Date(u.createdAt).toISOString()})`);
      }
    }
    console.log();
  } else {
    console.log("✅ No duplicate phone clusters — unique index can build cleanly.\n");
  }

  await mongoose.connection.close();

  // ── Summary ────────────────────────────────────────────────────────────────
  const pending =
    nonCanonical.length + uncanonicalizable.length + duplicateClusters.length;
  console.log("──────────────────────────────────────────────");
  console.log(`Accounts with a phone      : ${users.length}`);
  console.log(`To be normalized           : ${nonCanonical.length}`);
  console.log(`To be blanked              : ${uncanonicalizable.length}`);
  console.log(`Duplicate clusters         : ${duplicateClusters.length}`);
  console.log("──────────────────────────────────────────────");
  console.log(
    pending === 0
      ? "\nAll clear. The users collection is canonical and unique — safe to build the phone index directly."
      : "\nPhase-2 migration required before building the unique index. Re-run this check afterwards to confirm 'All clear'.",
  );
  process.exit(pending === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});
