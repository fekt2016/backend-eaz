/**
 * Migration: move `User.shippingAddresses` into the Address collection.
 *
 *   node scripts/migrateAddressesToCollection.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/migrateAddressesToCollection.js --apply    # actually writes
 *
 * Why: a saved address is a record with its own lifecycle — created, corrected,
 * promoted to default, retired — and as an embedded array it had no update
 * operation at all. Correcting a typo meant deleting the address and retyping
 * it, from checkout, the only screen that could reach the list.
 *
 * ── Why this is safe to run ──────────────────────────────────────────────
 * The embedded array is NOT cleared. Every address is COPIED into the new
 * collection with its `_id` preserved, so the two agree and rollback is
 * "point the routes back at the array" rather than a restore. Nothing in
 * financial history refers to either: orders snapshot the delivery address as
 * text (`Order.customer.address`), so no past order changes here.
 *
 * Idempotent: an address whose `_id` already exists in `addresses` is skipped,
 * so a second run reports nothing to do and never double-writes.
 *
 * Duplicates are collapsed. Checkout re-saved the address on every order and
 * the array had no notion of sameness, so the same street appears several
 * times per customer; one row per distinct location is copied, keeping the one
 * flagged default where there is one.
 *
 * Exactly one address per user ends up `isDefault`. The array allowed zero
 * (nothing ever set it after the first save) or several (deletes promoted a
 * survivor without clearing the others); the newest is promoted where the
 * user's set is ambiguous, which is what checkout did by accident anyway.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("../models/User");
const Address = require("../models/Address");
const { logDbTarget } = require("../utils/dbTarget");

dotenv.config({ path: "./.env" });

/**
 * The four fields that decide whether two addresses are the same place, matching
 * controllers/addressController.js. Label is not part of it — renaming an
 * address does not make it a different house.
 */
const locationKey = (a) =>
  [a.street, a.neighborhood, a.city, a.region]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");

/** Shape one embedded address as the Address it becomes. `_id` is preserved. */
function embeddedAsAddress(userId, addr) {
  return {
    _id: addr._id,
    user: userId,
    label: addr.label || "",
    street: addr.street || "",
    neighborhood: addr.neighborhood || "",
    neighborhoodId: addr.neighborhoodId || null,
    city: addr.city || "",
    region: addr.region || "",
    phone: "",
    isDefault: Boolean(addr.isDefault),
    createdAt: addr.createdAt || new Date(),
    updatedAt: addr.createdAt || new Date(),
  };
}

/**
 * Copy every embedded address into the Address collection. Exported so the
 * tests can drive it against mongodb-memory-server without going near a real
 * connection string. Returns { users, scanned, migrated, skipped, failed, problems }.
 */
async function migrateAddresses({ apply = false, log = console.log } = {}) {
  const users = await User.find({ "shippingAddresses.0": { $exists: true } })
    .select("_id email shippingAddresses")
    .lean();

  if (!users.length) {
    log("✅ No user has a saved address to migrate.");
    return { users: 0, scanned: 0, migrated: 0, skipped: 0, failed: 0, problems: [] };
  }

  const planned = [];
  let scanned = 0;
  let skipped = 0;

  for (const user of users) {
    const addrs = (user.shippingAddresses || []).filter(Boolean);
    scanned += addrs.length;

    const ids = addrs.map((a) => a._id).filter(Boolean);
    const existing = await Address.find({ _id: { $in: ids } }).select("_id").lean();
    const already = new Set(existing.map((a) => String(a._id)));

    const pending = addrs.filter((a) => a._id && !already.has(String(a._id)));
    skipped += addrs.length - pending.length;
    if (!pending.length) continue;

    // Checkout re-saved the delivery address on every order, and the array had
    // no notion of "the same address", so a customer who ordered three times
    // has the same street three times. Copying that forward would put three
    // identical rows in the new address book. Keep one per distinct location —
    // the default if one of them carries the flag, else the earliest.
    const byLocation = new Map();
    for (const a of pending) {
      const key = [a.street, a.neighborhood, a.city, a.region]
        .map((p) => String(p || "").trim().toLowerCase())
        .join("|");
      const kept = byLocation.get(key);
      if (!kept) byLocation.set(key, a);
      else if (a.isDefault && !kept.isDefault) byLocation.set(key, a);
    }
    let deduped = [...byLocation.values()];
    if (deduped.length < pending.length) {
      log(`   (${user.email || user._id}: ${pending.length - deduped.length} duplicate(s) collapsed)`);
    }

    // Skipping by `_id` alone is not enough once duplicates are collapsed: the
    // siblings of an already-copied address keep their own ids, so a second run
    // would look at them, dedupe them down to one, and copy that one — adding a
    // duplicate of the row the first run created. Skip by location as well.
    const settled = new Set((await Address.find({ user: user._id }).lean()).map(locationKey));
    const fresh = deduped.filter((a) => !settled.has(locationKey(a)));
    skipped += deduped.length - fresh.length;
    deduped = fresh;
    if (!deduped.length) continue;

    const docs = deduped.map((a) => embeddedAsAddress(user._id, a));

    // One default per user, decided here rather than left to the data: the
    // array allowed none and allowed several.
    const defaults = docs.filter((d) => d.isDefault);
    if (defaults.length !== 1) {
      for (const d of docs) d.isDefault = false;
      docs[0].isDefault = !(await Address.exists({ user: user._id, isDefault: true }));
    }

    planned.push({ user, docs });
  }

  const total = planned.reduce((n, p) => n + p.docs.length, 0);
  log(`Users with saved addresses: ${users.length} · ${scanned} address(es) · ${skipped} already migrated · ${total} to copy.`);

  // Pre-flight: every document goes through the Address schema before anything
  // is written, so a failure shows up here rather than partway through a batch.
  const problems = [];
  for (const { user, docs } of planned) {
    for (const doc of docs) {
      const err = new Address(doc).validateSync();
      if (err) {
        problems.push({
          id: String(doc._id),
          who: user.email || String(user._id),
          reasons: Object.values(err.errors).map((e) => e.message),
        });
      }
    }
  }

  for (const { user, docs } of planned) {
    for (const doc of docs) {
      const line = [doc.street, doc.neighborhood, doc.city, doc.region].filter(Boolean).join(", ");
      log(`   • ${user.email || user._id}: ${line || "(empty)"}${doc.isDefault ? " · default" : ""}`);
    }
  }

  if (problems.length) {
    log(`\n❌ Pre-flight: ${problems.length} address(es) would fail:`);
    for (const p of problems) log(`   ✗ ${p.who} (${p.id}): ${p.reasons.join("; ")}`);
  } else if (total) {
    log(`\n✅ Pre-flight: all ${total} address(es) pass the Address schema.`);
  }

  if (!apply) {
    log(
      problems.length
        ? "\nDry run — nothing written. Fix the pre-flight failures above before --apply."
        : "\nDry run — nothing written. Re-run with --apply.",
    );
    return { users: users.length, scanned, migrated: 0, skipped, failed: 0, problems };
  }

  // All-or-nothing on a known-bad plan, so a batch is never half-applied for a
  // problem that was already visible.
  if (problems.length) {
    log(`\nRefusing to write: ${problems.length} address(es) would fail. Nothing was written.`);
    return { users: users.length, scanned, migrated: 0, skipped, failed: problems.length, problems };
  }

  let migrated = 0;
  let failed = 0;
  for (const { user, docs } of planned) {
    for (const doc of docs) {
      try {
        await Address.create(doc);
        migrated += 1;
      } catch (err) {
        failed += 1;
        log(`   ✗ ${user.email || user._id} (${doc._id}): ${err.message}`);
      }
    }
    await Address.ensureDefault(user._id);
  }

  return { users: users.length, scanned, migrated, skipped, failed, problems: [] };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const rawUri = process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!rawUri) {
    console.error("MONGO_URL (or mongo_url) is not defined in environment variables — refusing to run.");
    process.exit(1);
  }
  const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
  const uri =
    rawUri.includes("<PASSWORD>") && dbPassword ? rawUri.replace("<PASSWORD>", dbPassword) : rawUri;

  await mongoose.connect(uri);
  logDbTarget();
  console.log(apply ? "MODE: APPLY — writes are real.\n" : "MODE: DRY RUN — nothing will be written.\n");

  const result = await migrateAddresses({ apply });

  console.log(
    `\nScanned ${result.scanned} address(es) across ${result.users} user(s) · ` +
      `migrated ${result.migrated} · already present ${result.skipped} · failed ${result.failed}`,
  );
  console.log("\nUser.shippingAddresses was not modified — the copies stand alongside it.");

  await mongoose.disconnect();
  if (result.problems && result.problems.length) process.exitCode = 1;
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { migrateAddresses, embeddedAsAddress };
