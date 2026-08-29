/**
 * Give each courier speed tier its own delivery promise.
 *
 *   node scripts/updateSpeedTierEtas.js            # DRY RUN — prints the diff, writes nothing
 *   node scripts/updateSpeedTierEtas.js --apply    # actually writes
 *
 * Why: the A–F zones were seeded with `SPEED_TIERS(z.eta, z.eta)` — standard,
 * next_day and express all sharing the zone's single ETA. So "Courier — Next
 * Day" advertised "1-2 days" (2-3 in the outer zones): slower than its own
 * name, and 20% dearer than Standard for no stated benefit.
 *
 *   standard  → "1-3"   (1-3 days, everywhere)
 *   next_day  → "1"     (within 24 hours — the storefront renders that wording)
 *   express   → "0"     (same day, within a few hours)
 *
 * same_day is NOT touched: it is not offered at all while
 * ShippingSettings.sameDayAvailable is off, and express is the same-day
 * service now.
 *
 * Only these `estimatedDays` values change. Multipliers, base rates, per-kg
 * rates and the zone bands are untouched, so nothing here moves a price.
 * Idempotent: a zone already carrying these values is reported and skipped.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const ShippingZone = require("../models/ShippingZone");
const { logDbTarget } = require("../utils/dbTarget");

dotenv.config({ path: "./.env" });

// The promise each tier makes, by code. A tier absent from this map is left
// exactly as it is.
const TIER_ETAS = {
  standard: "1-3",
  next_day: "1",
  // "0" days out = today. The storefront renders express with its own wording
  // ("Same day — within a few hours"), so this figure is never shown raw.
  express: "0",
};

/**
 * Rewrite the ETAs on every zone that defines these tiers. Exported so the
 * tests can drive it against mongodb-memory-server.
 * Returns { zones, updated, skipped, changes }.
 */
async function updateSpeedTierEtas({ apply = false, log = console.log } = {}) {
  const zones = await ShippingZone.find({ "speedTiers.0": { $exists: true } }).sort({ zoneKey: 1 });

  if (!zones.length) {
    log("✅ No zone defines any speed tier.");
    return { zones: 0, updated: 0, skipped: 0, changes: [] };
  }

  const changes = [];
  let skipped = 0;

  for (const zone of zones) {
    const zoneChanges = [];
    for (const tier of zone.speedTiers) {
      const wanted = TIER_ETAS[tier.code];
      if (wanted === undefined) continue;
      if (String(tier.estimatedDays) === wanted) continue;
      zoneChanges.push({ code: tier.code, from: tier.estimatedDays, to: wanted });
    }

    if (!zoneChanges.length) {
      skipped += 1;
      continue;
    }
    changes.push({ zone, zoneChanges });
  }

  log(`Zones with speed tiers: ${zones.length} · ${changes.length} to update · ${skipped} already correct.`);
  for (const { zone, zoneChanges } of changes) {
    for (const c of zoneChanges) {
      log(`   • zone ${zone.zoneKey || zone.code}: ${c.code} "${c.from}" → "${c.to}"`);
    }
  }

  if (!apply) {
    log("\nDry run — nothing written. Re-run with --apply.");
    return { zones: zones.length, updated: 0, skipped, changes };
  }

  let updated = 0;
  for (const { zone, zoneChanges } of changes) {
    for (const c of zoneChanges) {
      const tier = zone.speedTiers.find((t) => t.code === c.code);
      tier.estimatedDays = c.to;
    }
    zone.markModified("speedTiers");
    await zone.save();
    updated += 1;
  }

  return { zones: zones.length, updated, skipped, changes };
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

  const result = await updateSpeedTierEtas({ apply });

  console.log(`\nZones ${result.zones} · updated ${result.updated} · already correct ${result.skipped}`);
  console.log("\nNo rate, multiplier or zone band was modified — only the stated ETAs.");
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { updateSpeedTierEtas, TIER_ETAS };
