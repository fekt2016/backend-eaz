/**
 * The first 15 products from docs/sample-products.md, in Product-model shape.
 *
 * Kept as data, separate from the script that loads it, so the catalogue can be
 * reviewed and edited without touching the delete/insert logic.
 *
 * Money is integer pesewas throughout (GH₵1.00 = 100) — never a float.
 * `variants[].price: null` means "inherit the base price", not "free".
 * `supplier` is intentionally absent: it is an ObjectId ref to a Supplier doc,
 * and inventing ids would create dangling pointers. Set it in the item form.
 */
const P = (name, slug, category, price, costPrice, stock, sku, extra = {}) => ({
  name, slug, category, price, costPrice, stock, sku,
  isActive: true, sellOnline: true, sellInStore: true, useInRepairs: false,
  images: [], gallery: { images: [], videos: [] }, specs: [],
  compatibleWith: [], notes: "", barcode: "",
  weight: 0, weightUnit: "kg", isFragile: false,
  lowStockThreshold: 0, allowNegativeStock: false, partCategory: null,
  preorder: { enabled: false, availableFrom: null, note: "", maxQty: null },
  ...extra,
});

const V = (sku, attributes, stock, price = null, preorder = {}) => ({
  sku, attributes, stock, price, images: [],
  preorder: { enabled: null, availableFrom: null, note: "", maxQty: null, ...preorder },
});

module.exports = [
  P("iPhone 15 Pro", "iphone-15-pro", "Phones", 1850000, 1610000, 12, "EZW-IPH-001", {
    shortDescription: "Titanium body, A17 Pro chip, 48MP main camera.",
    description: "Apple's 2023 flagship with a titanium frame, the A17 Pro chip and a 48MP main camera. Ghana warranty, 12 months.",
    specs: [{ label: "Display", value: "6.1in Super Retina XDR" }, { label: "Chip", value: "A17 Pro" }, { label: "Battery", value: "3274mAh" }],
    weight: 0.187, isFragile: true, lowStockThreshold: 3,
    variants: [
      V("EZW-IPH-001-NAT128", { color: "Natural Titanium", storage: "128GB" }, 5),
      V("EZW-IPH-001-BLU256", { color: "Blue Titanium", storage: "256GB" }, 4, 2050000),
      V("EZW-IPH-001-BLA512", { color: "Black Titanium", storage: "512GB" }, 3, 2390000),
    ],
  }),

  P("Samsung Galaxy A55 5G", "samsung-galaxy-a55-5g", "Phones", 520000, 445000, 18, "EZW-SAM-002", {
    shortDescription: "5G, 120Hz AMOLED, 50MP OIS camera.",
    description: "Mid-range 5G handset with a 120Hz Super AMOLED screen, 50MP OIS main camera and a 5000mAh battery.",
    specs: [{ label: "Display", value: "6.6in AMOLED 120Hz" }, { label: "Battery", value: "5000mAh" }, { label: "IP rating", value: "IP67" }],
    weight: 0.213, isFragile: true, lowStockThreshold: 4,
    variants: [
      V("EZW-SAM-002-AWE128", { color: "Awesome Navy", storage: "128GB" }, 8),
      V("EZW-SAM-002-AWE256", { color: "Awesome Lilac", storage: "256GB" }, 6, 585000),
      V("EZW-SAM-002-ICE256", { color: "Iceblue", storage: "256GB" }, 4, 585000),
    ],
  }),

  P("Tecno Spark 20 Pro", "tecno-spark-20-pro", "Phones", 165000, 132000, 25, "EZW-TEC-003", {
    shortDescription: "108MP camera, 8GB RAM, big battery.",
    description: "Budget-friendly Tecno with a 108MP camera, 8GB RAM and a 5000mAh battery.",
    specs: [{ label: "RAM", value: "8GB" }, { label: "Camera", value: "108MP" }, { label: "Battery", value: "5000mAh" }],
    weight: 0.19, lowStockThreshold: 5,
    variants: [
      V("EZW-TEC-003-MAG128", { color: "Magic Skin Green", storage: "128GB" }, 10),
      V("EZW-TEC-003-MOO256", { color: "Moonlit Black", storage: "256GB" }, 9, 189000),
      V("EZW-TEC-003-SUN128", { color: "Sunset Gold", storage: "128GB" }, 6),
    ],
  }),

  P("Infinix Hot 40i", "infinix-hot-40i", "Phones", 118000, 94000, 30, "EZW-INF-004", {
    shortDescription: "90Hz display, 5000mAh, dual speakers.",
    description: "Entry-level Infinix with a 90Hz screen, 5000mAh battery and dual stereo speakers.",
    specs: [{ label: "Display", value: "6.56in 90Hz" }, { label: "Battery", value: "5000mAh" }],
    weight: 0.194, lowStockThreshold: 6,
    variants: [
      V("EZW-INF-004-STA128", { color: "Starfall Green", storage: "128GB" }, 12),
      V("EZW-INF-004-PAL128", { color: "Palm Blue", storage: "128GB" }, 11),
      V("EZW-INF-004-HOR256", { color: "Horizon Gold", storage: "256GB" }, 7, 139000),
    ],
  }),

  P("iPhone 13 Screen Assembly", "iphone-13-screen-assembly", "Screen", 95000, 62000, 14, "EZW-IPH-005", {
    shortDescription: "Replacement OLED assembly for iPhone 13.",
    description: "Full front assembly for iPhone 13. Fitting available at the bench.",
    compatibleWith: ["iPhone 13", "iPhone 13 Pro"],
    notes: "Check for dead pixels before fitting.",
    partCategory: "Screen", useInRepairs: true, allowNegativeStock: true, lowStockThreshold: 4,
    variants: [
      V("EZW-IPH-005-ORI", { grade: "Original Pull" }, 4, 145000),
      V("EZW-IPH-005-INC", { grade: "Incell Copy" }, 7),
      V("EZW-IPH-005-SOF", { grade: "Soft OLED" }, 3, 118000),
    ],
  }),

  P("Samsung A-Series Replacement Battery", "samsung-a-series-battery", "Battery", 18000, 10500, 22, "EZW-SAM-006", {
    shortDescription: "Replacement Li-ion battery for Galaxy A models.",
    description: "Direct-fit replacement battery. Fitting available at the bench.",
    compatibleWith: ["Galaxy A12", "Galaxy A13", "Galaxy A23"],
    partCategory: "Battery", useInRepairs: true, allowNegativeStock: true, lowStockThreshold: 6,
    variants: [
      V("EZW-SAM-006-A12", { model: "A12", capacity: "5000mAh" }, 9),
      V("EZW-SAM-006-A13", { model: "A13", capacity: "5000mAh" }, 8),
      V("EZW-SAM-006-A23", { model: "A23", capacity: "5000mAh" }, 5, 21000),
    ],
  }),

  P("Anker PowerCore Power Bank", "anker-powercore-power-bank", "Power Banks", 42000, 29000, 20, "EZW-ANK-007", {
    shortDescription: "Fast-charge power bank with USB-C PD.",
    description: "Anker PowerCore with USB-C Power Delivery, charges a phone roughly four times.",
    specs: [{ label: "Output", value: "20W USB-C PD" }, { label: "Ports", value: "2" }],
    weight: 0.35, lowStockThreshold: 5,
    variants: [
      V("EZW-ANK-007-BLA10", { color: "Black", capacity: "10000mAh" }, 9),
      V("EZW-ANK-007-BLA20", { color: "Black", capacity: "20000mAh" }, 7, 62000),
      V("EZW-ANK-007-WHI20", { color: "White", capacity: "20000mAh" }, 4, 62000),
    ],
  }),

  P("Oraimo 20W Fast Charger", "oraimo-20w-fast-charger", "Chargers & Cables", 9500, 5800, 45, "EZW-ORA-008", {
    shortDescription: "20W USB-C wall charger, Ghana pin.",
    description: "20W USB-C Power Delivery wall charger with a UK/Ghana three-pin plug.",
    specs: [{ label: "Output", value: "20W PD" }, { label: "Plug", value: "UK 3-pin" }],
    weight: 0.08, lowStockThreshold: 10,
    variants: [
      V("EZW-ORA-008-WHI20", { color: "White", output: "20W" }, 20),
      V("EZW-ORA-008-BLA20", { color: "Black", output: "20W" }, 15),
      V("EZW-ORA-008-BLA33", { color: "Black", output: "33W" }, 10, 13500),
    ],
  }),

  P("Braided USB-C Charging Cable", "braided-usb-c-charging-cable", "Chargers & Cables", 4500, 2200, 80, "EZW-BRA-009", {
    shortDescription: "Nylon-braided USB-C cable, 60W rated.",
    description: "Nylon-braided USB-C to USB-C cable rated for 60W charging and fast data.",
    compatibleWith: ["Any USB-C phone", "Laptop USB-C"],
    partCategory: "Cable", useInRepairs: true, lowStockThreshold: 15,
    variants: [
      V("EZW-BRA-009-BLA1", { color: "Black", length: "1m" }, 35),
      V("EZW-BRA-009-BLA2", { color: "Black", length: "2m" }, 28, 6000),
      V("EZW-BRA-009-RED2", { color: "Red", length: "2m" }, 17, 6000),
    ],
  }),

  P("AirPods Pro (2nd generation)", "airpods-pro-2nd-generation", "Earphones & Headphones", 295000, 242000, 0, "EZW-AIR-010", {
    shortDescription: "Active noise cancellation, USB-C case.",
    description: "Apple AirPods Pro 2 with active noise cancellation, adaptive audio and a USB-C charging case.",
    specs: [{ label: "ANC", value: "Yes" }, { label: "Case", value: "USB-C MagSafe" }],
    weight: 0.061, isFragile: true, lowStockThreshold: 2,
    preorder: { enabled: true, availableFrom: new Date("2026-10-15"), note: "Ships from abroad, about 3 weeks.", maxQty: 2 },
    variants: [
      V("EZW-AIR-010-WHIUSB", { color: "White", case: "USB-C" }, 0),
      V("EZW-AIR-010-WHILIG", { color: "White", case: "Lightning" }, 0, 265000),
      V("EZW-AIR-010-WHIENG", { color: "White", edition: "Engraved" }, 0, 315000,
        { enabled: true, availableFrom: new Date("2026-11-01"), note: "Engraving adds ~1 week.", maxQty: 1 }),
    ],
  }),

  P("Oraimo FreePods Wireless Earbuds", "oraimo-freepods-wireless-earbuds", "Earphones & Headphones", 22000, 14000, 33, "EZW-ORA-011", {
    shortDescription: "Bluetooth 5.3 earbuds with charging case.",
    description: "Wireless earbuds with Bluetooth 5.3, touch controls and around 24 hours total playtime.",
    specs: [{ label: "Bluetooth", value: "5.3" }, { label: "Playtime", value: "24h total" }],
    weight: 0.045, lowStockThreshold: 8,
    variants: [
      V("EZW-ORA-011-BLA", { color: "Black" }, 14),
      V("EZW-ORA-011-WHI", { color: "White" }, 12),
      V("EZW-ORA-011-BLU", { color: "Blue" }, 7, 24000),
    ],
  }),

  P("Tempered Glass Screen Protector", "tempered-glass-screen-protector", "Screen Protectors", 2500, 900, 120, "EZW-TEM-012", {
    shortDescription: "9H tempered glass, fitting included in store.",
    description: "9H hardness tempered glass with oleophobic coating. Free fitting when bought in store.",
    compatibleWith: ["iPhone 13", "iPhone 14", "iPhone 15"],
    useInRepairs: true, lowStockThreshold: 25,
    variants: [
      V("EZW-TEM-012-IPH13", { model: "iPhone 13", finish: "Clear" }, 45),
      V("EZW-TEM-012-IPH15", { model: "iPhone 15", finish: "Clear" }, 50),
      V("EZW-TEM-012-IPH15P", { model: "iPhone 15", finish: "Privacy" }, 25, 3500),
    ],
  }),

  P("Silicone Phone Case", "silicone-phone-case", "Phone Cases & Covers", 6000, 2400, 90, "EZW-SIL-013", {
    shortDescription: "Soft-touch silicone case with microfibre lining.",
    description: "Soft-touch liquid silicone case with a microfibre interior and raised camera lip.",
    compatibleWith: ["iPhone 15", "iPhone 15 Pro"], lowStockThreshold: 20,
    variants: [
      V("EZW-SIL-013-BLA15", { color: "Black", model: "iPhone 15" }, 40),
      V("EZW-SIL-013-NAV15", { color: "Navy", model: "iPhone 15" }, 30),
      V("EZW-SIL-013-BLA15P", { color: "Black", model: "iPhone 15 Pro" }, 20, 6500),
    ],
  }),

  P("Leather Wallet Case", "leather-wallet-case", "Phone Cases & Covers", 12000, 6500, 40, "EZW-LEA-014", {
    shortDescription: "Flip wallet case with three card slots.",
    description: "PU leather flip case with three card slots, a cash pocket and a magnetic closure.",
    compatibleWith: ["Samsung A55", "Tecno Spark 20"], lowStockThreshold: 8,
    variants: [
      V("EZW-LEA-014-BRO55", { color: "Brown", model: "Galaxy A55" }, 16),
      V("EZW-LEA-014-BLA55", { color: "Black", model: "Galaxy A55" }, 14),
      V("EZW-LEA-014-BLASP", { color: "Black", model: "Spark 20" }, 10, 11000),
    ],
  }),

  P("Charging Port Flex Cable", "charging-port-flex-cable", "Charging Port", 14000, 7000, 26, "EZW-CHA-015", {
    shortDescription: "Replacement charging port flex with mic.",
    description: "Charging port flex assembly including microphone and antenna contacts. Fitting available at the bench.",
    compatibleWith: ["iPhone 12", "iPhone 13", "Galaxy A23"],
    notes: "Test the mic after fitting — common return reason.",
    partCategory: "Charging Port", useInRepairs: true, allowNegativeStock: true, lowStockThreshold: 6,
    variants: [
      V("EZW-CHA-015-IPH12", { model: "iPhone 12", connector: "Lightning" }, 10),
      V("EZW-CHA-015-IPH13", { model: "iPhone 13", connector: "Lightning" }, 11),
      V("EZW-CHA-015-A23", { model: "Galaxy A23", connector: "USB-C" }, 5, 12000),
    ],
  }),
];
