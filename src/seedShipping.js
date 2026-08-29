const mongoose = require("mongoose");
const dotenv = require("dotenv");
const ShippingZone = require("../models/ShippingZone");
const ShippingTier = require("../models/ShippingTier");
const ShippingSettings = require("../models/ShippingSettings");
const PickupLocation = require("../models/PickupLocation");
const { DEFAULT_TIER_CATEGORY } = require("../models/ShippingTier");
const { logDbTarget } = require("../utils/dbTarget");

// Resolved lazily inside seed() so this module can be imported by tests
// without touching .env or the process.
const resolveDbUrl = () => {
  const mongoUrlRaw =
    process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!mongoUrlRaw) {
    throw new Error("MONGO_URL is not defined in environment variables");
  }
  const dbPassword =
    process.env.DATABASE_PASSWORD || process.env.database_password;
  return mongoUrlRaw.includes("<PASSWORD>") && dbPassword
    ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
    : mongoUrlRaw;
};

// ── Warehouse: Nima, Greater Accra ────────────────────────────────────────────
// The shop's own origin. Stored as a `warehouse` PickupLocation so it shows up
// in admin and the storefront can reference it for the Greater-Accra local
// pickup option. Coordinates are Nima, Accra (the origin point used to estimate
// delivery distance to outlying zones).
const WAREHOUSE = {
  name: "EazWorld Warehouse — Nima",
  kind: "warehouse",
  region: "Greater Accra",
  city: "Accra",
  address: "Nima, Accra",
  landmark: "EazWorld HQ",
  isDefault: true,
  isActive: true,
};

// ── Bus-station pickup locations for major regional cities ───────────────────
// Each entry becomes a `bus_station` PickupLocation that customers outside
// Greater Accra can choose at checkout. Historical orders retain the chosen
// point via Order.pickupLocationId + pickupLocationName snapshot.
const BUS_STATIONS = [
  {
    name: "Kumasi STC Bus Station",
    kind: "bus_station",
    region: "Ashanti",
    city: "Kumasi",
    address: "Kejetia/Dr. Mensah Terminal, Kumasi",
    landmark: "Kejetia Market",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Cape Coast STC Bus Station",
    kind: "bus_station",
    region: "Central",
    city: "Cape Coast",
    address: "STC Intercity Terminal, Cape Coast",
    landmark: "Cape Coast Stadium",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Takoradi STC Bus Station",
    kind: "bus_station",
    region: "Western",
    city: "Sekondi-Takoradi",
    address: "STC Terminal, Sekondi-Takoradi",
    landmark: "Market Circle",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Tamale STC Bus Station",
    kind: "bus_station",
    region: "Northern",
    city: "Tamale",
    address: "STC Terminal, Tamale",
    landmark: "Tamale Central Market",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Ho STC Bus Station",
    kind: "bus_station",
    region: "Volta",
    city: "Ho",
    address: "STC Terminal, Ho",
    landmark: "Ho Main Market",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Koforidua STC Bus Station",
    kind: "bus_station",
    region: "Eastern",
    city: "Koforidua",
    address: "STC Terminal, Koforidua",
    landmark: "Jubilee Park",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Sunyani STC Bus Station",
    kind: "bus_station",
    region: "Bono",
    city: "Sunyani",
    address: "STC Terminal, Sunyani",
    landmark: "Sunyani Market",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Bolgatanga STC Bus Station",
    kind: "bus_station",
    region: "Upper East",
    city: "Bolgatanga",
    address: "STC Terminal, Bolgatanga",
    landmark: "Bolgatanga Market",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Wa STC Bus Station",
    kind: "bus_station",
    region: "Upper West",
    city: "Wa",
    address: "STC Terminal, Wa",
    landmark: "Wa Main Market",
    isDefault: true,
    isActive: true,
  },
  {
    name: "Techiman STC Bus Station",
    kind: "bus_station",
    region: "Bono East",
    city: "Techiman",
    address: "STC Terminal, Techiman",
    landmark: "Techiman Market",
    isDefault: true,
    isActive: true,
  },
];

// ── Seed data ────────────────────────────────────────────────────────────────
// All money figures are integer pesewas (GH₵1.00 === 100). Every rate here is
// a starting point admins edit through /api/v1/admin/shipping/* — nothing in
// the calculator reads hardcoded rates from code.
//
// E2 expansion fields (T78 → E2):
//   `inAccraCore`     — gates home delivery vs bus-station pickup in the
//                       calculator. `true` for Greater-Accra zones.
//   `region`          — the open region string. Replaces the closed city enum
//                       for the calculator's region-resolution path.
//   `distanceBaseFee` — base term of the Greater-Accra distance formula.
//   `pricePerKm`      — distance term (pesewas per km).
//   `pricePerKg`      — weight term (pesewas per kg).
//   `regionalBaseFee` — base term of the regional bus-station-pickup formula.
//   `regionalPricePerKg` — regional weight term (pesewas per kg).
//   `pickupMode`      — 'none' for delivery zones, 'bus_station' for regional.

// One active zone per supported city minimum, so a fresh environment can
// quote immediately. Neighbourhood lists are lowercased by the schema hook.
const ZONES = [
  // ── Greater Accra (in-core, home delivery) ─────────────────────────────
  {
    name: "Accra Central",
    code: "ACC-CENTRAL",
    city: "Accra",
    region: "Greater Accra",
    inAccraCore: true,
    pickupMode: "none",
    neighborhoods: [
      "abbosey okai", "abeka", "ablekuma north", "accra central", "achimota",
      "adabraka", "adenta", "adjiringanor", "agbogbloshie", "airport hills",
      "airport residential", "alajo", "arena", "ashaley botwe", "asylum down",
      "burma camp", "cantonments", "caprice", "chorkor", "circle",
      "dansoman", "dzorwulu", "east legon", "east legon hills", "fadama",
      "haatso", "kanda", "kaneshie", "kawukudi", "kokomlemle",
      "korle gonno", "kotobabi", "la", "labadi", "labone",
      "lakeside estate", "lapaz", "laterbiokoshie", "maamobi", "mamprobi",
      "mccarthy hill", "new town", "nima", "north kaneshie", "okaishie",
      "osu", "pig farm", "ridge", "roman ridge", "sowutuom",
      "spintex", "spintex east", "taifa", "teshie-nungua estates", "trade fair",
      "trasacco area", "tse addo", "tudu", "westlands",
    ],
    distanceMinKm: 0,
    distanceMaxKm: 25,
    // Legacy T78 fields — kept working for backward compat.
    baseRate: 1500, // GH₵15.00
    perKgRate: 300, // GH₵3.00 per billable kg
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    fragileSurcharge: 500, // GH₵5.00
    // E2 distance-based pricing — used when a zone has any of these set.
    // Accra Central: short hops from the Nima warehouse.
    distanceBaseFee: 1000, // GH₵10.00 base
    pricePerKm: 100,       // GH₵1.00 per km
    pricePerKg: 200,       // GH₵2.00 per kg
    estimatedDays: 1,
    isDefault: true,
    isActive: true,
  },
  {
    name: "Greater Accra Outskirts",
    code: "ACC-OUTSKIRTS",
    city: "Accra",
    region: "Greater Accra",
    inAccraCore: true,
    pickupMode: "none",
    neighborhoods: [
      "amasaman", "amrahia", "dodowa road", "dodowa township", "dome",
      "kasoa", "kasoa central", "kokrobite", "kwabenya", "odorkor",
      "oyarifa", "oyibi", "pokuase", "shai hills", "weija",
      "west trassacco",
    ],
    distanceMinKm: 15,
    distanceMaxKm: 60,
    baseRate: 2500, // GH₵25.00
    perKgRate: 400, // GH₵4.00 per billable kg
    sameDayMultiplier: 1.3,
    expressMultiplier: 1.5,
    fragileSurcharge: 500,
    distanceBaseFee: 1500, // GH₵15.00 base
    pricePerKm: 150,       // GH₵1.50 per km (longer hops)
    pricePerKg: 300,       // GH₵3.00 per kg
    estimatedDays: 2,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Tema Central",
    code: "TEMA-CENTRAL",
    city: "Tema",
    region: "Greater Accra",
    inAccraCore: true,
    pickupMode: "none",
    neighborhoods: [
      "afienya", "ashaiman", "baatsona", "baatsona estate east", "dawhenya",
      "free zone enclave", "greenwich meridian", "heavy industrial area",
      "klagon", "kpone", "lashibi", "ningo", "prampram", "sakumono",
      "tema community 1", "tema community 2", "tema community 3",
      "tema community 4", "tema community 5", "tema community 6",
      "tema community 7", "tema community 8", "tema community 9",
      "tema community 10", "tema community 11", "tema community 12",
      "tema community 13", "tema community 14", "tema community 15",
      "tema community 16", "tema community 17", "tema community 18",
      "tema community 19", "tema community 20", "tema community 21",
      "tema community 22", "tema community 23", "tema community 24",
      "tema community 25", "tema newtown",
    ],
    distanceMinKm: 0,
    distanceMaxKm: 30,
    baseRate: 2000, // GH₵20.00
    perKgRate: 400,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    fragileSurcharge: 500,
    distanceBaseFee: 1200, // GH₵12.00 base
    pricePerKm: 120,       // GH₵1.20 per km
    pricePerKg: 250,       // GH₵2.50 per kg
    estimatedDays: 2,
    isDefault: false,
    isActive: true,
  },
  // ── Regional zones (bus-station pickup) ────────────────────────────────
  // One zone per region is enough as a price-card anchor; the calculator
  // matches a regional customer's (region, city) pair to a zone and the
  // bus-station pickup fee formula uses zone.regionalBaseFee + weight.
  {
    name: "Ashanti Region",
    code: "ASHANTI",
    city: "Kumasi",
    region: "Ashanti",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 250,
    distanceMaxKm: 400,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500, // fragile surcharge still applies regionally
    regionalBaseFee: 2000,    // GH₵20.00 base
    regionalPricePerKg: 400,  // GH₵4.00 per kg
    estimatedDays: 3,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Central Region",
    code: "CENTRAL",
    city: "Cape Coast",
    region: "Central",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 120,
    distanceMaxKm: 180,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 1800,    // GH₵18.00
    regionalPricePerKg: 350,  // GH₵3.50 per kg
    estimatedDays: 2,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Western Region",
    code: "WESTERN",
    city: "Sekondi-Takoradi",
    region: "Western",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 200,
    distanceMaxKm: 300,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 2000,
    regionalPricePerKg: 400,
    estimatedDays: 3,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Eastern Region",
    code: "EASTERN",
    city: "Koforidua",
    region: "Eastern",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 60,
    distanceMaxKm: 120,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 1500,
    regionalPricePerKg: 300,
    estimatedDays: 2,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Volta Region",
    code: "VOLTA",
    city: "Ho",
    region: "Volta",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 140,
    distanceMaxKm: 200,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 1800,
    regionalPricePerKg: 350,
    estimatedDays: 3,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Northern Region",
    code: "NORTHERN",
    city: "Tamale",
    region: "Northern",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 400,
    distanceMaxKm: 600,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 2500,
    regionalPricePerKg: 500,
    estimatedDays: 5,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Bono Region",
    code: "BONO",
    city: "Sunyani",
    region: "Bono",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 300,
    distanceMaxKm: 400,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 2200,
    regionalPricePerKg: 450,
    estimatedDays: 4,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Upper East Region",
    code: "UPPER-EAST",
    city: "Bolgatanga",
    region: "Upper East",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 600,
    distanceMaxKm: 800,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 2800,
    regionalPricePerKg: 600,
    estimatedDays: 6,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Upper West Region",
    code: "UPPER-WEST",
    city: "Wa",
    region: "Upper West",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 600,
    distanceMaxKm: 800,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 2800,
    regionalPricePerKg: 600,
    estimatedDays: 6,
    isDefault: false,
    isActive: true,
  },
  {
    name: "Bono East Region",
    code: "BONO-EAST",
    city: "Techiman",
    region: "Bono East",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    distanceMinKm: 300,
    distanceMaxKm: 400,
    baseRate: 0,
    perKgRate: 0,
    fragileSurcharge: 500,
    regionalBaseFee: 2200,
    regionalPricePerKg: 450,
    estimatedDays: 4,
    isDefault: false,
    isActive: true,
  },
];

// Category tiers mirror the live catalogue's free-text categories (see
// models/ShippingTier.js — unmapped categories fall through to the editable
// `__default__` tier, never an error).
const TIERS = [
  {
    name: "Default",
    category: DEFAULT_TIER_CATEGORY,
    level: 0,
    multiplier: 1.0,
    fragileSurcharge: 0,
    weightThresholdKg: 0,
    weightSurchargePerKg: 0,
    isActive: true,
  },
  {
    name: "Screens & Displays",
    category: "Screen Protectors",
    level: 3,
    multiplier: 1.15,
    fragileSurcharge: 500, // GH₵5.00 padding/handling on glass
    weightThresholdKg: 0.5,
    weightSurchargePerKg: 200,
    isActive: true,
  },
  {
    name: "Phones & Devices",
    category: "Phones",
    level: 3,
    multiplier: 1.25,
    fragileSurcharge: 1000, // GH₵10.00
    weightThresholdKg: 1,
    weightSurchargePerKg: 300,
    isActive: true,
  },
  {
    name: "Small Accessories",
    category: "Phone Cases & Covers",
    level: 1,
    multiplier: 1.0,
    fragileSurcharge: 0,
    weightThresholdKg: 1,
    weightSurchargePerKg: 150,
    isActive: true,
  },
];

async function seed() {
  const db = resolveDbUrl();
  await mongoose.connect(db);
  logDbTarget("Shipping seed target");

  // Settings singleton — getSettings() creates on first read; the values set
  // below are the documented launch configuration (edit via admin CRUD):
  //   • free delivery threshold is null by default — admin sets the amount
  //     later via the shipping settings page, so it starts disabled (courier
  //     is always charged, in-house is always free)
  //   • in-house rider + courier dispatch on; express on
  //   • bus-station pickup on (E2 expansion)
  const settings = await ShippingSettings.getSettings();
  settings.freeDeliveryThreshold = null;
  settings.inHouseDeliveryAvailable = true;
  settings.courierDispatchAvailable = true;
  settings.expressAvailable = true;
  settings.pickupAvailable = true; // bus-station pickup is on
  settings.inHouseRadiusKm = null; // unlimited until ops decides a radius
  await settings.save();

  for (const zone of ZONES) {
    await ShippingZone.updateOne(
      { code: zone.code },
      { $set: zone },
      { upsert: true },
    );
  }

  for (const tier of TIERS) {
    await ShippingTier.updateOne(
      { category: tier.category },
      { $set: tier },
      { upsert: true },
    );
  }

  // Warehouse — one per system. The unique default-warehouse index lets
  // re-runs upsert cleanly; only one row can be default-true.
  await PickupLocation.updateOne(
    { name: WAREHOUSE.name, kind: "warehouse" },
    { $set: WAREHOUSE },
    { upsert: true },
  );
  // Clear other warehouse isDefault flags so exactly one is the default.
  await PickupLocation.updateMany(
    { kind: "warehouse", isDefault: true, name: { $ne: WAREHOUSE.name } },
    { $set: { isDefault: false } },
  );

  // Bus-station pickup points — one per major regional city. Match on
  // (name, kind) so re-runs update the existing row in place; new regions
  // append cleanly.
  for (const station of BUS_STATIONS) {
    await PickupLocation.updateOne(
      { name: station.name, kind: "bus_station" },
      { $set: station },
      { upsert: true },
    );
  }

  const [zoneCount, tierCount, pickupCount, warehouseCount] = await Promise.all([
    ShippingZone.countDocuments(),
    ShippingTier.countDocuments(),
    PickupLocation.countDocuments({ kind: "bus_station", isActive: true }),
    PickupLocation.countDocuments({ kind: "warehouse", isActive: true }),
  ]);
  console.log(
    `Totals — Zones: ${zoneCount}, Tiers: ${tierCount}, ` +
    `Bus stations: ${pickupCount}, Warehouses: ${warehouseCount}, ` +
    `Free delivery: ${settings.freeDeliveryThreshold > 0 ? "on" : "off"}`
  );

  await mongoose.connection.close();
  console.log("Shipping seed complete");
}

// Guarded so tests and other seeders can require this module without a DB run.
if (require.main === module) {
  dotenv.config({ path: "./.env" });
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}

module.exports = { ZONES, TIERS, WAREHOUSE, BUS_STATIONS };
