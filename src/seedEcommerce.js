const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const DeliveryZone = require("../models/DeliveryZone");

// Resolved lazily inside seed() so this module can be imported by tests/other
// seeders without touching .env or the process.
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

const IPHONE_IMG_1 =
  "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=800&q=80";
const IPHONE_IMG_2 =
  "https://images.unsplash.com/photo-1573148195900-7845dcb9b127?w=800&q=80";
const SAMSUNG_IMG =
  "https://images.unsplash.com/photo-1601972599720-36938d4ecd31?w=800&q=80";
const CASE_IMG_1 =
  "https://images.unsplash.com/photo-1535157412991-2ef801c1748b?w=800&q=80";
const CASE_IMG_2 =
  "https://images.unsplash.com/photo-1547658718-f4311ad64746?w=800&q=80";
const CHARGER_IMG_1 =
  "https://images.unsplash.com/photo-1557767382-97b28f5488e7?w=800&q=80";
const CHARGER_IMG_2 =
  "https://images.unsplash.com/photo-1573868388390-2739872961e6?w=800&q=80";
const CHARGER_IMG_3 =
  "https://images.unsplash.com/photo-1492107376256-4026437926cd?w=800&q=80";
const POWERBANK_IMG =
  "https://images.unsplash.com/photo-1613070541337-b40942ee6527?w=800&q=80";
const EARPHONE_IMG_1 =
  "https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=800&q=80";
const EARPHONE_IMG_2 =
  "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=800&q=80";
const EARPHONE_IMG_3 =
  "https://images.unsplash.com/photo-1606841837239-c5a1a4a07af7?w=800&q=80";

const placeholder = (text) =>
  `https://placehold.co/800x600/1e1b4b/ffffff?text=${encodeURIComponent(text)}`;

// Cloudinary demo cloud — real, loadable URLs used as the Phase 4 working
// example for per-variant images and gallery videos. Production uploads go
// through controllers/uploadController.js (full URL strings stored).
const CLOUD_IMG = (name) => `https://res.cloudinary.com/demo/image/upload/${name}`;
const CLOUD_VIDEO = (name) => `https://res.cloudinary.com/demo/video/upload/${name}`;
const CLOUD_CASE_BLACK = CLOUD_IMG("cld-sample.jpg");
const CLOUD_CASE_BLUE = CLOUD_IMG("cld-sample-2.jpg");
const CLOUD_CASE_WHITE = CLOUD_IMG("cld-sample-3.jpg");
const CLOUD_CASE_GRAY = CLOUD_IMG("cld-sample-4.jpg");
const CLOUD_HEADPHONE_BLACK = CLOUD_IMG("cld-sample-5.jpg");
const CLOUD_GALLERY_VIDEO = CLOUD_VIDEO("dog.mp4");

const PRODUCTS = [
  // ─── Phones (iPhone + Samsung Galaxy only) ───────────────
  {
    name: "iPhone 15 Pro Max (1TB)",
    slug: "iphone-15-pro-max-1tb",
    description:
      "Apple iPhone 15 Pro Max with 48MP camera system, A17 Pro chip, 6.7-inch Super Retina XDR display, and surgical-grade titanium design.",
    price: 1299999,
    images: [IPHONE_IMG_1],
    category: "Phones",
    stock: 20,
    sku: "EZW-IPH-001",
    variants: ["256GB", "512GB", "1TB"],
    specs: [
      { label: "Display", value: "6.7-inch Super Retina XDR, ProMotion 120Hz" },
      { label: "Chipset", value: "Apple A17 Pro" },
      { label: "Camera", value: "48MP Pro camera system" },
      { label: "Battery", value: "Up to 29 hours video playback" },
    ],
    isActive: true,
  },
  {
    name: "iPhone 15 Pro (512GB)",
    slug: "iphone-15-pro-512gb",
    description:
      "Apple iPhone 15 Pro with 48MP main camera, A17 Pro chip, and advanced titanium frame design.",
    price: 1099999,
    images: [IPHONE_IMG_2],
    category: "Phones",
    stock: 25,
    sku: "EZW-IPH-002",
    variants: ["128GB", "256GB", "512GB"],
    isActive: true,
  },
  {
    name: "iPhone 15 Pro (256GB)",
    slug: "iphone-15-pro-256gb",
    description:
      "Apple iPhone 15 Pro with A17 Pro chip, titanium frame, and pro-grade 48MP camera.",
    price: 949999,
    images: [IPHONE_IMG_1],
    category: "Phones",
    stock: 30,
    sku: "EZW-IPH-004",
    variants: ["128GB", "256GB", "512GB"],
    isActive: true,
  },
  {
    name: "iPhone 15 (256GB)",
    slug: "iphone-15-256gb",
    description:
      "Apple iPhone 15 with Dynamic Island, A16 Bionic chip, and enhanced battery life.",
    price: 799999,
    images: [IPHONE_IMG_2],
    category: "Phones",
    stock: 35,
    sku: "EZW-IPH-003",
    variants: ["128GB", "256GB"],
    isActive: true,
  },
  {
    name: "Samsung Galaxy S24 Ultra (512GB)",
    slug: "samsung-galaxy-s24-ultra-512gb",
    description:
      "Samsung Galaxy S24 Ultra with 200MP camera, Snapdragon 8 Gen 3 processor, and integrated S Pen.",
    price: 1099999,
    images: [SAMSUNG_IMG],
    category: "Phones",
    stock: 30,
    sku: "EZW-SAM-001",
    variants: ["256GB", "512GB", "1TB"],
    specs: [
      { label: "Display", value: "6.8-inch Dynamic AMOLED 2X, 120Hz" },
      { label: "Chipset", value: "Snapdragon 8 Gen 3" },
      { label: "Camera", value: "200MP main + 12MP + 50MP + 10MP" },
      { label: "Battery", value: "5000 mAh" },
    ],
    isActive: true,
  },
  {
    name: "Samsung Galaxy S24+ (256GB)",
    slug: "samsung-galaxy-s24-256gb",
    description:
      "Samsung Galaxy S24+ with Dynamic AMOLED 2X display, Snapdragon 8 Gen 3, and enhanced camera system.",
    price: 899999,
    images: [SAMSUNG_IMG],
    category: "Phones",
    stock: 28,
    sku: "EZW-SAM-002",
    variants: ["128GB", "256GB", "512GB"],
    isActive: true,
  },
  {
    name: "Samsung Galaxy S24 (128GB)",
    slug: "samsung-galaxy-s24-128gb",
    description:
      "Samsung Galaxy S24 with vibrant 6.2-inch display, Snapdragon 8 Gen 3, and Pro-grade camera.",
    price: 699999,
    images: [SAMSUNG_IMG],
    category: "Phones",
    stock: 40,
    sku: "EZW-SAM-003",
    variants: ["128GB", "256GB"],
    isActive: true,
  },
  {
    name: "Samsung Galaxy S23 FE (128GB)",
    slug: "samsung-galaxy-s23-fe-128gb",
    description:
      "Samsung Galaxy S23 FE with Snapdragon processor, amazing camera system, and great value.",
    price: 699999,
    images: [SAMSUNG_IMG],
    category: "Phones",
    stock: 45,
    sku: "EZW-SAM-004",
    variants: ["128GB", "256GB", "512GB"],
    isActive: true,
  },
  {
    name: "iPhone 15 Plus (256GB)",
    slug: "iphone-15-plus-256gb",
    description:
      "Apple iPhone 15 Plus with Dynamic Island, A16 Bionic chip, and an extended battery that lasts all day.",
    price: 749999,
    images: [IPHONE_IMG_2],
    category: "Phones",
    stock: 30,
    sku: "EZW-IPH-005",
    variants: ["128GB", "256GB"],
    specs: [
      { label: "Display", value: "6.7-inch Super Retina XDR (OLED)" },
      { label: "Chipset", value: "Apple A16 Bionic" },
      { label: "Camera", value: "48MP main + 12MP Ultra Wide" },
      { label: "Battery", value: "Up to 26 hours video playback" },
    ],
    isActive: true,
  },

  // ─── Phone Cases & Covers ────────────────────────────────
  {
    name: "Spigen Tough Armor Case",
    slug: "spigen-tough-armor-case",
    description:
      "Durable Spigen Tough Armor case with shock absorption and elegant design.",
    price: 15999,
    images: [CLOUD_CASE_BLACK],
    category: "Phone Cases & Covers",
    stock: 150,
    sku: "EZW-SPG-001",
    variants: [
      { sku: "EZW-SPG-001-BLK", attributes: { color: "Black" }, stock: 60, images: [CLOUD_CASE_BLACK] },
      { sku: "EZW-SPG-001-BLU", attributes: { color: "Blue" }, stock: 50, images: [CLOUD_CASE_BLUE] },
      { sku: "EZW-SPG-001-WHT", attributes: { color: "White" }, stock: 40, images: [CLOUD_CASE_WHITE] },
    ],
    gallery: {
      images: [CLOUD_CASE_BLACK, CLOUD_CASE_BLUE, CLOUD_CASE_WHITE],
      videos: [CLOUD_GALLERY_VIDEO],
    },
    isActive: true,
  },
  {
    name: "Supcase Universal Case",
    slug: "supcase-universal-case",
    description:
      "Supcase Universal case with built-in kickstand and shockproof protection.",
    price: 12999,
    images: [CASE_IMG_2],
    category: "Phone Cases & Covers",
    stock: 120,
    sku: "EZW-SUP-001",
    variants: ["Black", "Gray", "Red"],
    isActive: true,
  },
  {
    name: "Olixar Clear Case",
    slug: "olixar-clear-case",
    description:
      "Olixar clear transparent case with raised camera lip and anti-yellowing protection.",
    price: 9999,
    images: [CLOUD_CASE_WHITE],
    category: "Phone Cases & Covers",
    stock: 200,
    sku: "EZW-OLI-001",
    variants: [
      { sku: "EZW-OLI-001-CLR", attributes: { color: "Clear" }, stock: 90, images: [CLOUD_CASE_WHITE] },
      { sku: "EZW-OLI-001-BLU", attributes: { color: "Blue" }, stock: 60, images: [CLOUD_CASE_BLUE] },
      { sku: "EZW-OLI-001-PNK", attributes: { color: "Pink" }, stock: 50, images: [CLOUD_CASE_WHITE] },
    ],
    gallery: {
      images: [CLOUD_CASE_WHITE, CLOUD_CASE_BLUE],
      videos: [CLOUD_GALLERY_VIDEO],
    },
    isActive: true,
  },
  {
    name: "Nillkin Hard Case",
    slug: "nillkin-hard-case",
    description:
      "Nillkin Hard case with kickstand and shockproof protection for iPhone.",
    price: 18999,
    images: [CASE_IMG_2],
    category: "Phone Cases & Covers",
    stock: 100,
    sku: "EZW-NIL-001",
    variants: ["Black", "White", "Green"],
    isActive: true,
  },
  {
    name: "Uag Military Series Case",
    slug: "uag-military-series-case",
    description:
      "UAG Military Series case with MIL-STD-810G certification and tactical design.",
    price: 39999,
    images: [CLOUD_CASE_BLACK],
    category: "Phone Cases & Covers",
    stock: 40,
    sku: "EZW-UAG-001",
    variants: [
      { sku: "EZW-UAG-001-BLK", attributes: { color: "Black" }, stock: 20, images: [CLOUD_CASE_BLACK] },
      { sku: "EZW-UAG-001-CMO", attributes: { color: "Camouflage" }, stock: 10, images: [CLOUD_CASE_GRAY] },
      { sku: "EZW-UAG-001-RED", attributes: { color: "Red" }, stock: 10, images: [CLOUD_CASE_WHITE] },
    ],
    gallery: {
      images: [CLOUD_CASE_BLACK, CLOUD_CASE_GRAY],
      videos: [CLOUD_GALLERY_VIDEO],
    },
    isActive: true,
  },
  {
    name: "Moshi Syber Case",
    slug: "moshi-syber-case",
    description:
      "Moshi Syber case with modular design and antimicrobial protection.",
    price: 34999,
    images: [CASE_IMG_2],
    category: "Phone Cases & Covers",
    stock: 35,
    sku: "EZW-MOS-001",
    variants: ["Black", "Gray", "Silver"],
    isActive: true,
  },
  {
    name: "Spigen Liquid Crystal Case",
    slug: "spigen-liquid-crystal-case",
    description:
      "Spigen Liquid Crystal case with crystal clear design and shock absorption.",
    price: 11999,
    images: [CASE_IMG_1],
    category: "Phone Cases & Covers",
    stock: 140,
    sku: "EZW-SPG-002",
    variants: ["Black", "Clear", "Blue"],
    isActive: true,
  },
  {
    name: "Nillkin Air Case",
    slug: "nillkin-air-case",
    description:
      "Nillkin Air case with ultra-slim design and excellent heat dissipation.",
    price: 16999,
    images: [CASE_IMG_2],
    category: "Phone Cases & Covers",
    stock: 85,
    sku: "EZW-NIL-002",
    variants: ["Black", "White", "Silver"],
    isActive: true,
  },
  {
    name: "Ringke Onyx Case",
    slug: "ringke-onyx-case",
    description:
      "Ringke Onyx case with matte black finish, raised bezel, and secure grip design.",
    price: 14999,
    images: [CASE_IMG_1],
    category: "Phone Cases & Covers",
    stock: 110,
    sku: "EZW-RIN-001",
    variants: ["Black", "Gray", "Blue"],
    isActive: true,
  },
  {
    name: "ESR Shockproof Case",
    slug: "esr-shockproof-case",
    description:
      "ESR Shockproof case with double-layer protection and military-grade drop resistance.",
    price: 11999,
    images: [CASE_IMG_2],
    category: "Phone Cases & Covers",
    stock: 95,
    sku: "EZW-ESR-001",
    variants: ["Black", "Red", "Green"],
    isActive: true,
  },
  {
    name: "Lamicall Nylon Case",
    slug: "lamicall-nylon-case",
    description:
      "Lamicall nylon weave case with soft microfibre lining and slim profile.",
    price: 12999,
    images: [CASE_IMG_1],
    category: "Phone Cases & Covers",
    stock: 75,
    sku: "EZW-LAM-001",
    variants: ["Black", "Brown", "Navy"],
    isActive: true,
  },
  {
    name: "OtterBox Defender Case",
    slug: "otterbox-defender-case",
    description:
      "OtterBox Defender multi-layer case with rugged drop protection and a belt-clip holster.",
    price: 44999,
    images: [CASE_IMG_1],
    category: "Phone Cases & Covers",
    stock: 45,
    sku: "EZW-OTT-001",
    variants: ["Black", "Red", "Blue"],
    specs: [
      { label: "Material", value: "Multi-layer polycarbonate + synthetic rubber" },
      { label: "Compatibility", value: "iPhone 15 Pro Max (order size variant)" },
      { label: "Protection", value: "Drop tested to MIL-STD-810G" },
      { label: "Extras", value: "Belt-clip holster included" },
    ],
    isActive: true,
  },
  {
    name: "Spigen Ultra Hybrid Case",
    slug: "spigen-ultra-hybrid-case",
    description:
      "Spigen Ultra Hybrid clear case with a shock-absorbing bumper and anti-yellowing back panel.",
    price: 19999,
    images: [CLOUD_CASE_WHITE],
    category: "Phone Cases & Covers",
    stock: 130,
    sku: "EZW-SPG-004",
    variants: [
      { sku: "EZW-SPG-004-CLR", attributes: { color: "Clear" }, stock: 80, images: [CLOUD_CASE_WHITE] },
      { sku: "EZW-SPG-004-BLK", attributes: { color: "Black" }, stock: 50, images: [CLOUD_CASE_BLACK] },
    ],
    gallery: {
      images: [CLOUD_CASE_WHITE, CLOUD_CASE_BLACK],
      videos: [CLOUD_GALLERY_VIDEO],
    },
    specs: [
      { label: "Material", value: "Clear polycarbonate back + TPU bumper" },
      { label: "Compatibility", value: "iPhone 15 series (order size variant)" },
      { label: "Protection", value: "Air Cushion shock-absorbing corners" },
      { label: "Coating", value: "Anti-yellowing back panel" },
    ],
    isActive: true,
  },

  // ─── Chargers & Cables ──────────────────────────────────
  {
    name: "Anker 3-Port Charger",
    slug: "anker-3-port-charger",
    description:
      "Anker 3-port smart charger with AI power management and fast charging.",
    price: 29999,
    images: [CHARGER_IMG_1],
    category: "Chargers & Cables",
    stock: 80,
    sku: "EZW-ANK-001",
    variants: [],
    isActive: true,
  },
  {
    name: "AmazonBasics USB-C Cable",
    slug: "amazonbasics-usbc-cable",
    description:
      "AmazonBasics USB-C to USB-C cable with 2-meter length and 60W fast charging.",
    price: 15999,
    images: [CHARGER_IMG_2],
    category: "Chargers & Cables",
    stock: 200,
    sku: "EZW-AMZ-001",
    variants: ["1m", "2m", "3m"],
    isActive: true,
  },
  {
    name: "Apple MagSafe Charger",
    slug: "apple-magsafe-charger",
    description:
      "Apple MagSafe Charger with 15W fast wireless charging.",
    price: 69999,
    images: [CHARGER_IMG_3],
    category: "Chargers & Cables",
    stock: 45,
    sku: "EZW-APP-001",
    variants: ["White", "Blue", "Pink"],
    isActive: true,
  },
  {
    name: "Baseus Cable 3m",
    slug: "baseus-cable-3m",
    description:
      "Baseus 3-meter USB-C cable with nylon braided design and 100W fast charging.",
    price: 24999,
    images: [CHARGER_IMG_1],
    category: "Chargers & Cables",
    stock: 90,
    sku: "EZW-BAS-001",
    variants: ["Black", "White", "Gray"],
    isActive: true,
  },
  {
    name: "Anker 30W 3-Port Charger",
    slug: "anker-30w-3-port-charger",
    description:
      "Anker 30W 3-Port smart charger with AI power management.",
    price: 34999,
    images: [CHARGER_IMG_2],
    category: "Chargers & Cables",
    stock: 55,
    sku: "EZW-ANK-005",
    variants: ["Black", "White", "Gray"],
    isActive: true,
  },
  {
    name: "Anker Nano 20W USB-C Charger",
    slug: "anker-nano-20w-usb-c-charger",
    description:
      "Compact Anker Nano 20W USB-C charger with fast charging for iPhone and Android.",
    price: 14999,
    images: [CHARGER_IMG_3],
    category: "Chargers & Cables",
    stock: 130,
    sku: "EZW-ANK-006",
    variants: ["White", "Black"],
    isActive: true,
  },
  {
    name: "Belkin BoostCharge Braided Cable",
    slug: "belkin-boostcharge-braided-cable",
    description:
      "Belkin BoostCharge braided USB-C to USB-C cable with 2-meter length and 60W charging.",
    price: 11999,
    images: [CHARGER_IMG_1],
    category: "Chargers & Cables",
    stock: 160,
    sku: "EZW-BLK-001",
    variants: ["1m", "2m"],
    isActive: true,
  },
  {
    name: "UGREEN 65W GaN Fast Charger",
    slug: "ugreen-65w-gan-fast-charger",
    description:
      "UGREEN 65W GaN fast charger with two USB-C and one USB-A port for laptops and phones.",
    price: 44999,
    images: [CHARGER_IMG_2],
    category: "Chargers & Cables",
    stock: 70,
    sku: "EZW-UGR-001",
    variants: ["Black", "White"],
    isActive: true,
  },
  {
    name: "Anker 20W USB-C Power Adapter",
    slug: "anker-20w-usb-c-power-adapter",
    description:
      "Anker 20W USB-C power adapter with compact design and fast charging for iPhone and Android.",
    price: 17999,
    images: [CHARGER_IMG_3],
    category: "Chargers & Cables",
    stock: 110,
    sku: "EZW-ANK-008",
    variants: ["White", "Black"],
    specs: [
      { label: "Output", value: "20W USB-C Power Delivery" },
      { label: "Compatibility", value: "iPhone and Android USB-C devices" },
      { label: "Safety", value: "MultiProtect overcharge protection" },
      { label: "Note", value: "Cable sold separately" },
    ],
    isActive: true,
  },
  {
    name: "UGREEN 100W Braided USB-C Cable",
    slug: "ugreen-100w-braided-usb-c-cable",
    description:
      "UGREEN 100W braided USB-C to USB-C cable with E-marker chip for safe laptop and phone fast charging.",
    price: 21999,
    images: [CHARGER_IMG_2],
    category: "Chargers & Cables",
    stock: 140,
    sku: "EZW-UGR-002",
    variants: ["2m", "3m"],
    specs: [
      { label: "Length", value: "2m / 3m options" },
      { label: "Power", value: "100W (USB PD 3.0 with E-marker chip)" },
      { label: "Data", value: "USB 2.0, 480Mbps" },
      { label: "Material", value: "Nylon braided jacket" },
    ],
    isActive: true,
  },

  // ─── Power Banks ────────────────────────────────────────
  {
    name: "Anker PowerCore 10000",
    slug: "anker-powercore-10000",
    description:
      "Anker PowerCore 10000 mAh portable charger with dual USB output.",
    price: 45999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 60,
    sku: "EZW-ANK-002",
    variants: ["Black", "White", "Blue"],
    isActive: true,
  },
  {
    name: "Anker PowerCore 20000",
    slug: "anker-powercore-20000",
    description:
      "Anker PowerCore 20000 mAh portable charger with fast charging and LED display.",
    price: 85999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 40,
    sku: "EZW-ANK-003",
    variants: ["Black", "White", "Gray"],
    specs: [
      { label: "Capacity", value: "20000 mAh" },
      { label: "Output", value: "Up to 12W dual USB-A" },
      { label: "Display", value: "LED power percentage" },
      { label: "Ports", value: "2x USB-A output + 1x Micro-USB input" },
    ],
    isActive: true,
  },
  {
    name: "Philips Ego Charge",
    slug: "philips-ego-charge",
    description:
      "Philips Ego Charge portable charger with 10000 mAh and slim design.",
    price: 49999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 50,
    sku: "EZW-PHI-001",
    variants: ["Black", "White", "Blue"],
    isActive: true,
  },
  {
    name: "Anker PowerCore 26800",
    slug: "anker-powercore-26800",
    description:
      "Anker PowerCore 26800 mAh portable charger with triple USB output for heavy users.",
    price: 119999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 35,
    sku: "EZW-ANK-007",
    variants: ["Black", "White"],
    isActive: true,
  },
  {
    name: "Baseus 20000mAh Fast Charge Power Bank",
    slug: "baseus-20000mah-fast-charge-power-bank",
    description:
      "Baseus 20000 mAh power bank with 22.5W fast charging and digital LED display.",
    price: 54999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 55,
    sku: "EZW-BAS-002",
    variants: ["Black", "White"],
    isActive: true,
  },
  {
    name: "Samsung 10000mAh Wireless Power Bank",
    slug: "samsung-10000mah-wireless-power-bank",
    description:
      "Samsung 10000 mAh power bank with 15W wireless charging and USB-C fast charging.",
    price: 64999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 45,
    sku: "EZW-SAM-005",
    variants: ["Black", "White"],
    isActive: true,
  },
  {
    name: "Anker PowerCore Slim 10000",
    slug: "anker-powercore-slim-10000",
    description:
      "Anker PowerCore Slim 10000 mAh power bank with a pocket-friendly design and dual fast-charge output.",
    price: 39999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 70,
    sku: "EZW-ANK-009",
    variants: ["Black", "White"],
    specs: [
      { label: "Capacity", value: "10000 mAh" },
      { label: "Output", value: "Dual USB-A, up to 10.5W total" },
      { label: "Ports", value: "2x USB-A output + 1x Micro-USB input" },
      { label: "Weight", value: "~198 g" },
    ],
    isActive: true,
  },
  {
    name: "Xiaomi Mi Power Bank 3 (20000mAh)",
    slug: "xiaomi-mi-power-bank-3-20000mah",
    description:
      "Xiaomi Mi Power Bank 3 with 20000 mAh capacity, dual USB output, and 18W fast charging.",
    price: 49999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 60,
    sku: "EZW-XIA-001",
    variants: ["Black", "White"],
    specs: [
      { label: "Capacity", value: "20000 mAh" },
      { label: "Output", value: "Dual USB-A, up to 18W fast charge" },
      { label: "Ports", value: "2x USB-A output + 1x USB-C input" },
      { label: "Weight", value: "~436 g" },
    ],
    isActive: true,
  },
  {
    name: "Baseus 10000mAh Mini Power Bank",
    slug: "baseus-10000mah-mini-power-bank",
    description:
      "Baseus 10000 mAh mini power bank with digital LED display and 22.5W fast charging.",
    price: 34999,
    images: [POWERBANK_IMG],
    category: "Power Banks",
    stock: 85,
    sku: "EZW-BAS-003",
    variants: ["Black", "White", "Pink"],
    specs: [
      { label: "Capacity", value: "10000 mAh" },
      { label: "Output", value: "22.5W fast charge" },
      { label: "Display", value: "Digital LED percentage indicator" },
      { label: "Weight", value: "~170 g" },
    ],
    isActive: true,
  },

  // ─── Earphones & Headphones ─────────────────────────────
  {
    name: "Sony WF-1000XM4 Earbuds",
    slug: "sony-wf-1000xm4-earbuds",
    description:
      "Sony WF-1000XM4 wireless earbuds with noise cancellation and 8 hours battery life.",
    price: 199999,
    images: [EARPHONE_IMG_1],
    category: "Earphones & Headphones",
    stock: 35,
    sku: "EZW-SNY-001",
    variants: ["Black", "White", "Blue"],
    isActive: true,
  },
  {
    name: "Samsung Galaxy Buds2",
    slug: "samsung-galaxy-buds2",
    description:
      "Samsung Galaxy Buds2 wireless earbuds with ANC and comfortable fit.",
    price: 79999,
    images: [EARPHONE_IMG_2],
    category: "Earphones & Headphones",
    stock: 70,
    sku: "EZW-SAM-006",
    variants: ["Black", "Gray", "Pink"],
    isActive: true,
  },
  {
    name: "JBL TUNE 230NC Earbuds",
    slug: "jbl-tune-230nc-earbuds",
    description:
      "JBL TUNE 230NC true wireless earbuds with 40 hours battery life and ANC.",
    price: 89999,
    images: [EARPHONE_IMG_3],
    category: "Earphones & Headphones",
    stock: 65,
    sku: "EZW-JBL-001",
    variants: ["Black", "White", "Red"],
    isActive: true,
  },
  {
    name: "Anker Soundcore Life Q35",
    slug: "anker-soundcore-life-q35",
    description:
      "Anker Soundcore Life Q35 wireless headphones with active noise cancellation.",
    price: 79999,
    images: [EARPHONE_IMG_1],
    category: "Earphones & Headphones",
    stock: 45,
    sku: "EZW-ANK-004",
    variants: ["Black", "Blue", "White"],
    isActive: true,
  },
  {
    name: "Apple AirPods Pro 2",
    slug: "apple-airpods-pro-2",
    description:
      "Apple AirPods Pro 2 with active noise cancellation, adaptive transparency, and USB-C charging case.",
    price: 429999,
    images: [EARPHONE_IMG_2],
    category: "Earphones & Headphones",
    stock: 25,
    sku: "EZW-APP-002",
    variants: ["White"],
    isActive: true,
  },
  {
    name: "JBL Tune 510BT Headphones",
    slug: "jbl-tune-510bt-headphones",
    description:
      "JBL Tune 510BT on-ear wireless headphones with JBL Pure Bass sound and 40 hours battery.",
    price: 89999,
    images: [EARPHONE_IMG_3],
    category: "Earphones & Headphones",
    stock: 60,
    sku: "EZW-JBL-002",
    variants: ["Black", "Blue", "White"],
    isActive: true,
  },
  {
    name: "Sony WH-1000XM5 Headphones",
    slug: "sony-wh-1000xm5-headphones",
    description:
      "Sony WH-1000XM5 wireless headphones with industry-leading noise cancellation and 30 hours battery.",
    price: 499999,
    images: [CLOUD_HEADPHONE_BLACK],
    category: "Earphones & Headphones",
    stock: 20,
    sku: "EZW-SNY-002",
    variants: [
      { sku: "EZW-SNY-002-BLK", attributes: { color: "Black" }, stock: 12, images: [CLOUD_HEADPHONE_BLACK] },
      { sku: "EZW-SNY-002-SLV", attributes: { color: "Silver" }, stock: 8, images: [CLOUD_CASE_GRAY] },
    ],
    gallery: {
      images: [CLOUD_HEADPHONE_BLACK, CLOUD_CASE_GRAY],
      videos: [CLOUD_GALLERY_VIDEO],
    },
    isActive: true,
  },
  {
    name: "JBL Tune 770NC Headphones",
    slug: "jbl-tune-770nc-headphones",
    description:
      "JBL Tune 770NC wireless headphones with adaptive noise cancelling and 70 hours of battery life.",
    price: 119999,
    images: [EARPHONE_IMG_3],
    category: "Earphones & Headphones",
    stock: 40,
    sku: "EZW-JBL-003",
    variants: ["Black", "White", "Blue"],
    specs: [
      { label: "Battery", value: "Up to 70 hours (ANC off)" },
      { label: "Connectivity", value: "Bluetooth 5.3, multipoint pairing" },
      { label: "Noise Cancelling", value: "Adaptive ANC" },
      { label: "Drivers", value: "40mm dynamic" },
    ],
    isActive: true,
  },
  {
    name: "Anker Soundcore Space A40",
    slug: "anker-soundcore-space-a40",
    description:
      "Anker Soundcore Space A40 wireless earbuds with adaptive ANC, 50 hours total battery, and LDAC support.",
    price: 99999,
    images: [EARPHONE_IMG_1],
    category: "Earphones & Headphones",
    stock: 50,
    sku: "EZW-ANK-010",
    variants: ["Black", "White"],
    specs: [
      { label: "Battery", value: "50 hours total (with charging case)" },
      { label: "Connectivity", value: "Bluetooth 5.2 with LDAC support" },
      { label: "Noise Cancelling", value: "Adaptive ANC" },
      { label: "Weight", value: "4.4 g per earbud" },
    ],
    isActive: true,
  },

  // ─── Screen Protectors (placeholder images kept) ────────
  {
    name: "Spigen Tempered Glass Screen Protector",
    slug: "spigen-tempered-glass-screen-protector",
    description:
      "Spigen 9H tempered glass screen protector with oleophobic coating and easy install kit.",
    price: 8999,
    images: [placeholder("Spigen Glass Protector")],
    category: "Screen Protectors",
    stock: 250,
    sku: "EZW-SPG-003",
    variants: ["iPhone 15 Pro", "iPhone 15 Pro Max", "Galaxy S24"],
    specs: [
      { label: "Hardness", value: "9H tempered glass" },
      { label: "Thickness", value: "0.33 mm" },
      { label: "Compatibility", value: "iPhone 15 / Galaxy S24 (model specific)" },
      { label: "Extras", value: "Oleophobic coating + easy-install kit" },
    ],
    isActive: true,
  },
  {
    name: "Supershieldz Tempered Glass Screen Protector",
    slug: "supershieldz-tempered-glass-screen-protector",
    description:
      "Supershieldz tempered glass screen protector with scratch resistance and bubble-free adhesion.",
    price: 7999,
    images: [placeholder("Supershieldz Protector")],
    category: "Screen Protectors",
    stock: 300,
    sku: "EZW-SUP-002",
    variants: ["iPhone 15", "iPhone 14", "Galaxy S24"],
    isActive: true,
  },
  {
    name: "ESR Screen Protector 2-Pack",
    slug: "esr-screen-protector-2-pack",
    description:
      "ESR screen protector 2-pack with auto-alignment frame and military-grade protection.",
    price: 11999,
    images: [placeholder("ESR Protector 2-Pack")],
    category: "Screen Protectors",
    stock: 180,
    sku: "EZW-ESR-002",
    variants: ["iPhone 15 Pro", "Galaxy S24 Ultra"],
    isActive: true,
  },
  {
    name: "iCarez Screen Protector for iPhone 15",
    slug: "icarez-screen-protector-iphone-15",
    description:
      "iCarez tempered glass screen protector for iPhone 15 series with 9H hardness and oleophobic coating.",
    price: 6999,
    images: [placeholder("iCarez Protector")],
    category: "Screen Protectors",
    stock: 220,
    sku: "EZW-ICA-001",
    variants: ["iPhone 15", "iPhone 15 Pro", "iPhone 15 Pro Max"],
    specs: [
      { label: "Hardness", value: "9H tempered glass" },
      { label: "Thickness", value: "0.33 mm" },
      { label: "Compatibility", value: "iPhone 15 series (model specific)" },
      { label: "Coating", value: "Oleophobic anti-fingerprint" },
    ],
    isActive: true,
  },
  {
    name: "Flasfit Tempered Glass for Samsung S24",
    slug: "flasfit-tempered-glass-samsung-s24",
    description:
      "Flasfit tempered glass screen protector for Samsung Galaxy S24 series with an easy-fit alignment tray.",
    price: 7499,
    images: [placeholder("Flasfit Protector")],
    category: "Screen Protectors",
    stock: 210,
    sku: "EZW-FLA-001",
    variants: ["Galaxy S24", "Galaxy S24+", "Galaxy S24 Ultra"],
    specs: [
      { label: "Hardness", value: "9H tempered glass" },
      { label: "Compatibility", value: "Galaxy S24 series (model specific)" },
      { label: "Install", value: "Alignment tray included" },
      { label: "Coverage", value: "Edge-to-edge, curve-friendly" },
    ],
    isActive: true,
  },
  {
    name: "Whitestone Dome Glass (iPhone 15 Pro Max)",
    slug: "whitestone-dome-glass-iphone-15-pro-max",
    description:
      "Whitestone Dome Glass with UV-cured adhesive for edge-to-edge coverage on iPhone 15 Pro Max.",
    price: 29999,
    images: [placeholder("Whitestone Dome Glass")],
    category: "Screen Protectors",
    stock: 40,
    sku: "EZW-WHI-001",
    variants: ["iPhone 15 Pro Max"],
    specs: [
      { label: "Technology", value: "UV-cured LOCA adhesive" },
      { label: "Coverage", value: "Edge-to-edge, no black border" },
      { label: "Hardness", value: "9H tempered glass" },
      { label: "Install", value: "Full kit with UV lamp" },
    ],
    isActive: true,
  },
  {
    name: "Belkin UltraGlass Screen Protector",
    slug: "belkin-ultraglass-screen-protector",
    description:
      "Belkin UltraGlass screen protector with chemically strengthened glass and 2x drop protection.",
    price: 13999,
    images: [placeholder("Belkin UltraGlass")],
    category: "Screen Protectors",
    stock: 150,
    sku: "EZW-BLK-002",
    variants: ["iPhone 15", "iPhone 14", "Galaxy S24"],
    specs: [
      { label: "Material", value: "Chemically strengthened glass" },
      { label: "Drop Protection", value: "2x stronger than standard glass" },
      { label: "Compatibility", value: "iPhone 15 / 14, Galaxy S24 (model specific)" },
      { label: "Finish", value: "Oleophobic + anti-glare" },
    ],
    isActive: true,
  },
];

// Legacy `variants: ["Black","Blue"]` label arrays → structured variants
// (Decision #1). Each label becomes its own SKU with a share of the product's
// stock; the attribute key is per product (storage/color/length/model). Kept
// as a transform so the seed stays readable — PRODUCTS is exported and seeded
// already-structured, so the DB rows, tests and API all see the new shape.
// Products whose variants are already structured (the Phase 4 showcase) pass
// through untouched.
const VARIANT_ATTR = {
  "iphone-15-pro-max-1tb": "storage",
  "iphone-15-pro-512gb": "storage",
  "iphone-15-pro-256gb": "storage",
  "iphone-15-256gb": "storage",
  "samsung-galaxy-s24-ultra-512gb": "storage",
  "samsung-galaxy-s24-256gb": "storage",
  "samsung-galaxy-s24-128gb": "storage",
  "samsung-galaxy-s23-fe-128gb": "storage",
  "iphone-15-plus-256gb": "storage",
  "amazonbasics-usbc-cable": "length",
  "belkin-boostcharge-braided-cable": "length",
  "ugreen-100w-braided-usb-c-cable": "length",
  "spigen-tempered-glass-screen-protector": "model",
  "supershieldz-tempered-glass-screen-protector": "model",
  "esr-screen-protector-2-pack": "model",
  "icarez-screen-protector-iphone-15": "model",
  "flasfit-tempered-glass-samsung-s24": "model",
  "whitestone-dome-glass-iphone-15-pro-max": "model",
  "belkin-ultraglass-screen-protector": "model",
};

const variantCode = (label) =>
  String(label)
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase() || "VAR";

const splitStock = (total, n, i) => {
  const base = Math.floor(total / n);
  return i === n - 1 ? base + (total - base * n) : base;
};

const toStructuredVariants = (product) => {
  if (!Array.isArray(product.variants) || product.variants.length === 0) return;
  if (product.variants[0] && typeof product.variants[0] === "object") return;
  const attr = VARIANT_ATTR[product.slug] || "color";
  const labels = product.variants;
  const total = Number(product.stock) || 0;
  const used = new Set();
  product.variants = labels.map((label, i) => {
    // Normalizing labels can collide (e.g. "Galaxy S24" vs "Galaxy S24+") —
    // append an index to any repeat so variant SKUs stay unique per product.
    let code = variantCode(label);
    if (used.has(code)) code = `${code}-${i + 1}`;
    used.add(code);
    return {
      sku: `${product.sku || "EZW"}-${code}`,
      attributes: { [attr]: label },
      stock: splitStock(total, labels.length, i),
      images: [],
    };
  });
};

PRODUCTS.forEach(toStructuredVariants);

const DELIVERY_ZONES = [
  {
    name: "Accra Central",
    fee: 1500,
    estimatedDays: 1,
    isActive: true,
  },
  {
    name: "Greater Accra",
    fee: 3000,
    estimatedDays: 2,
    isActive: true,
  },
  {
    name: "Outside Accra",
    fee: 8000,
    estimatedDays: 4,
    isActive: true,
  },
];

// Non-iPhone / non-Samsung phones removed from the catalog (archived, not deleted).
// Kept by slug so re-running the seed stays idempotent.
const REMOVED_PHONE_SLUGS = [
  "xiaomi-black-shark-5-pro",
  "oppo-reno8",
  "realme-gt2",
  "oneplus-nord-3",
  "itel-s23",
  "realme-c55",
];

// Miscategorized products that are not earphones/headphones.
const MISCATEGORIZED_SLUGS = ["xiaomi-mi-band-8", "oculus-quest-2"];

// Pre-pivot service products that don't belong to any current shop
// category (archived so /shop "All Products" only shows phone accessories).
const SERVICE_PRODUCT_SLUGS = [
  "custom-logo-design",
  "website-audit-seo-report",
  "social-media-starter-kit",
  "ecommerce-store-setup",
];

async function seed() {
  const db = resolveDbUrl();
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");

  const productOps = PRODUCTS.map((p) => ({
    updateOne: {
      filter: { slug: p.slug },
      update: { $set: p },
      upsert: true,
    },
  }));
  const productResult = await Product.bulkWrite(productOps);
  console.log(
    `Products — ${productResult.upsertedCount} inserted, ${productResult.modifiedCount} updated, ${productResult.matchedCount} matched`,
  );

  const zoneOps = DELIVERY_ZONES.map((z) => ({
    updateOne: {
      filter: { name: z.name },
      update: { $set: z },
      upsert: true,
    },
  }));
  const zoneResult = await DeliveryZone.bulkWrite(zoneOps);
  console.log(
    `Delivery zones — ${zoneResult.upsertedCount} inserted, ${zoneResult.modifiedCount} updated, ${zoneResult.matchedCount} matched`,
  );

  // Rule-based archive: any active product in "Phones" that is not an
  // iPhone or Samsung Galaxy model is archived (isActive: false).
  const phoneArchive = await Product.updateMany(
    {
      category: "Phones",
      isActive: true,
      name: { $not: /^(iPhone|Samsung Galaxy)/ },
    },
    { $set: { isActive: false } },
  );
  console.log(
    `Archived non-iPhone/Samsung Phones — ${phoneArchive.modifiedCount} updated`,
  );

  // Targeted archive for miscategorized products removed from the catalog.
  const miscArchive = await Product.updateMany(
    {
      slug: {
        $in: [
          ...REMOVED_PHONE_SLUGS,
          ...MISCATEGORIZED_SLUGS,
          ...SERVICE_PRODUCT_SLUGS,
        ],
      },
      isActive: true,
    },
    { $set: { isActive: false } },
  );
  console.log(
    `Archived removed/miscategorized products — ${miscArchive.modifiedCount} updated`,
  );

  const productCount = await Product.countDocuments({ isActive: true });
  const zoneCount = await DeliveryZone.countDocuments();
  const phoneBrandCount = await Product.countDocuments({
    category: "Phones",
    isActive: true,
  });
  console.log(
    `Totals — Active products: ${productCount}, Active Phones: ${phoneBrandCount}, Delivery zones: ${zoneCount}`,
  );

  await mongoose.connection.close();
  console.log("Seed complete");
}

// Guarded so tests and other seeders can `require` the catalog data without
// triggering a DB run.
if (require.main === module) {
  dotenv.config({ path: "./.env" });
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}

module.exports = {
  PRODUCTS,
  DELIVERY_ZONES,
  REMOVED_PHONE_SLUGS,
  MISCATEGORIZED_SLUGS,
  SERVICE_PRODUCT_SLUGS,
};
