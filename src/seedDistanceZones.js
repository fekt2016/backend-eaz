/**
 * seedDistanceZones.js — the six distance-banded zones (A–F).
 *
 * CREATE-ONLY BY DEFAULT. Rates are admin-editable at runtime, so a seed
 * script that blindly re-asserts them will one day overwrite live pricing with
 * whatever numbers were current when the file was written. Existing zones are
 * left alone and reported; `--force-update` applies changes, and always prints
 * the diff first.
 *
 *   node src/seedDistanceZones.js              # create missing, skip existing
 *   node src/seedDistanceZones.js --dry-run    # print the plan, write nothing
 *   node src/seedDistanceZones.js --force-update
 *
 * Money is integer pesewas: GH₵15.00 === 1500.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const ShippingZone = require("../models/ShippingZone");
const { checkCoverage } = require("../services/shipping/zoneClassification");

// Speed tiers, keyed by code so nothing can be silently swapped.
// standard ×1.0 · next-day ×1.2 · express ×1.5
//
// Each tier states its OWN delivery promise. They used to share the zone's
// single ETA, which made "Next Day" advertise 1-2 days (2-3 in the outer
// zones) — slower than its name and 20% dearer than Standard for no stated
// benefit.
//
//   standard 1-3 days · next_day within 24 hours · express same day, hours
//
// Express carries "0" (today): it is the same-day service now, which is why
// the separate same_day tier is no longer offered.
const SPEED_TIERS = () => [
  { code: "standard", label: "Standard",  multiplier: 1.0, estimatedDays: "1-3" },
  { code: "next_day", label: "Next Day",  multiplier: 1.2, estimatedDays: "1" },
  // "0" days — dispatch starts now, which is what Express means here.
  { code: "express",  label: "Express",   multiplier: 1.5, estimatedDays: "0" },
];
// T117 (owner, 2026-08-29): three options, and only three — Standard, Next Day,
// Express. The dormant `same_day` tier is gone rather than left switched off:
// it duplicated Express's promise at the *cheaper* next-day multiplier, so
// flipping ShippingSettings.sameDayAvailable would have put two "today" options
// side by side with the faster-sounding one costing less.

// Bands are half-open [minKm, maxKm) and contiguous: 0–5–10–15–25–40–100.
const ZONES = [
  { zoneKey: "A", minKm: 0,  maxKm: 5,   baseRate: 1500, perKgRate: 200, eta: "1-2", days: 1 },
  { zoneKey: "B", minKm: 5,  maxKm: 10,  baseRate: 3000, perKgRate: 250, eta: "1-2", days: 1 },
  { zoneKey: "C", minKm: 10, maxKm: 15,  baseRate: 4000, perKgRate: 300, eta: "1-2", days: 1 },
  { zoneKey: "D", minKm: 15, maxKm: 25,  baseRate: 5000, perKgRate: 350, eta: "2-3", days: 2 },
  { zoneKey: "E", minKm: 25, maxKm: 40,  baseRate: 6500, perKgRate: 400, eta: "2-3", days: 2 },
  { zoneKey: "F", minKm: 40, maxKm: 100, baseRate: 8000, perKgRate: 500, eta: "2-3", days: 2 },
];

const FRAGILE_SURCHARGE = 500; // GH₵5.00

function buildDoc(z) {
  return {
    name: `Zone ${z.zoneKey}`,
    code: `ZONE-${z.zoneKey}`,
    zoneKey: z.zoneKey,
    city: "Accra",
    region: "Greater Accra",
    inAccraCore: true,
    pickupMode: "none",
    neighborhoods: [],
    distanceMinKm: z.minKm,
    distanceMaxKm: z.maxKm,
    baseRate: z.baseRate,
    perKgRate: z.perKgRate,
    fragileSurcharge: FRAGILE_SURCHARGE,
    speedTiers: SPEED_TIERS(),
    estimatedDays: z.days,
    estimatedDaysLabel: z.eta,
    isDefault: false,
    isActive: true,
  };
}

const ghs = (p) => `GH₵${(p / 100).toFixed(2)}`;

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force-update");

  const raw = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!raw) throw new Error("MONGO_URL is not set");
  const uri = process.env.DATABASE_PASSWORD
    ? raw.replace("<PASSWORD>", process.env.DATABASE_PASSWORD)
    : raw;

  await mongoose.connect(uri);
  console.log(`✅ connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (dryRun) console.log("🔎 DRY RUN — nothing will be written\n");

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const z of ZONES) {
    const doc = buildDoc(z);
    const existing = await ShippingZone.findOne({ zoneKey: z.zoneKey });

    if (!existing) {
      console.log(
        `+ Zone ${z.zoneKey}  ${z.minKm}–${z.maxKm} km  base ${ghs(z.baseRate)}  per-kg ${ghs(z.perKgRate)}  (create)`,
      );
      if (!dryRun) await ShippingZone.create(doc);
      created += 1;
      continue;
    }

    // Existing zone: report any drift, but do not touch it without --force-update.
    const diffs = [];
    for (const field of ["baseRate", "perKgRate", "fragileSurcharge", "distanceMinKm", "distanceMaxKm"]) {
      if (existing[field] !== doc[field]) {
        diffs.push(`${field}: ${existing[field]} → ${doc[field]}`);
      }
    }
    if (!diffs.length) {
      console.log(`= Zone ${z.zoneKey}  unchanged`);
      skipped += 1;
    } else if (force) {
      console.log(`~ Zone ${z.zoneKey}  UPDATING: ${diffs.join(", ")}`);
      if (!dryRun) {
        Object.assign(existing, doc);
        await existing.save();
      }
      updated += 1;
    } else {
      console.log(`! Zone ${z.zoneKey}  live values differ, left alone: ${diffs.join(", ")}`);
      console.log("    (re-run with --force-update to apply the seed values)");
      skipped += 1;
    }
  }

  // A gap or overlap here means some distance belongs to no zone and throws at
  // checkout. Surface it now, not on a customer's order.
  const active = await ShippingZone.getActiveZones();
  const problems = checkCoverage(active);
  console.log(
    problems.length
      ? `\n❌ zone coverage problems:\n   ${problems.join("\n   ")}`
      : `\n✅ ${active.length} zones cover 0–${active[active.length - 1]?.distanceMaxKm} km with no gaps or overlaps`,
  );

  console.log(`\nDone — created ${created}, updated ${updated}, skipped ${skipped}.`);
  await mongoose.disconnect();
  process.exit(problems.length ? 1 : 0);
}

run().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
