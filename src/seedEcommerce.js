const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const DeliveryZone = require("../models/DeliveryZone");

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
// Extra angles so every product has more than one image (verified to resolve).
const IPHONE_IMG_3 =
  "https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=800&q=80";
const SAMSUNG_IMG_2 =
  "https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=800&q=80";
const SAMSUNG_IMG_3 =
  "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=800&q=80";
const CASE_IMG_3 =
  "https://images.unsplash.com/photo-1592286927505-1def25115558?w=800&q=80";
const POWERBANK_IMG_2 =
  "https://images.unsplash.com/photo-1585060544812-6b45742d762f?w=800&q=80";
const POWERBANK_IMG_3 =
  "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=800&q=80";
const SCREEN_IMG_1 =
  "https://images.unsplash.com/photo-1512054502232-10a0a035d672?w=800&q=80";
const SCREEN_IMG_2 =
  "https://images.unsplash.com/photo-1546027658-7aa750153465?w=800&q=80";

const placeholder = (text) =>
  `https://placehold.co/800x600/1e1b4b/ffffff?text=${encodeURIComponent(text)}`;

const PRODUCTS = [
  // ─── Phones (iPhone + Samsung Galaxy only) ───────────────
  {
    name: "iPhone 15 Pro Max (1TB)",
    slug: "iphone-15-pro-max-1tb",
    description:
      "Apple iPhone 15 Pro Max with 48MP camera system, A17 Pro chip, 6.7-inch Super Retina XDR display, and surgical-grade titanium design.",
    price: 1299999,
    images: [IPHONE_IMG_1, IPHONE_IMG_2, IPHONE_IMG_3],
    category: "Phones",
    stock: 20,
    sku: "EZW-IPH-001",
    variants: ["256GB", "512GB", "1TB"],
    isActive: true,
  },
  {
    name: "iPhone 15 Pro (512GB)",
    slug: "iphone-15-pro-512gb",
    description:
      "Apple iPhone 15 Pro with 48MP main camera, A17 Pro chip, and advanced titanium frame design.",
    price: 1099999,
    images: [IPHONE_IMG_2, IPHONE_IMG_3, IPHONE_IMG_1],
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
    images: [IPHONE_IMG_1, IPHONE_IMG_2, IPHONE_IMG_3],
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
    images: [IPHONE_IMG_2, IPHONE_IMG_3, IPHONE_IMG_1],
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
    images: [SAMSUNG_IMG, SAMSUNG_IMG_2, SAMSUNG_IMG_3],
    category: "Phones",
    stock: 30,
    sku: "EZW-SAM-001",
    variants: ["256GB", "512GB", "1TB"],
    isActive: true,
  },
  {
    name: "Samsung Galaxy S24+ (256GB)",
    slug: "samsung-galaxy-s24-256gb",
    description:
      "Samsung Galaxy S24+ with Dynamic AMOLED 2X display, Snapdragon 8 Gen 3, and enhanced camera system.",
    price: 899999,
    images: [SAMSUNG_IMG, SAMSUNG_IMG_2, SAMSUNG_IMG_3],
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
    images: [SAMSUNG_IMG, SAMSUNG_IMG_2, SAMSUNG_IMG_3],
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
    images: [SAMSUNG_IMG, SAMSUNG_IMG_2, SAMSUNG_IMG_3],
    category: "Phones",
    stock: 45,
    sku: "EZW-SAM-004",
    variants: ["128GB", "256GB", "512GB"],
    isActive: true,
  },

  // ─── Phone Cases & Covers ────────────────────────────────
  {
    name: "Spigen Tough Armor Case",
    slug: "spigen-tough-armor-case",
    description:
      "Durable Spigen Tough Armor case with shock absorption and elegant design.",
    price: 15999,
    images: [CASE_IMG_1, CASE_IMG_2, CASE_IMG_3],
    category: "Phone Cases & Covers",
    stock: 150,
    sku: "EZW-SPG-001",
    variants: ["Black", "Blue", "White"],
    isActive: true,
  },
  {
    name: "Supcase Universal Case",
    slug: "supcase-universal-case",
    description:
      "Supcase Universal case with built-in kickstand and shockproof protection.",
    price: 12999,
    images: [CASE_IMG_2, CASE_IMG_3, CASE_IMG_1],
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
    images: [CASE_IMG_1, CASE_IMG_2, CASE_IMG_3],
    category: "Phone Cases & Covers",
    stock: 200,
    sku: "EZW-OLI-001",
    variants: ["Clear", "Blue", "Pink"],
    isActive: true,
  },
  {
    name: "Nillkin Hard Case",
    slug: "nillkin-hard-case",
    description:
      "Nillkin Hard case with kickstand and shockproof protection for iPhone.",
    price: 18999,
    images: [CASE_IMG_2, CASE_IMG_3, CASE_IMG_1],
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
    images: [CASE_IMG_1, CASE_IMG_2, CASE_IMG_3],
    category: "Phone Cases & Covers",
    stock: 40,
    sku: "EZW-UAG-001",
    variants: ["Black", "Camouflage", "Red"],
    isActive: true,
  },
  {
    name: "Moshi Syber Case",
    slug: "moshi-syber-case",
    description:
      "Moshi Syber case with modular design and antimicrobial protection.",
    price: 34999,
    images: [CASE_IMG_2, CASE_IMG_3, CASE_IMG_1],
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
    images: [CASE_IMG_1, CASE_IMG_2, CASE_IMG_3],
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
    images: [CASE_IMG_2, CASE_IMG_3, CASE_IMG_1],
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
    images: [CASE_IMG_1, CASE_IMG_2, CASE_IMG_3],
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
    images: [CASE_IMG_2, CASE_IMG_3, CASE_IMG_1],
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
    images: [CASE_IMG_1, CASE_IMG_2, CASE_IMG_3],
    category: "Phone Cases & Covers",
    stock: 75,
    sku: "EZW-LAM-001",
    variants: ["Black", "Brown", "Navy"],
    isActive: true,
  },

  // ─── Chargers & Cables ──────────────────────────────────
  {
    name: "Anker 3-Port Charger",
    slug: "anker-3-port-charger",
    description:
      "Anker 3-port smart charger with AI power management and fast charging.",
    price: 29999,
    images: [CHARGER_IMG_1, CHARGER_IMG_2, CHARGER_IMG_3],
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
    images: [CHARGER_IMG_2, CHARGER_IMG_3, CHARGER_IMG_1],
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
    images: [CHARGER_IMG_3, CHARGER_IMG_1, CHARGER_IMG_2],
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
    images: [CHARGER_IMG_1, CHARGER_IMG_2, CHARGER_IMG_3],
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
    images: [CHARGER_IMG_2, CHARGER_IMG_3, CHARGER_IMG_1],
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
    images: [CHARGER_IMG_3, CHARGER_IMG_1, CHARGER_IMG_2],
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
    images: [CHARGER_IMG_1, CHARGER_IMG_2, CHARGER_IMG_3],
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
    images: [CHARGER_IMG_2, CHARGER_IMG_3, CHARGER_IMG_1],
    category: "Chargers & Cables",
    stock: 70,
    sku: "EZW-UGR-001",
    variants: ["Black", "White"],
    isActive: true,
  },

  // ─── Power Banks ────────────────────────────────────────
  {
    name: "Anker PowerCore 10000",
    slug: "anker-powercore-10000",
    description:
      "Anker PowerCore 10000 mAh portable charger with dual USB output.",
    price: 45999,
    images: [POWERBANK_IMG, POWERBANK_IMG_2, POWERBANK_IMG_3],
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
    images: [POWERBANK_IMG, POWERBANK_IMG_2, POWERBANK_IMG_3],
    category: "Power Banks",
    stock: 40,
    sku: "EZW-ANK-003",
    variants: ["Black", "White", "Gray"],
    isActive: true,
  },
  {
    name: "Philips Ego Charge",
    slug: "philips-ego-charge",
    description:
      "Philips Ego Charge portable charger with 10000 mAh and slim design.",
    price: 49999,
    images: [POWERBANK_IMG, POWERBANK_IMG_2, POWERBANK_IMG_3],
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
    images: [POWERBANK_IMG, POWERBANK_IMG_2, POWERBANK_IMG_3],
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
    images: [POWERBANK_IMG, POWERBANK_IMG_2, POWERBANK_IMG_3],
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
    images: [POWERBANK_IMG, POWERBANK_IMG_2, POWERBANK_IMG_3],
    category: "Power Banks",
    stock: 45,
    sku: "EZW-SAM-005",
    variants: ["Black", "White"],
    isActive: true,
  },

  // ─── Earphones & Headphones ─────────────────────────────
  {
    name: "Sony WF-1000XM4 Earbuds",
    slug: "sony-wf-1000xm4-earbuds",
    description:
      "Sony WF-1000XM4 wireless earbuds with noise cancellation and 8 hours battery life.",
    price: 199999,
    images: [EARPHONE_IMG_1, EARPHONE_IMG_2, EARPHONE_IMG_3],
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
    images: [EARPHONE_IMG_2, EARPHONE_IMG_3, EARPHONE_IMG_1],
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
    images: [EARPHONE_IMG_3, EARPHONE_IMG_1, EARPHONE_IMG_2],
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
    images: [EARPHONE_IMG_1, EARPHONE_IMG_2, EARPHONE_IMG_3],
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
    images: [EARPHONE_IMG_2, EARPHONE_IMG_3, EARPHONE_IMG_1],
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
    images: [EARPHONE_IMG_3, EARPHONE_IMG_1, EARPHONE_IMG_2],
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
    images: [EARPHONE_IMG_1, EARPHONE_IMG_2, EARPHONE_IMG_3],
    category: "Earphones & Headphones",
    stock: 20,
    sku: "EZW-SNY-002",
    variants: ["Black", "Silver"],
    isActive: true,
  },

  // ─── Screen Protectors (placeholder images kept) ────────
  {
    name: "Spigen Tempered Glass Screen Protector",
    slug: "spigen-tempered-glass-screen-protector",
    description:
      "Spigen 9H tempered glass screen protector with oleophobic coating and easy install kit.",
    price: 8999,
    images: [SCREEN_IMG_1, SCREEN_IMG_2, placeholder("Spigen Glass Protector")],
    category: "Screen Protectors",
    stock: 250,
    sku: "EZW-SPG-003",
    variants: ["iPhone 15 Pro", "iPhone 15 Pro Max", "Galaxy S24"],
    isActive: true,
  },
  {
    name: "Supershieldz Tempered Glass Screen Protector",
    slug: "supershieldz-tempered-glass-screen-protector",
    description:
      "Supershieldz tempered glass screen protector with scratch resistance and bubble-free adhesion.",
    price: 7999,
    images: [SCREEN_IMG_2, SCREEN_IMG_1, placeholder("Supershieldz Protector")],
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
    images: [SCREEN_IMG_1, SCREEN_IMG_2, placeholder("ESR Protector 2-Pack")],
    category: "Screen Protectors",
    stock: 180,
    sku: "EZW-ESR-002",
    variants: ["iPhone 15 Pro", "Galaxy S24 Ultra"],
    isActive: true,
  },
];

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

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
