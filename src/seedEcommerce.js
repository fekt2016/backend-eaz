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

// Screen protector images — hotlinked from official brand stores / CDNs
// (IMAGES_VARIANTS_TASK.md Decision #2: no re-hosting; onError fallback
// handles any future breakage).
const SPIGEN_PROTECTOR_IMG =
  "https://www.spigen.com/cdn/shop/files/title_web_ip6.7p_glas_tr_ezfit_privacy_02.jpg?v=1695762562";
const SUPERSHIELDZ_PROTECTOR_IMG =
  "https://m.media-amazon.com/images/I/61NMwjPBaLL._AC_SL1500_.jpg";
const ESR_PROTECTOR_IMG =
  "https://www.esrtech.com/cdn/shop/files/iPhone-17-Pro-Max-UltraFit-Armoriter_-Screen-Protector-2-Pack-ESR-240689570.jpg?v=1783011407";
const ICAREZ_PROTECTOR_IMG =
  "https://m.media-amazon.com/images/I/717JbmVrqUL._AC_SL1500_.jpg";
const FLASFIT_PROTECTOR_IMG =
  "https://www.safesleevecases.com/cdn/shop/files/clear_screen_protector_samsung_0d75c230-f1c1-4bf0-8828-33cb8e463553.jpg?v=1752092506";
const WHITESTONE_PROTECTOR_IMG =
  "https://cdn.shopify.com/s/files/1/0089/7843/2096/files/2023-10-23_161747_600x600.png?v=1698046305";
const BELKIN_PROTECTOR_IMG =
  "https://www.belkin.com/dw/image/v2/BGBH_PRD/on/demandware.static/-/Sites-master-product-catalog-blk/default/dw8542938d/images/hi-res/4/137647988_belkin-OVA104zz-screenforce-ultraglass-treated-screen-protector-for-iphone-14-pro-max-amazon-gg1-v01-r01-1600x1600-us.jpg?sw=800&sh=800&sm=fit&sfrm=jpg";

// Power bank images — hotlinked from official brand stores / CDNs
// (IMAGES_VARIANTS_TASK.md Decision #2: no re-hosting; onError fallback
// handles any future breakage).
const ANKER_POWERBANK_10000_IMG =
  "https://cdn.shopify.com/s/files/1/0595/4034/0926/products/A1263011.jpg?v=1654744958";
const ANKER_POWERBANK_20000_IMG =
  "https://phonesstorekenya.com/wp-content/uploads/2022/09/Anker-PowerCore-20000-mAh-Powerbank.jpg";
const PHILIPS_POWERBANK_IMG =
  "https://www.shopyvision.com/wp-content/uploads/2024/03/Philips-DLP10006-10000MAH-Power-Bank.jpg";
const ANKER_POWERBANK_26800_IMG =
  "https://cdn.shopify.com/s/files/1/0595/4034/0926/products/pc6.jpg?v=1687942176";
const BASEUS_POWERBANK_20000_IMG =
  "https://eu.baseus.com/cdn/shop/files/Baseus_Qpow2_Power_Bank_22.5W_20000mAh_800x.jpg?v=1706581719";
const SAMSUNG_POWERBANK_IMG =
  "https://images.samsung.com/is/image/samsung/p6pim/in/eb-u2510xuegin/gallery/in-wireless-battery-pack-10000mah-eb-u2510-eb-u2510xuegin-541527841?%241164_776_PNG%24";
const ANKER_POWERBANK_SLIM_IMG =
  "https://techhouse.sg/cdn/shop/files/sg-11134201-7qvej-lgkgkixveebk75.jpg?v=1721209718&width=1024";
const XIAOMI_POWERBANK_20000_IMG =
  "https://i0.wp.com/truststore.pk/wp-content/uploads/2024/06/image-9.jpg?fit=1000%2C1000&ssl=1";
const BASEUS_POWERBANK_MINI_IMG =
  "https://hypervolt.in/cdn/shop/files/superminipowerbank.jpg?v=1781797787";

// Earphones & headphones images — hotlinked from official brand stores / CDNs
// (IMAGES_VARIANTS_TASK.md Decision #2: no re-hosting; onError fallback
// handles any future breakage).
const SONY_EARBUDS_1000XM4_IMG =
  "https://cdn.ecoustics.com/db0/wblob/17BA35E873D594/27F9/41D8A/LbPPKRs5Zxn4GpHROeQXrvMLx_STq3_zNGSqeqTXt1c/sony-wf-1000xm4-wireless-earphones-listen-lifestyle.jpg";
const SAMSUNG_BUDS2_IMG =
  "https://target.scene7.com/is/image/Target/GUEST_5f1eb8fb-cd8e-4205-a94d-d8f2087f99b7?wid=800&hei=800&qlt=80&fmt=pjpeg";
const JBL_230NC_IMG =
  "https://in.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwaa43ee65/1.JBL_TUNE_230NC_Product%20image_Hero_Blue.png?sw=535&sh=535";
const SOUNDCORE_LIFE_Q35_IMG =
  "https://cdn.shopify.com/s/files/1/0516/3761/6830/products/1_7eb8a2c3-590c-4f4e-afcc-688dc287cf70.jpg?v=1643362487";
const AIRPODS_PRO_2_IMG =
  "https://www.apple.com/newsroom/images/2023/09/apple-introduces-new-airpods-pro-2nd-generation/tile/Apple-AirPods-Pro-2nd-generation-USB-C-connection-230912.jpg.og.jpg?202605201554";
const JBL_510BT_IMG =
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw45a05bde/JBL_TUNE_510BT_Product%20Image_Hero_Black.png?sw=535&sh=535";
const SONY_WH_1000XM5_IMG =
  "https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6505/6505727_rd.jpg;maxHeight=1920;maxWidth=900?format=webp";
const JBL_770NC_IMG =
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwb041313a/1.JBL_Tune_770NC_Product%20Image_Hero_Blue.png?sw=535&sh=535";
const SOUNDCORE_SPACE_A40_IMG =
  "https://cdn.shopify.com/s/files/1/0516/3761/6830/files/A3936012.png?v=1749638951";

// Phone cases & covers images — hotlinked from official brand stores / CDNs.
const SPIGEN_TOUGH_ARMOR_IMG =
  "https://partners.spigen.com/cdn/shop/files/title_web_ip16_tougharmor_black_01.jpg?v=1725899076";
const SUPCASE_UB_PRO_IMG =
  "https://supcase.com/cdn/shop/files/SUPCASE_iPhone_17_Pro_Max_Unicorn_Beetle_Pro_Rugged_phone_case_Black_12.webp?v=1764571953";
const OLIXAR_CLEAR_IMG =
  "https://images.mobilefun.co.uk/graphics/450pixelp/85801.jpg";
const NILLKIN_SHIELD_PRO_IMG =
  "https://www.nillkin.com/cdn/shop/files/Super-Frosted-Shield-Pro-Case-for-iPhone-17ProMax-black_1.jpg?v=1757496506";
const UAG_MONARCH_PRO_IMG =
  "https://images.ctfassets.net/9hslf09drsil/3tvPNiiZsNb2KkLrElx77X/c10cb0ab5a3986593d87e6206e7127df/UAG_Studio-HQ_092425_iPhone17_Monarch-Pro_Derrick_1721692.jpg?w=1200&fm=jpg&q=70";
const MOSHI_IGLAZE_IMG =
  "https://us.moshi.com/cdn/shop/files/1000_3.jpg?v=1725955626";
const SPIGEN_LIQUID_CRYSTAL_IMG =
  "https://partners.spigen.com/cdn/shop/files/title_web_ip6.1p_2023__liquidcrystal_cc_01_b19e9626-7c86-4600-8295-a6dd7dcb1d65.jpg?v=1773434601";
const NILLKIN_AIR_IMG =
  "https://nillkin.org/image/cache/data/product-5287/1-800x800.jpg";
const RINGKE_ONYX_IMG =
  "https://www.ringkestore.com/cdn/shop/files/IP17_ONX_ALL_Main.jpg?v=1756841244";
const ESR_SHOCKPROOF_IMG =
  "https://www.esrtech.com/cdn/shop/files/iPhone-16-Pro-Cyber-Tough-Case-with-Stand-Magsafe-Green-1.jpg?v=1741853155";
const LAMICALL_CASE_IMG =
  "https://lamicallshop.com/cdn/shop/products/AL01-_-min.jpg?v=1676456489";
const OTTERBOX_DEFENDER_IMG =
  "https://images.mobilefun.co.uk/graphics/450pixelp/97461.jpg";
const SPIGEN_ULTRA_HYBRID_IMG =
  "https://partners.spigen.com/cdn/shop/files/title_web_iphone17_pro_ultra_hybrid_cc_01.jpg?v=1773445003";

// Chargers & cables images — hotlinked from official brand stores / CDNs.
const ANKER_3PORT_IMG =
  "https://www.tanotis.com/cdn/shop/files/1753713586_1907766_1024x.jpg?v=1765916288";
const AMAZONBASICS_USBC_IMG =
  "https://d3gqasl9vmjfd8.cloudfront.net/a3adc08d-bc59-4b49-861a-5d8d2c86ed08.png";
const APPLE_MAGSAFE_IMG =
  "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/MGD74?wid=1000&hei=1000&fmt=jpeg&qlt=95&.v=1755025001125";
const BASEUS_USBC_IMG =
  "https://www.baseus.com/cdn/shop/products/Baseus_USB-C_to_USB-C_Cable_100W_3.3ft_1_front.jpg?v=1667906429";
const ANKER_30W_IMG =
  "https://cdn.shopify.com/s/files/1/0493/9834/9974/files/SKU-04-Phantom_Black.png?v=1764228261";
const ANKER_NANO_20W_IMG =
  "https://cdn.shopify.com/s/files/1/0493/9834/9974/files/A2637126_TD05_V1-1280x1280.jpg?v=1756201952";
const BELKIN_BOOSTCHARGE_IMG =
  "https://www.belkin.com/dw/image/v2/BGBH_PRD/on/demandware.static/-/Sites-master-product-catalog-blk/default/dw3b2be774/images/hi-res/6/6e81fbb07dda0115_CAB004BT0M-BLK_BoostCharge_USB-C_to_USB-C_Gallery_Shot_03_WEB.jpg?sw=700&sh=700&sm=fit&sfrm=png";
const UGREEN_65W_IMG =
  "https://us.ugreen.com/cdn/shop/products/ugreen-nexode-65w-usb-c-gan-charger-3-ports-wall-charger-276386.png?v=1764234605";
const ANKER_20W_ADAPTER_IMG =
  "https://m.media-amazon.com/images/I/51UCIcDXQaS._AC_SL1500_.jpg";
const UGREEN_100W_IMG =
  "https://us.ugreen.com/cdn/shop/products/ugreen-usb-c-to-usb-c-100w-fast-cable-2-pack-131955.png?v=1692873952";

// Phone images — hotlinked from Apple Newsroom / Samsung official CDNs.
const IPHONE_15_PRO_IMG =
  "https://www.apple.com/newsroom/images/2023/09/apple-unveils-iphone-15-pro-and-iphone-15-pro-max/article/Apple-iPhone-15-Pro-lineup-hero-230912_Full-Bleed-Image.jpg.large.jpg";
const IPHONE_15_PRO_TILE_IMG =
  "https://www.apple.com/newsroom/images/2023/09/apple-unveils-iphone-15-pro-and-iphone-15-pro-max/tile/Apple-iPhone-15-Pro-lineup-hero-230912.jpg.og.jpg?202605131923";
const IPHONE_15_IMG =
  "https://www.apple.com/newsroom/images/2023/09/apple-debuts-iphone-15-and-iphone-15-plus/article/Apple-iPhone-15-lineup-hero-230912_inline.jpg.large.jpg";
const IPHONE_15_PLUS_IMG =
  "https://www.apple.com/newsroom/images/2023/09/apple-debuts-iphone-15-and-iphone-15-plus/tile/Apple-iPhone-15-lineup-hero-230912.jpg.og.jpg?202605131930";
const S24_ULTRA_IMG =
  "https://images.samsung.com/is/image/samsung/p6pim/ie/2401/gallery/ie-galaxy-s24-ultra-491407-sm-s928bztgeub-539465773?$Q90_684_547_JPG$";
const S24_PLUS_IMG =
  "https://images.samsung.com/is/image/samsung/p6pim/za/2401/gallery/za-galaxy-s24-plus-sm-s926bzkbafa-539309747?$1164_776_PNG$";
const S24_IMG =
  "https://image-us.samsung.com/us/smartphones/galaxy-s24/all-gallery/01_E1_OynxBlack_Lockup_1600x1200.jpg?$product-details-jpg$";
const S23_FE_IMG =
  "https://images.samsung.com/is/image/samsung/p6pim/africa_en/sm-s711bzabafa/gallery/africa-en-galaxy-s23-fe-s711-sm-s711bzabafa-538424099?$1164_776_PNG$";

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
  // ─── Phones (real brand images, Phase 1 batch) ──────────
  {
    name: "iPhone 15 Pro Max (1TB)",
    slug: "iphone-15-pro-max-1tb",
    description:
      "Apple iPhone 15 Pro Max with 48MP camera system, A17 Pro chip, 6.7-inch Super Retina XDR display, and surgical-grade titanium design.",
    price: 1299999,
    images: [IPHONE_15_PRO_IMG],
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
    images: [IPHONE_15_PRO_IMG],
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
    images: [IPHONE_15_PRO_TILE_IMG],
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
    images: [IPHONE_15_IMG],
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
    images: [S24_ULTRA_IMG],
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
    images: [S24_PLUS_IMG],
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
    images: [S24_IMG],
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
    images: [S23_FE_IMG],
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
    images: [IPHONE_15_PLUS_IMG],
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

  // ─── Phone Cases & Covers (real brand images, Phase 1 batch) ──
  {
    name: "Spigen Tough Armor Case",
    slug: "spigen-tough-armor-case",
    description:
      "Durable Spigen Tough Armor case with shock absorption and elegant design.",
    price: 15999,
    images: [SPIGEN_TOUGH_ARMOR_IMG],
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
    images: [SUPCASE_UB_PRO_IMG],
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
    images: [OLIXAR_CLEAR_IMG],
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
    images: [NILLKIN_SHIELD_PRO_IMG],
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
    images: [UAG_MONARCH_PRO_IMG],
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
    images: [MOSHI_IGLAZE_IMG],
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
    images: [SPIGEN_LIQUID_CRYSTAL_IMG],
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
    images: [NILLKIN_AIR_IMG],
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
    images: [RINGKE_ONYX_IMG],
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
    images: [ESR_SHOCKPROOF_IMG],
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
    images: [LAMICALL_CASE_IMG],
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
    images: [OTTERBOX_DEFENDER_IMG],
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
    images: [SPIGEN_ULTRA_HYBRID_IMG],
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

  // ─── Chargers & Cables (real brand images, Phase 1 batch) ──
  {
    name: "Anker 3-Port Charger",
    slug: "anker-3-port-charger",
    description:
      "Anker 3-port smart charger with AI power management and fast charging.",
    price: 29999,
    images: [ANKER_3PORT_IMG],
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
    images: [AMAZONBASICS_USBC_IMG],
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
    images: [APPLE_MAGSAFE_IMG],
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
    images: [BASEUS_USBC_IMG],
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
    images: [ANKER_30W_IMG],
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
    images: [ANKER_NANO_20W_IMG],
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
    images: [BELKIN_BOOSTCHARGE_IMG],
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
    images: [UGREEN_65W_IMG],
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
    images: [ANKER_20W_ADAPTER_IMG],
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
    images: [UGREEN_100W_IMG],
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

  // ─── Power Banks (real brand images, Phase 1 batch) ────
  {
    name: "Anker PowerCore 10000",
    slug: "anker-powercore-10000",
    description:
      "Anker PowerCore 10000 mAh portable charger with dual USB output.",
    price: 45999,
    images: [ANKER_POWERBANK_10000_IMG],
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
    images: [ANKER_POWERBANK_20000_IMG],
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
    images: [PHILIPS_POWERBANK_IMG],
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
    images: [ANKER_POWERBANK_26800_IMG],
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
    images: [BASEUS_POWERBANK_20000_IMG],
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
    images: [SAMSUNG_POWERBANK_IMG],
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
    images: [ANKER_POWERBANK_SLIM_IMG],
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
    images: [XIAOMI_POWERBANK_20000_IMG],
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
    images: [BASEUS_POWERBANK_MINI_IMG],
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

  // ─── Earphones & Headphones (real brand images, Phase 1 batch) ──
  {
    name: "Sony WF-1000XM4 Earbuds",
    slug: "sony-wf-1000xm4-earbuds",
    description:
      "Sony WF-1000XM4 wireless earbuds with noise cancellation and 8 hours battery life.",
    price: 199999,
    images: [SONY_EARBUDS_1000XM4_IMG],
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
    images: [SAMSUNG_BUDS2_IMG],
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
    images: [JBL_230NC_IMG],
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
    images: [SOUNDCORE_LIFE_Q35_IMG],
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
    images: [AIRPODS_PRO_2_IMG],
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
    images: [JBL_510BT_IMG],
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
    images: [SONY_WH_1000XM5_IMG],
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
    images: [JBL_770NC_IMG],
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
    images: [SOUNDCORE_SPACE_A40_IMG],
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

  // ─── Screen Protectors (real brand images, Phase 1 batch) ────────
  {
    name: "Spigen Tempered Glass Screen Protector",
    slug: "spigen-tempered-glass-screen-protector",
    description:
      "Spigen 9H tempered glass screen protector with oleophobic coating and easy install kit.",
    price: 8999,
    images: [SPIGEN_PROTECTOR_IMG],
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
    images: [SUPERSHIELDZ_PROTECTOR_IMG],
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
    images: [ESR_PROTECTOR_IMG],
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
    images: [ICAREZ_PROTECTOR_IMG],
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
    images: [FLASFIT_PROTECTOR_IMG],
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
    images: [WHITESTONE_PROTECTOR_IMG],
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
    images: [BELKIN_PROTECTOR_IMG],
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
