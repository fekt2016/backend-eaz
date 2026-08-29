const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Location = require("../models/Location");
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

// ── Ghana geography seed data ────────────────────────────────────────────────
// The source of truth for "where a customer lives" in the shipping system.
// `inAccraCore: true` is the only fulfilment gate — Greater-Accra-core cities
// may use home delivery (in_house/courier); everything else is bus-station
// pickup only.
//
// Neighborhoods are lowercased + de-duped on save by the Location schema hook,
// so they are written here in their natural case for readability — the DB
// always stores them lowercased.
//
// Cities marked `inAccraCore: true` form the Greater-Accra core delivery zone.
// All other cities pick a bus-station pickup point at checkout time.

// Greater Accra — full neighborhood coverage. Accra + Tema carry the same
// extensive neighborhood lists that live in the legacy ShippingZone seeds so
// existing customers keep their old matches working.
const GREATER_ACCRA_NEIGHBORHOODS = {
  Accra: [
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
  Tema: [
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
};

// Other Greater-Accra towns (in-core for delivery, but neighborhoods are
// lighter — the address modal accepts free text where the dropdown is sparse).
const GREATER_ACCRA_OTHER = ["Kasoa", "Koforidua", "Nsawam", "Madina", "Dodowa", "Somanya"];

// All 16 regions of Ghana with their primary cities. Only the Greater-Accra
// cities are flagged inAccraCore; everyone else is bus-station pickup.
const LOCATIONS = [
  // ── Greater Accra (core) ───────────────────────────────────────────────
  { region: "Greater Accra", city: "Accra", neighborhoods: GREATER_ACCRA_NEIGHBORHOODS.Accra, inAccraCore: true },
  { region: "Greater Accra", city: "Tema", neighborhoods: GREATER_ACCRA_NEIGHBORHOODS.Tema, inAccraCore: true },
  ...GREATER_ACCRA_OTHER.map((city) => ({
    region: "Greater Accra",
    city,
    neighborhoods: [],
    inAccraCore: true,
  })),

  // ── Ashanti ────────────────────────────────────────────────────────────
  { region: "Ashanti", city: "Kumasi", neighborhoods: [], inAccraCore: false },
  { region: "Ashanti", city: "Obuasi", neighborhoods: [], inAccraCore: false },
  { region: "Ashanti", city: "Ejisu", neighborhoods: [], inAccraCore: false },
  { region: "Ashanti", city: "Bekwai", neighborhoods: [], inAccraCore: false },
  { region: "Ashanti", city: "Konongo", neighborhoods: [], inAccraCore: false },
  { region: "Ashanti", city: "Mampong", neighborhoods: [], inAccraCore: false },

  // ── Central ────────────────────────────────────────────────────────────
  { region: "Central", city: "Cape Coast", neighborhoods: [], inAccraCore: false },
  { region: "Central", city: "Sekondi-Takoradi", neighborhoods: [], inAccraCore: false },
  { region: "Central", city: "Winneba", neighborhoods: [], inAccraCore: false },
  { region: "Central", city: "Kasoa", neighborhoods: [], inAccraCore: false },
  { region: "Central", city: "Swedru", neighborhoods: [], inAccraCore: false },
  { region: "Central", city: "Dunkwa-on-Offin", neighborhoods: [], inAccraCore: false },

  // ── Eastern ────────────────────────────────────────────────────────────
  { region: "Eastern", city: "Koforidua", neighborhoods: [], inAccraCore: false },
  { region: "Eastern", city: "Nkawkaw", neighborhoods: [], inAccraCore: false },
  { region: "Eastern", city: "Akim Oda", neighborhoods: [], inAccraCore: false },
  { region: "Eastern", city: "Suhum", neighborhoods: [], inAccraCore: false },
  { region: "Eastern", city: "Nsawam", neighborhoods: [], inAccraCore: false },
  { region: "Eastern", city: "Begoro", neighborhoods: [], inAccraCore: false },

  // ── Western ────────────────────────────────────────────────────────────
  { region: "Western", city: "Sekondi-Takoradi", neighborhoods: [], inAccraCore: false },
  { region: "Western", city: "Tarkwa", neighborhoods: [], inAccraCore: false },
  { region: "Western", city: "Axim", neighborhoods: [], inAccraCore: false },
  { region: "Western", city: "Prestea", neighborhoods: [], inAccraCore: false },

  // ── Western North ──────────────────────────────────────────────────────
  { region: "Western North", city: "Sefwi Wiawso", neighborhoods: [], inAccraCore: false },
  { region: "Western North", city: "Bibiani", neighborhoods: [], inAccraCore: false },

  // ── Volta ──────────────────────────────────────────────────────────────
  { region: "Volta", city: "Ho", neighborhoods: [], inAccraCore: false },
  { region: "Volta", city: "Hohoe", neighborhoods: [], inAccraCore: false },
  { region: "Volta", city: "Keta", neighborhoods: [], inAccraCore: false },
  { region: "Volta", city: "Aflao", neighborhoods: [], inAccraCore: false },
  { region: "Volta", city: "Sogakope", neighborhoods: [], inAccraCore: false },

  // ── Oti ────────────────────────────────────────────────────────────────
  { region: "Oti", city: "Dambai", neighborhoods: [], inAccraCore: false },

  // ── Northern ───────────────────────────────────────────────────────────
  { region: "Northern", city: "Tamale", neighborhoods: [], inAccraCore: false },
  { region: "Northern", city: "Yendi", neighborhoods: [], inAccraCore: false },

  // ── Savannah ───────────────────────────────────────────────────────────
  { region: "Savannah", city: "Damongo", neighborhoods: [], inAccraCore: false },

  // ── North East ─────────────────────────────────────────────────────────
  { region: "North East", city: "Nalerigu", neighborhoods: [], inAccraCore: false },

  // ── Upper East ─────────────────────────────────────────────────────────
  { region: "Upper East", city: "Bolgatanga", neighborhoods: [], inAccraCore: false },
  { region: "Upper East", city: "Bawku", neighborhoods: [], inAccraCore: false },

  // ── Upper West ─────────────────────────────────────────────────────────
  { region: "Upper West", city: "Wa", neighborhoods: [], inAccraCore: false },

  // ── Bono ───────────────────────────────────────────────────────────────
  { region: "Bono", city: "Sunyani", neighborhoods: [], inAccraCore: false },
  { region: "Bono", city: "Techiman", neighborhoods: [], inAccraCore: false },

  // ── Bono East ──────────────────────────────────────────────────────────
  { region: "Bono East", city: "Techiman", neighborhoods: [], inAccraCore: false },
  { region: "Bono East", city: "Atebubu", neighborhoods: [], inAccraCore: false },

  // ── Ahafo ──────────────────────────────────────────────────────────────
  { region: "Ahafo", city: "Goaso", neighborhoods: [], inAccraCore: false },
];

async function seed() {
  const db = resolveDbUrl();
  await mongoose.connect(db);
  logDbTarget("Locations seed target");

  let createdCount = 0;
  let updatedCount = 0;

  for (const loc of LOCATIONS) {
    const result = await Location.findOneAndUpdate(
      { region: loc.region, city: loc.city },
      { $set: { ...loc, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (result) {
      // upsert returns the doc regardless; check if it was newly created by
      // looking at the createdAt vs updatedAt
      const wasNew = result.createdAt.getTime() === result.updatedAt.getTime();
      if (wasNew) {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
    }
  }

  const total = await Location.countDocuments();
  const accraCoreCount = await Location.countDocuments({ inAccraCore: true });
  console.log(
    `Locations — Created: ${createdCount}, Updated: ${updatedCount}, ` +
    `Total: ${total}, Greater-Accra-core: ${accraCoreCount}`
  );

  await mongoose.connection.close();
  console.log("Locations seed complete");
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

module.exports = { LOCATIONS };
