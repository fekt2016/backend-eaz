/**
 * seedRegions.js — Ghana's 16 regions, their capitals, a bus-station pickup
 * point for each, and the regional zone that prices those pickups.
 *
 * WHY ALL SIXTEEN: the checkout region field is a dropdown fed by
 * /locations/regions. Listing a region the customer cannot actually complete an
 * order in is worse than not listing it, so each row here comes with the three
 * things the fulfilment path needs — a Location (with inAccraCore false), a
 * bus_station PickupLocation to collect from, and a ShippingZone carrying the
 * regionalBaseFee / regionalPricePerKg the calculator prices with.
 *
 * Greater Accra is deliberately absent: it is the delivery core, seeded with
 * its 116 neighbourhoods by seedNeighborhoods.js.
 *
 * Idempotent — upserts on natural keys. Zone RATES are create-only, because
 * they are admin-editable at runtime and a seeder must never quietly overwrite
 * live pricing (run with --force-rates if you really mean to).
 *
 * Money is integer pesewas.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Location = require("../models/Location");
const PickupLocation = require("../models/PickupLocation");
const ShippingZone = require("../models/ShippingZone");
const ShippingSettings = require("../models/ShippingSettings");

// Rough road-distance bands from Accra. These are STARTING VALUES for an admin
// to tune in Business Settings — not measured figures.
const BANDS = {
  near: { regionalBaseFee: 5000,  regionalPricePerKg: 500,  estimatedDays: 2 },  // GH₵50 + GH₵5/kg
  mid:  { regionalBaseFee: 7000,  regionalPricePerKg: 700,  estimatedDays: 3 },  // GH₵70 + GH₵7/kg
  far:  { regionalBaseFee: 10000, regionalPricePerKg: 1000, estimatedDays: 4 },  // GH₵100 + GH₵10/kg
};

const REGIONS = [
  { region: "Ashanti",       city: "Kumasi",        code: "ASHANTI",       band: "mid",  station: "Kumasi Kejetia Terminal",     landmark: "Kejetia Market" },
  { region: "Central",       city: "Cape Coast",    code: "CENTRAL",       band: "near", station: "Cape Coast STC Station",      landmark: "Pedu Junction" },
  { region: "Eastern",       city: "Koforidua",     code: "EASTERN",       band: "near", station: "Koforidua Central Station",   landmark: "Koforidua Central Market" },
  { region: "Volta",         city: "Ho",            code: "VOLTA",         band: "near", station: "Ho Main Station",             landmark: "Ho Central Market" },
  { region: "Western",       city: "Takoradi",      code: "WESTERN",       band: "mid",  station: "Takoradi Market Circle STC",  landmark: "Market Circle" },
  { region: "Western North", city: "Sefwi Wiawso",  code: "WESTERN-NORTH", band: "mid",  station: "Sefwi Wiawso Station",        landmark: "Wiawso Township" },
  { region: "Bono",          city: "Sunyani",       code: "BONO",          band: "mid",  station: "Sunyani Main Station",        landmark: "Sunyani Central Market" },
  { region: "Bono East",     city: "Techiman",      code: "BONO-EAST",     band: "mid",  station: "Techiman Main Station",       landmark: "Techiman Market" },
  { region: "Ahafo",         city: "Goaso",         code: "AHAFO",         band: "mid",  station: "Goaso Main Station",          landmark: "Goaso Township" },
  { region: "Oti",           city: "Dambai",        code: "OTI",           band: "mid",  station: "Dambai Station",              landmark: "Dambai Ferry" },
  { region: "Northern",      city: "Tamale",        code: "NORTHERN",      band: "far",  station: "Tamale VIP Station",          landmark: "Tamale Central" },
  { region: "Savannah",      city: "Damongo",       code: "SAVANNAH",      band: "far",  station: "Damongo Station",             landmark: "Damongo Township" },
  { region: "North East",    city: "Nalerigu",      code: "NORTH-EAST",    band: "far",  station: "Nalerigu Station",            landmark: "Nalerigu Township" },
  { region: "Upper East",    city: "Bolgatanga",    code: "UPPER-EAST",    band: "far",  station: "Bolgatanga Main Station",     landmark: "Bolga Central Market" },
  { region: "Upper West",    city: "Wa",            code: "UPPER-WEST",    band: "far",  station: "Wa Main Station",             landmark: "Wa Central Market" },
];

const ghs = (p) => `GH₵${(p / 100).toFixed(2)}`;

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const forceRates = process.argv.includes("--force-rates");

  const raw = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!raw) throw new Error("MONGO_URL is not set");
  const uri = process.env.DATABASE_PASSWORD
    ? raw.replace("<PASSWORD>", process.env.DATABASE_PASSWORD)
    : raw;

  await mongoose.connect(uri);
  console.log(`✅ connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (dryRun) console.log("🔎 DRY RUN — nothing will be written\n");

  // The shop's own origin. Everything ships FROM here.
  const warehouse = await PickupLocation.findOne({ kind: "warehouse", isDefault: true });
  if (!warehouse) {
    console.log("+ warehouse: Nima (origin)");
    if (!dryRun) {
      await PickupLocation.create({
        name: "EazWorld Nima Warehouse", kind: "warehouse",
        region: "Greater Accra", city: "Accra",
        address: "Nima, Accra", landmark: "Nima Market",
        isDefault: true, isActive: true,
      });
    }
  } else {
    console.log("= warehouse: already present");
  }

  let locs = 0; let stations = 0; let zones = 0; let zonesSkipped = 0;

  for (const r of REGIONS) {
    const band = BANDS[r.band];

    // 1. Location — makes the region selectable, and marks it OUTSIDE the
    //    Accra core so the fulfilment gate routes it to pickup, not delivery.
    if (!dryRun) {
      await Location.findOneAndUpdate(
        { region: r.region, city: r.city },
        { $set: { region: r.region, city: r.city, neighborhoods: [], inAccraCore: false, isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    locs += 1;

    // 2. A station to collect from. Without one the region is selectable but
    //    the order cannot be completed.
    if (!dryRun) {
      await PickupLocation.findOneAndUpdate(
        { name: r.station, city: r.city },
        {
          $set: {
            name: r.station, kind: "bus_station", region: r.region, city: r.city,
            address: `${r.station}, ${r.city}`, landmark: r.landmark, isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    stations += 1;

    // 3. The zone that prices the pickup. Rates are create-only.
    const existing = await ShippingZone.findOne({ code: r.code });
    if (existing && !forceRates) {
      zonesSkipped += 1;
      continue;
    }
    const doc = {
      name: `${r.region} Region`, code: r.code, city: r.city, region: r.region,
      inAccraCore: false, pickupMode: "bus_station", neighborhoods: [],
      baseRate: band.regionalBaseFee, perKgRate: band.regionalPricePerKg,
      regionalBaseFee: band.regionalBaseFee, regionalPricePerKg: band.regionalPricePerKg,
      fragileSurcharge: 500, estimatedDays: band.estimatedDays,
      isDefault: true, isActive: true,
    };
    console.log(
      `+ ${r.region.padEnd(14)} ${r.city.padEnd(13)} ${ghs(band.regionalBaseFee)} + ${ghs(band.regionalPricePerKg)}/kg  → ${r.station}`,
    );
    if (!dryRun) {
      if (existing) { Object.assign(existing, doc); await existing.save(); }
      else await ShippingZone.create(doc);
    }
    zones += 1;
  }

  // Pickup is the ONLY fulfilment method outside Greater Accra, so seeding the
  // regions without switching it on would leave every one of them unusable.
  const settings = await ShippingSettings.getSettings();
  if (!settings.pickupAvailable) {
    console.log("\n+ pickupAvailable: false → true (required for regional orders)");
    if (!dryRun) { settings.pickupAvailable = true; await settings.save(); }
  } else {
    console.log("\n= pickupAvailable: already on");
  }

  console.log(
    `\nDone — ${locs} regions, ${stations} bus stations, ${zones} zones created/updated, ${zonesSkipped} zones left alone.`,
  );
  console.log("Rates above are STARTING VALUES — review them in Business Settings → Shipping.");
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => { console.error("Seed failed:", err.message); process.exit(1); });
