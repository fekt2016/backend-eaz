/**
 * seedNeighborhoods.js — the 116 serviceable neighbourhoods.
 *
 * Idempotent: upserts on { city, name }, and NEVER touches a document with
 * `zoneOverride: true` — those carry a deliberate business decision that a
 * re-run must not undo.
 *
 *   node src/seedNeighborhoods.js
 *   node src/seedNeighborhoods.js --dry-run
 *
 * DISTANCES: real driving distance needs the Google Maps billing account that
 * is currently disabled, so each row is seeded with a straight-line (haversine)
 * distance from the warehouse scaled by a road factor, stored with
 * `distanceSource: 'estimated'`. It is never presented as measured. Run the
 * admin recalculate endpoint once billing is live to replace them.
 *
 * The curated `assignedZone` in data/neighborhoods.json is authoritative and is
 * NOT overwritten by the estimate. Where the estimate disagrees, the row is
 * marked `zoneOverride: true` so a later automated recalculation cannot quietly
 * downgrade it to a cheaper zone — every one of those disagreements runs in the
 * expensive direction, which is exactly the direction you never want an
 * automated job to "fix" on its own.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Neighborhood = require("../models/Neighborhood");
const { WAREHOUSE_LOCATION } = require("../config/warehouseConfig");

// Accra road distance runs meaningfully longer than the straight line. 1.3 is
// the conservative low end used only to FLAG disagreements, never to overwrite
// a curated zone.
const ROAD_FACTOR = 1.3;
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");

  const file = path.join(__dirname, "..", "data", "neighborhoods.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Loaded ${rows.length} neighbourhoods from data/neighborhoods.json`);

  const raw = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!raw) throw new Error("MONGO_URL is not set");
  const uri = process.env.DATABASE_PASSWORD
    ? raw.replace("<PASSWORD>", process.env.DATABASE_PASSWORD)
    : raw;

  await mongoose.connect(uri);
  console.log(`✅ connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (dryRun) console.log("🔎 DRY RUN — nothing will be written\n");

  // Classify against the seeded bands rather than a hardcoded ladder, so this
  // script cannot drift from the zones the app actually prices with.
  const ShippingZone = require("../models/ShippingZone");
  const zones = await ShippingZone.getActiveZones();
  if (!zones.length) {
    throw new Error("No distance zones found — run `npm run seed:zones` first.");
  }
  const estimateZone = (km) => {
    const z = zones.find((zz) => km >= zz.distanceMinKm && km < zz.distanceMaxKm);
    return z ? z.zoneKey : null;
  };

  let created = 0;
  let updated = 0;
  let preserved = 0;
  const disagreements = [];

  for (const row of rows) {
    const straightKm = haversineKm(
      WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng, row.lat, row.lng,
    );
    const distanceKm = Math.round(straightKm * ROAD_FACTOR * 100) / 100;
    const estimated = estimateZone(distanceKm);
    const disagrees = estimated !== null && estimated !== row.assignedZone;
    if (disagrees) {
      disagreements.push({
        name: row.name, curated: row.assignedZone, estimated,
        straightKm: Math.round(straightKm * 10) / 10, roadKm: distanceKm,
      });
    }

    const existing = await Neighborhood.findOne({ city: row.city, name: row.name });

    if (existing && existing.zoneOverride) {
      preserved += 1;
      continue;
    }

    const doc = {
      name: row.name,
      city: row.city,
      municipality: row.municipality,
      lat: row.lat,
      lng: row.lng,
      distanceKm,
      distanceSource: "estimated",
      distanceMeasuredAt: null,
      assignedZone: row.assignedZone,   // curated value wins over the estimate
      zoneOverride: disagrees,          // protect it from an automated downgrade
      isActive: true,
    };

    if (!dryRun) {
      await Neighborhood.findOneAndUpdate(
        { city: row.city, name: row.name },
        { $set: doc },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    if (existing) updated += 1; else created += 1;
  }

  // ── Keep models/Location.js in step ────────────────────────────────────
  // The checkout cascade (region → city → neighbourhood) reads Location, while
  // pricing reads Neighborhood. Seeding one without the other leaves the
  // storefront picker empty even though every zone is configured correctly, so
  // derive the Location rows from the same source of truth.
  const Location = require("../models/Location");
  const byCity = rows.reduce((acc, r) => {
    (acc[r.city] = acc[r.city] || []).push(r.name.toLowerCase());
    return acc;
  }, {});

  for (const [city, hoods] of Object.entries(byCity)) {
    if (!dryRun) {
      await Location.findOneAndUpdate(
        { region: "Greater Accra", city },
        {
          $set: {
            region: "Greater Accra",
            city,
            neighborhoods: [...new Set(hoods)].sort(),
            inAccraCore: true,   // these are all delivery, never bus-station pickup
            isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    console.log(`Location: Greater Accra / ${city} — ${new Set(hoods).size} neighbourhoods`);
  }

  const byZone = rows.reduce((acc, r) => {
    acc[r.assignedZone] = (acc[r.assignedZone] || 0) + 1;
    return acc;
  }, {});
  console.log("\nZone distribution:", Object.entries(byZone).sort().map(([k, v]) => `${k}:${v}`).join("  "));

  if (disagreements.length) {
    console.log(
      `\n⚠️  ${disagreements.length} rows where the curated zone is dearer than a ${ROAD_FACTOR}× estimate.`,
    );
    console.log("   Curated value kept and zoneOverride set. Do NOT bulk-'fix' these —");
    console.log("   every disagreement runs the same direction, which points at the road");
    console.log("   factor being too low rather than at bad data. Measure for real first.");
    disagreements.slice(0, 8).forEach((d) =>
      console.log(`   ${d.name}: curated ${d.curated}, estimate ${d.estimated} (${d.roadKm} km)`),
    );
    if (disagreements.length > 8) console.log(`   … and ${disagreements.length - 8} more`);
  }

  console.log(`\nDone — created ${created}, updated ${updated}, preserved (zoneOverride) ${preserved}.`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
