const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Part = require("../models/Part");

dotenv.config({ path: "./.env" });

const mongoUrlRaw =
  process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
if (!mongoUrlRaw) {
  console.error("MONGO_URL is not defined in environment variables");
  process.exit(1);
}

const dbPassword =
  process.env.DATABASE_PASSWORD || process.env.database_password;
const db =
  mongoUrlRaw.includes("<PASSWORD>") && dbPassword
    ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
    : mongoUrlRaw;

const placeholder = (text) =>
  `https://placehold.co/800x600/1e1b4b/ffffff?text=${encodeURIComponent(text)}`;

// Real part images — hotlinked from iFixit / REPART / parts retailers
// (IMAGES_VARIANTS_TASK.md Decision #2: no re-hosting; onError fallback
// handles any future breakage).
const PART_IMG = {
  "iPhone 11 LCD Screen": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/TVXATI3EILnB5WhC.jpg?v=1717686295",
  "iPhone 12 OLED Screen": "https://irepart.com/cdn/shop/files/iphone-12-12-pro-soft-oled.webp?v=1693466749",
  "iPhone 13 OLED Screen": "https://irepart.com/cdn/shop/files/RepartiPhone13SoftOled01.png?v=1715149428",
  "iPhone 14 OLED Screen": "https://irepart.com/cdn/shop/files/RepartiPhone14SoftOled01.png?v=1715159175",
  "iPhone 15 Pro Max OLED Screen": "https://irepart.com/cdn/shop/files/iphone-15-pro-max-hard-oled-01.jpg?v=1753090646",
  "iPhone 11 Battery": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/ZKLgwXGWZgHKQDVb.jpg?v=1754435398",
  "iPhone 12 Battery": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/1JXyXii4Opy6Kv4W_3c4fb8c9-6a9b-4b33-b2b8-867ff5f0620a.jpg?v=1752101236",
  "iPhone 13 Battery": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/BAZEBaaGgQNq2HxJ.jpg?v=1726094579",
  "iPhone 14 Battery": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/6tWVHsgO6fQYEubH.jpg?v=1736175194",
  "iPhone 15 Battery": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/EmXPUEqDZKDlN3UO.jpg?v=1752604225",
  "iPhone 11 Charging Port": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/B1PWZvuXnqm5Yn2g.jpg?v=1779884327",
  "iPhone 13 Charging Port": "https://cdn.shopify.com/s/files/1/0045/4092/4007/products/BZ6I5sLfNTWlPLGH.jpg?v=1684262283",
  "iPhone 14 Charging Port": "https://cdn.shopify.com/s/files/1/0045/4092/4007/products/YMcl3wmTU3GTpeiI.jpg?v=1675710273",
  "iPhone 15 Charging Port": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/URUHI3r6ggmTZFiE.jpg?v=1720809256",
  "iPhone 11 Camera": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/NHkPiNUAQNVYXBRi.jpg?v=1733346503",
  "iPhone 12 Camera": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/nhIlE1BVWLsDOXVF.jpg?v=1733346572",
  "iPhone 15 Pro Max Camera": "https://repairpartsusa.com/cdn/shop/files/iphone-15-pro-max-rear-camera.jpg?v=1746279310",
  "iPhone 11 Speaker": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/ir51CLFCyRELPQgH.jpg?v=1733346499",
  "iPhone 13 Speaker": "https://cdn.shopify.com/s/files/1/0045/4092/4007/products/GNjOZCQHEpGpUUN1_f43c2fec-56ef-45b8-afbd-a4841180ad6a.jpg?v=1684262403",
  "iPhone 15 Speaker": "https://cdn.shopify.com/s/files/1/0045/4092/4007/files/EWYnlTstyEOaIgsG.jpg?v=1720809380",
};

// Selling prices are supplied in GHS major units (e.g. 450 = GH₵450) and
// stored as integer minor units (pesewas) ×100, matching the shop's money
// convention. Cost is ~65% of selling so the shop keeps a healthy margin.
const PART = (name, sku, category, sellingPrice, compatibleWith, description, imgKey) => ({
  name,
  sku,
  category,
  isRetail: true,
  quantity: (sellingPrice % 97) + 5, // deterministic stock 5..20
  lowStockThreshold: 3,
  allowNegativeStock: false,
  costPrice: Math.round(sellingPrice * 0.65) * 100,
  sellingPrice: sellingPrice * 100,
  compatibleWith,
  description,
  images: [PART_IMG[imgKey] || placeholder(imgKey)],
  notes: "",
});

const PARTS = [
  // ─── Screens ─────────────────────────────────────────────
  PART(
    "iPhone 11 LCD Screen Replacement",
    "PT-IPH-SCN-11",
    "Screen",
    350,
    ["iPhone 11"],
    "High-quality replacement LCD screen for iPhone 11 with genuine touch sensitivity and full True Tone support. Each unit is inspected and tested before dispatch.",
    "iPhone 11 LCD Screen",
  ),
  PART(
    "iPhone 12 OLED Screen Replacement",
    "PT-IPH-SCN-12",
    "Screen",
    500,
    ["iPhone 12", "iPhone 12 Pro"],
    "OLED replacement display for iPhone 12 / 12 Pro with vivid colours and deep blacks. Restores Face ID-compatible True Tone after install.",
    "iPhone 12 OLED Screen",
  ),
  PART(
    "iPhone 13 OLED Screen Replacement",
    "PT-IPH-SCN-13",
    "Screen",
    550,
    ["iPhone 13"],
    "Replacement OLED display for iPhone 13 — crisp 6.1-inch Super Retina XDR panel with 60Hz refresh, factory colour calibration.",
    "iPhone 13 OLED Screen",
  ),
  PART(
    "iPhone 14 OLED Screen Replacement",
    "PT-IPH-SCN-14",
    "Screen",
    650,
    ["iPhone 14"],
    "OEM-grade OLED replacement for iPhone 14 with ceramic-shield glass and true-to-life colour accuracy.",
    "iPhone 14 OLED Screen",
  ),
  PART(
    "iPhone 15 Pro Max OLED Screen Replacement",
    "PT-IPH-SCN-15PM",
    "Screen",
    950,
    ["iPhone 15 Pro Max"],
    "Premium OLED replacement screen for iPhone 15 Pro Max with ProMotion 120Hz and Dynamic Island cutout. Fitted with new gaskets.",
    "iPhone 15 Pro Max OLED Screen",
  ),

  // ─── Batteries ───────────────────────────────────────────
  PART(
    "iPhone 11 Battery (3110mAh)",
    "PT-IPH-BAT-11",
    "Battery",
    140,
    ["iPhone 11"],
    "Genuine-capacity 3110mAh replacement battery for iPhone 11. Restores all-day battery life and normal battery-health reporting.",
    "iPhone 11 Battery",
  ),
  PART(
    "iPhone 12 Battery (2815mAh)",
    "PT-IPH-BAT-12",
    "Battery",
    160,
    ["iPhone 12", "iPhone 12 Pro"],
    "2815mAh replacement battery for iPhone 12 / 12 Pro with protection circuit and over-discharge safety.",
    "iPhone 12 Battery",
  ),
  PART(
    "iPhone 13 Battery (3227mAh)",
    "PT-IPH-BAT-13",
    "Battery",
    170,
    ["iPhone 13"],
    "High-capacity 3227mAh replacement battery for iPhone 13. Includes adhesive strips for a clean install.",
    "iPhone 13 Battery",
  ),
  PART(
    "iPhone 14 Battery (3279mAh)",
    "PT-IPH-BAT-14",
    "Battery",
    180,
    ["iPhone 14"],
    "3279mAh replacement battery for iPhone 14 with genuine charge-cycle performance and full safety certification.",
    "iPhone 14 Battery",
  ),
  PART(
    "iPhone 15 Battery (3349mAh)",
    "PT-IPH-BAT-15",
    "Battery",
    200,
    ["iPhone 15"],
    "3349mAh replacement battery for iPhone 15. Tested for capacity, matched to the factory profile.",
    "iPhone 15 Battery",
  ),

  // ─── Charging ports ──────────────────────────────────────
  PART(
    "iPhone 11 Lightning Charging Port Flex",
    "PT-IPH-CHG-11",
    "Charging Port",
    95,
    ["iPhone 11", "iPhone 11 Pro"],
    "Replacement Lightning charging-port flex for iPhone 11 / 11 Pro. Restores fast charging, data sync and audio output.",
    "iPhone 11 Charging Port",
  ),
  PART(
    "iPhone 13 Lightning Charging Port Flex",
    "PT-IPH-CHG-13",
    "Charging Port",
    105,
    ["iPhone 13"],
    "Genuine-style Lightning port flex for iPhone 13. Solder-free drop-in replacement with microphone assembly.",
    "iPhone 13 Charging Port",
  ),
  PART(
    "iPhone 14 Lightning Charging Port Flex",
    "PT-IPH-CHG-14",
    "Charging Port",
    110,
    ["iPhone 14"],
    "Replacement Lightning charging flex for iPhone 14, restoring charge, data and Face ID-related sensors.",
    "iPhone 14 Charging Port",
  ),
  PART(
    "iPhone 15 USB-C Charging Port Flex",
    "PT-IPH-CHG-15",
    "Charging Port",
    130,
    ["iPhone 15"],
    "USB-C charging-port flex for iPhone 15 with full 20W fast-charge and data-transfer support.",
    "iPhone 15 Charging Port",
  ),

  // ─── Cameras ─────────────────────────────────────────────
  PART(
    "iPhone 11 Rear Camera Module",
    "PT-IPH-CAM-11",
    "Camera",
    220,
    ["iPhone 11"],
    "Complete rear dual-camera module for iPhone 11 (wide + ultra-wide). Tested for focus, OIS and HDR.",
    "iPhone 11 Camera",
  ),
  PART(
    "iPhone 12 Rear Camera Module",
    "PT-IPH-CAM-12",
    "Camera",
    250,
    ["iPhone 12", "iPhone 12 Pro"],
    "Replacement rear camera module for iPhone 12 / 12 Pro with restored Night mode and OIS.",
    "iPhone 12 Camera",
  ),
  PART(
    "iPhone 15 Pro Max Telephoto Camera",
    "PT-IPH-CAM-15PM",
    "Camera",
    420,
    ["iPhone 15 Pro Max"],
    "OEM telephoto lens module for iPhone 15 Pro Max (5x optical zoom). Calibrated for focus and stabilisation.",
    "iPhone 15 Pro Max Camera",
  ),

  // ─── Speakers ────────────────────────────────────────────
  PART(
    "iPhone 11 Bottom Speaker Assembly",
    "PT-IPH-SPK-11",
    "Speaker",
    70,
    ["iPhone 11"],
    "Replacement loudspeaker assembly for iPhone 11. Loud, clear audio with vibration motor bracket.",
    "iPhone 11 Speaker",
  ),
  PART(
    "iPhone 13 Bottom Speaker Assembly",
    "PT-IPH-SPK-13",
    "Speaker",
    75,
    ["iPhone 13"],
    "Bottom speaker replacement for iPhone 13 with balanced stereo output and dust mesh included.",
    "iPhone 13 Speaker",
  ),
  PART(
    "iPhone 15 Loudspeaker Assembly",
    "PT-IPH-SPK-15",
    "Speaker",
    85,
    ["iPhone 15"],
    "Replacement loudspeaker assembly for iPhone 15 delivering crisp, distortion-free audio.",
    "iPhone 15 Speaker",
  ),
];

async function seed() {
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");

  // Idempotent by SKU: existing parts are refreshed in place, never duplicated.
  const ops = PARTS.map((p) => ({
    updateOne: {
      filter: { sku: p.sku },
      update: { $set: p },
      upsert: true,
    },
  }));
  const result = await Part.bulkWrite(ops);
  console.log(
    `Parts — ${result.upsertedCount} inserted, ${result.modifiedCount} updated, ${result.matchedCount} matched`,
  );

  const retail = await Part.countDocuments({ isRetail: true, sku: { $in: PARTS.map((p) => p.sku) } });
  console.log(`Retail-listed seeded parts: ${retail}`);

  await mongoose.connection.close();
  console.log("Seed complete");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
