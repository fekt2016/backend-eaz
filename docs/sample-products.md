# Sample catalogue — 20 products, 3 variants each

Reference/QA fixture data shaped to the real `models/Product.js` schema, so it can be
pasted into a seed script or typed into the item form without translation.

## Conventions used here

| Rule | Meaning |
|---|---|
| **Money is integer pesewas** | `price: 1850000` is **GH₵18,500.00**. Never a float. The GH₵ column is for reading only — it is not a stored field. |
| **Product SKU** | House style `EZW-<BRAND>-<NNN>` — the number is assigned server-side for uniqueness. |
| **Variant SKU** | `<parent SKU>-<ATTR SUFFIX>`, suffix built from the attribute values. |
| **`variants[].price: null`** | "unset" — falls back to the product's base price. Distinct from `0`, which means genuinely free. |
| **`variants[].preorder.enabled: null`** | "not a pre-order variant"; the product-level pre-order still applies. |
| **`sellOnline` / `sellInStore` / `useInRepairs`** | Channels, not a type. Every item below sells in both channels; `useInRepairs` marks what can go on a repair job. |
| **`category`** | Free text. The shop's browse bar is built from the categories actually in use, so anything here earns its own button. |
| **`partCategory`** | Repair taxonomy only, from a fixed enum (Screen, Battery, Charging Port, Speaker, Camera, Button, Housing, Board, Accessory, Cable, IC / Chip, Other). `null` on ordinary shop stock. |

---

## 1. iPhone 15 Pro

| Field | Value |
|---|---|
| `name` | iPhone 15 Pro |
| `slug` | iphone-15-pro |
| `category` | Phones |
| `price` | `1850000` → GH₵18,500.00 |
| `costPrice` | `1610000` → GH₵16,100.00 |
| `stock` | 12 |
| `sku` | EZW-IPH-001 |
| `barcode` | 194253400care |
| `shortDescription` | Titanium body, A17 Pro chip, 48MP main camera. |
| `description` | Apple's 2023 flagship with a titanium frame, the A17 Pro chip and a 48MP main camera. Ghana warranty, 12 months. |
| `images` | `["https://res.cloudinary.com/eaz/iphone15pro-hero.jpg"]` |
| `gallery` | `{ images: ["…/iphone15pro-back.jpg", "…/iphone15pro-side.jpg"], videos: [] }` |
| `specs` | `[{label:"Display",value:"6.1in Super Retina XDR"},{label:"Chip",value:"A17 Pro"},{label:"Battery",value:"3274mAh"}]` |
| `weight` / `weightUnit` | `0.187` / `kg` |
| `isFragile` | `true` |
| `lowStockThreshold` | 3 |
| `allowNegativeStock` | `false` |
| `compatibleWith` | `[]` |
| `partCategory` | `null` |
| `supplier` | Accra Mobile Imports |
| `notes` | Sealed boxes, back room shelf 1. |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |
| `isActive` | `true` |
| `preorder` | `{ enabled: false, availableFrom: null, note: "", maxQty: null }` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-IPH-001-NAT128 | `{color:"Natural Titanium", storage:"128GB"}` | 5 | `null` (base) | `null` |
| EZW-IPH-001-BLU256 | `{color:"Blue Titanium", storage:"256GB"}` | 4 | `2050000` → GH₵20,500.00 | `null` |
| EZW-IPH-001-BLA512 | `{color:"Black Titanium", storage:"512GB"}` | 3 | `2390000` → GH₵23,900.00 | `null` |

---

## 2. Samsung Galaxy A55

| Field | Value |
|---|---|
| `name` | Samsung Galaxy A55 5G |
| `slug` | samsung-galaxy-a55-5g |
| `category` | Phones |
| `price` | `520000` → GH₵5,200.00 |
| `costPrice` | `445000` → GH₵4,450.00 |
| `stock` | 18 |
| `sku` | EZW-SAM-002 |
| `barcode` | 8806095538 |
| `shortDescription` | 5G, 120Hz AMOLED, 50MP OIS camera. |
| `description` | Mid-range 5G handset with a 120Hz Super AMOLED screen, 50MP OIS main camera and a 5000mAh battery. |
| `images` | `["…/a55-hero.jpg"]` |
| `gallery` | `{ images: ["…/a55-back.jpg"], videos: ["…/a55-tour.mp4"] }` |
| `specs` | `[{label:"Display",value:"6.6in AMOLED 120Hz"},{label:"Battery",value:"5000mAh"},{label:"IP rating",value:"IP67"}]` |
| `weight` / `weightUnit` | `0.213` / `kg` |
| `isFragile` | `true` |
| `lowStockThreshold` | 4 |
| `supplier` | Accra Mobile Imports |
| `partCategory` | `null` |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |
| `preorder` | `{ enabled: false, availableFrom: null, note: "", maxQty: null }` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-SAM-002-AWE128 | `{color:"Awesome Navy", storage:"128GB"}` | 8 | `null` | `null` |
| EZW-SAM-002-AWE256 | `{color:"Awesome Lilac", storage:"256GB"}` | 6 | `585000` → GH₵5,850.00 | `null` |
| EZW-SAM-002-ICE256 | `{color:"Iceblue", storage:"256GB"}` | 4 | `585000` → GH₵5,850.00 | `null` |

---

## 3. Tecno Spark 20 Pro

| Field | Value |
|---|---|
| `name` | Tecno Spark 20 Pro |
| `slug` | tecno-spark-20-pro |
| `category` | Phones |
| `price` | `165000` → GH₵1,650.00 |
| `costPrice` | `132000` → GH₵1,320.00 |
| `stock` | 25 |
| `sku` | EZW-TEC-003 |
| `barcode` | 6941193 |
| `shortDescription` | 108MP camera, 8GB RAM, big battery. |
| `description` | Budget-friendly Tecno with a 108MP camera, 8GB RAM and a 5000mAh battery. Popular walk-in seller. |
| `images` | `["…/spark20pro-hero.jpg"]` |
| `specs` | `[{label:"RAM",value:"8GB"},{label:"Camera",value:"108MP"},{label:"Battery",value:"5000mAh"}]` |
| `weight` / `weightUnit` | `0.19` / `kg` |
| `lowStockThreshold` | 5 |
| `supplier` | Kumasi Wholesale Electronics |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |
| `preorder` | `{ enabled: false, availableFrom: null, note: "", maxQty: null }` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-TEC-003-MAG128 | `{color:"Magic Skin Green", storage:"128GB"}` | 10 | `null` | `null` |
| EZW-TEC-003-MOO256 | `{color:"Moonlit Black", storage:"256GB"}` | 9 | `189000` → GH₵1,890.00 | `null` |
| EZW-TEC-003-SUN128 | `{color:"Sunset Gold", storage:"128GB"}` | 6 | `null` | `null` |

---

## 4. Infinix Hot 40i

| Field | Value |
|---|---|
| `name` | Infinix Hot 40i |
| `slug` | infinix-hot-40i |
| `category` | Phones |
| `price` | `118000` → GH₵1,180.00 |
| `costPrice` | `94000` → GH₵940.00 |
| `stock` | 30 |
| `sku` | EZW-INF-004 |
| `shortDescription` | 90Hz display, 5000mAh, dual speakers. |
| `description` | Entry-level Infinix with a 90Hz screen, 5000mAh battery and dual stereo speakers. |
| `images` | `["…/hot40i-hero.jpg"]` |
| `specs` | `[{label:"Display",value:"6.56in 90Hz"},{label:"Battery",value:"5000mAh"}]` |
| `weight` / `weightUnit` | `0.194` / `kg` |
| `lowStockThreshold` | 6 |
| `supplier` | Kumasi Wholesale Electronics |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-INF-004-STA128 | `{color:"Starfall Green", storage:"128GB"}` | 12 | `null` | `null` |
| EZW-INF-004-PAL128 | `{color:"Palm Blue", storage:"128GB"}` | 11 | `null` | `null` |
| EZW-INF-004-HOR256 | `{color:"Horizon Gold", storage:"256GB"}` | 7 | `139000` → GH₵1,390.00 | `null` |

---

## 5. iPhone 13 Screen Assembly

> Repair stock that is also sold over the counter — `useInRepairs: true` **and** on the shop.

| Field | Value |
|---|---|
| `name` | iPhone 13 Screen Assembly |
| `slug` | iphone-13-screen-assembly |
| `category` | Screen |
| `partCategory` | `Screen` |
| `price` | `95000` → GH₵950.00 |
| `costPrice` | `62000` → GH₵620.00 |
| `stock` | 14 |
| `sku` | EZW-IPH-005 |
| `barcode` | 700123400051 |
| `shortDescription` | Replacement OLED assembly for iPhone 13. |
| `description` | Full front assembly for iPhone 13. Fitting available at the bench. |
| `images` | `["…/ip13-screen.jpg"]` |
| `compatibleWith` | `["iPhone 13", "iPhone 13 Pro"]` |
| `lowStockThreshold` | 4 |
| `allowNegativeStock` | `true` (back-orderable bench part) |
| `supplier` | Shenzhen Parts Direct |
| `notes` | Check for dead pixels before fitting. |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / **`true`** |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-IPH-005-ORI | `{grade:"Original Pull"}` | 4 | `145000` → GH₵1,450.00 | `null` |
| EZW-IPH-005-INC | `{grade:"Incell Copy"}` | 7 | `null` (base) | `null` |
| EZW-IPH-005-SOF | `{grade:"Soft OLED"}` | 3 | `118000` → GH₵1,180.00 | `null` |

---

## 6. Samsung A-Series Battery

| Field | Value |
|---|---|
| `name` | Samsung A-Series Replacement Battery |
| `slug` | samsung-a-series-battery |
| `category` | Battery |
| `partCategory` | `Battery` |
| `price` | `18000` → GH₵180.00 |
| `costPrice` | `10500` → GH₵105.00 |
| `stock` | 22 |
| `sku` | EZW-SAM-006 |
| `shortDescription` | Replacement Li-ion battery for Galaxy A models. |
| `description` | Direct-fit replacement battery. Fitting available at the bench. |
| `images` | `["…/sam-battery.jpg"]` |
| `compatibleWith` | `["Galaxy A12", "Galaxy A13", "Galaxy A23"]` |
| `lowStockThreshold` | 6 |
| `allowNegativeStock` | `true` |
| `supplier` | Shenzhen Parts Direct |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / **`true`** |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-SAM-006-A12 | `{model:"A12", capacity:"5000mAh"}` | 9 | `null` | `null` |
| EZW-SAM-006-A13 | `{model:"A13", capacity:"5000mAh"}` | 8 | `null` | `null` |
| EZW-SAM-006-A23 | `{model:"A23", capacity:"5000mAh"}` | 5 | `21000` → GH₵210.00 | `null` |

---

## 7. Anker PowerCore Power Bank

| Field | Value |
|---|---|
| `name` | Anker PowerCore Power Bank |
| `slug` | anker-powercore-power-bank |
| `category` | Power Banks |
| `price` | `42000` → GH₵420.00 |
| `costPrice` | `29000` → GH₵290.00 |
| `stock` | 20 |
| `sku` | EZW-ANK-007 |
| `barcode` | 848061064 |
| `shortDescription` | Fast-charge power bank with USB-C PD. |
| `description` | Anker PowerCore with USB-C Power Delivery, charges a phone roughly four times. |
| `images` | `["…/powercore-hero.jpg"]` |
| `specs` | `[{label:"Output",value:"20W USB-C PD"},{label:"Ports",value:"2"}]` |
| `weight` / `weightUnit` | `0.35` / `kg` |
| `lowStockThreshold` | 5 |
| `supplier` | Accra Mobile Imports |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-ANK-007-BLA10 | `{color:"Black", capacity:"10000mAh"}` | 9 | `null` | `null` |
| EZW-ANK-007-BLA20 | `{color:"Black", capacity:"20000mAh"}` | 7 | `62000` → GH₵620.00 | `null` |
| EZW-ANK-007-WHI20 | `{color:"White", capacity:"20000mAh"}` | 4 | `62000` → GH₵620.00 | `null` |

---

## 8. Oraimo 20W Fast Charger

| Field | Value |
|---|---|
| `name` | Oraimo 20W Fast Charger |
| `slug` | oraimo-20w-fast-charger |
| `category` | Chargers & Cables |
| `price` | `9500` → GH₵95.00 |
| `costPrice` | `5800` → GH₵58.00 |
| `stock` | 45 |
| `sku` | EZW-ORA-008 |
| `barcode` | 620345000801 |
| `shortDescription` | 20W USB-C wall charger, Ghana pin. |
| `description` | 20W USB-C Power Delivery wall charger with a UK/Ghana three-pin plug. |
| `images` | `["…/oraimo-charger.jpg"]` |
| `specs` | `[{label:"Output",value:"20W PD"},{label:"Plug",value:"UK 3-pin"}]` |
| `weight` / `weightUnit` | `0.08` / `kg` |
| `lowStockThreshold` | 10 |
| `supplier` | Oraimo Ghana |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-ORA-008-WHI20 | `{color:"White", output:"20W"}` | 20 | `null` | `null` |
| EZW-ORA-008-BLA20 | `{color:"Black", output:"20W"}` | 15 | `null` | `null` |
| EZW-ORA-008-BLA33 | `{color:"Black", output:"33W"}` | 10 | `13500` → GH₵135.00 | `null` |

---

## 9. Braided USB-C Cable

| Field | Value |
|---|---|
| `name` | Braided USB-C Charging Cable |
| `slug` | braided-usb-c-charging-cable |
| `category` | Chargers & Cables |
| `partCategory` | `Cable` |
| `price` | `4500` → GH₵45.00 |
| `costPrice` | `2200` → GH₵22.00 |
| `stock` | 80 |
| `sku` | EZW-BRA-009 |
| `shortDescription` | Nylon-braided USB-C cable, 60W rated. |
| `description` | Nylon-braided USB-C to USB-C cable rated for 60W charging and fast data. |
| `images` | `["…/usbc-cable.jpg"]` |
| `compatibleWith` | `["Any USB-C phone", "Laptop USB-C"]` |
| `lowStockThreshold` | 15 |
| `supplier` | Kumasi Wholesale Electronics |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / **`true`** |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-BRA-009-BLA1 | `{color:"Black", length:"1m"}` | 35 | `null` | `null` |
| EZW-BRA-009-BLA2 | `{color:"Black", length:"2m"}` | 28 | `6000` → GH₵60.00 | `null` |
| EZW-BRA-009-RED2 | `{color:"Red", length:"2m"}` | 17 | `6000` → GH₵60.00 | `null` |

---

## 10. AirPods Pro (2nd gen)

> Pre-order example — stock is `0` and the product-level pre-order is enabled.

| Field | Value |
|---|---|
| `name` | AirPods Pro (2nd generation) |
| `slug` | airpods-pro-2nd-generation |
| `category` | Earphones & Headphones |
| `price` | `295000` → GH₵2,950.00 |
| `costPrice` | `242000` → GH₵2,420.00 |
| `stock` | 0 |
| `sku` | EZW-AIR-010 |
| `shortDescription` | Active noise cancellation, USB-C case. |
| `description` | Apple AirPods Pro 2 with active noise cancellation, adaptive audio and a USB-C charging case. |
| `images` | `["…/airpods-pro-2.jpg"]` |
| `specs` | `[{label:"ANC",value:"Yes"},{label:"Case",value:"USB-C MagSafe"}]` |
| `weight` / `weightUnit` | `0.061` / `kg` |
| `isFragile` | `true` |
| `lowStockThreshold` | 2 |
| `supplier` | Accra Mobile Imports |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |
| `preorder` | `{ enabled: true, availableFrom: 2026-10-15, note: "Ships from abroad, about 3 weeks.", maxQty: 2 }` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder` |
|---|---|---|---|---|
| EZW-AIR-010-WHIUSB | `{color:"White", case:"USB-C"}` | 0 | `null` | inherits product-level (`enabled: null`) |
| EZW-AIR-010-WHILIG | `{color:"White", case:"Lightning"}` | 0 | `265000` → GH₵2,650.00 | inherits product-level |
| EZW-AIR-010-WHIENG | `{color:"White", edition:"Engraved"}` | 0 | `315000` → GH₵3,150.00 | `{enabled:true, availableFrom:2026-11-01, note:"Engraving adds ~1 week.", maxQty:1}` |

---

## 11. Oraimo FreePods

| Field | Value |
|---|---|
| `name` | Oraimo FreePods Wireless Earbuds |
| `slug` | oraimo-freepods-wireless-earbuds |
| `category` | Earphones & Headphones |
| `price` | `22000` → GH₵220.00 |
| `costPrice` | `14000` → GH₵140.00 |
| `stock` | 33 |
| `sku` | EZW-ORA-011 |
| `shortDescription` | Bluetooth 5.3 earbuds with charging case. |
| `description` | Wireless earbuds with Bluetooth 5.3, touch controls and around 24 hours total playtime. |
| `images` | `["…/freepods.jpg"]` |
| `specs` | `[{label:"Bluetooth",value:"5.3"},{label:"Playtime",value:"24h total"}]` |
| `weight` / `weightUnit` | `0.045` / `kg` |
| `lowStockThreshold` | 8 |
| `supplier` | Oraimo Ghana |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-ORA-011-BLA | `{color:"Black"}` | 14 | `null` | `null` |
| EZW-ORA-011-WHI | `{color:"White"}` | 12 | `null` | `null` |
| EZW-ORA-011-BLU | `{color:"Blue"}` | 7 | `24000` → GH₵240.00 | `null` |

---

## 12. Tempered Glass Screen Protector

| Field | Value |
|---|---|
| `name` | Tempered Glass Screen Protector |
| `slug` | tempered-glass-screen-protector |
| `category` | Screen Protectors |
| `price` | `2500` → GH₵25.00 |
| `costPrice` | `900` → GH₵9.00 |
| `stock` | 120 |
| `sku` | EZW-TEM-012 |
| `shortDescription` | 9H tempered glass, fitting included in store. |
| `description` | 9H hardness tempered glass with oleophobic coating. Free fitting when bought in store. |
| `images` | `["…/tempered-glass.jpg"]` |
| `compatibleWith` | `["iPhone 13", "iPhone 14", "iPhone 15"]` |
| `lowStockThreshold` | 25 |
| `supplier` | Shenzhen Parts Direct |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / **`true`** |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-TEM-012-IPH13 | `{model:"iPhone 13", finish:"Clear"}` | 45 | `null` | `null` |
| EZW-TEM-012-IPH15 | `{model:"iPhone 15", finish:"Clear"}` | 50 | `null` | `null` |
| EZW-TEM-012-IPH15P | `{model:"iPhone 15", finish:"Privacy"}` | 25 | `3500` → GH₵35.00 | `null` |

---

## 13. Silicone Phone Case

| Field | Value |
|---|---|
| `name` | Silicone Phone Case |
| `slug` | silicone-phone-case |
| `category` | Phone Cases & Covers |
| `price` | `6000` → GH₵60.00 |
| `costPrice` | `2400` → GH₵24.00 |
| `stock` | 90 |
| `sku` | EZW-SIL-013 |
| `shortDescription` | Soft-touch silicone case with microfibre lining. |
| `description` | Soft-touch liquid silicone case with a microfibre interior and raised camera lip. |
| `images` | `["…/silicone-case.jpg"]` |
| `compatibleWith` | `["iPhone 15", "iPhone 15 Pro"]` |
| `lowStockThreshold` | 20 |
| `supplier` | Kumasi Wholesale Electronics |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-SIL-013-BLA15 | `{color:"Black", model:"iPhone 15"}` | 40 | `null` | `null` |
| EZW-SIL-013-NAV15 | `{color:"Navy", model:"iPhone 15"}` | 30 | `null` | `null` |
| EZW-SIL-013-BLA15P | `{color:"Black", model:"iPhone 15 Pro"}` | 20 | `6500` → GH₵65.00 | `null` |

---

## 14. Leather Wallet Case

| Field | Value |
|---|---|
| `name` | Leather Wallet Case |
| `slug` | leather-wallet-case |
| `category` | Phone Cases & Covers |
| `price` | `12000` → GH₵120.00 |
| `costPrice` | `6500` → GH₵65.00 |
| `stock` | 40 |
| `sku` | EZW-LEA-014 |
| `shortDescription` | Flip wallet case with three card slots. |
| `description` | PU leather flip case with three card slots, a cash pocket and a magnetic closure. |
| `images` | `["…/wallet-case.jpg"]` |
| `compatibleWith` | `["Samsung A55", "Tecno Spark 20"]` |
| `lowStockThreshold` | 8 |
| `supplier` | Kumasi Wholesale Electronics |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-LEA-014-BRO55 | `{color:"Brown", model:"Galaxy A55"}` | 16 | `null` | `null` |
| EZW-LEA-014-BLA55 | `{color:"Black", model:"Galaxy A55"}` | 14 | `null` | `null` |
| EZW-LEA-014-BLASP | `{color:"Black", model:"Spark 20"}` | 10 | `11000` → GH₵110.00 | `null` |

---

## 15. Charging Port Flex Cable

| Field | Value |
|---|---|
| `name` | Charging Port Flex Cable |
| `slug` | charging-port-flex-cable |
| `category` | Charging Port |
| `partCategory` | `Charging Port` |
| `price` | `14000` → GH₵140.00 |
| `costPrice` | `7000` → GH₵70.00 |
| `stock` | 26 |
| `sku` | EZW-CHA-015 |
| `shortDescription` | Replacement charging port flex with mic. |
| `description` | Charging port flex assembly including microphone and antenna contacts. Fitting available at the bench. |
| `images` | `["…/charging-flex.jpg"]` |
| `compatibleWith` | `["iPhone 12", "iPhone 13", "Galaxy A23"]` |
| `lowStockThreshold` | 6 |
| `allowNegativeStock` | `true` |
| `supplier` | Shenzhen Parts Direct |
| `notes` | Test the mic after fitting — common return reason. |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / **`true`** |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-CHA-015-IPH12 | `{model:"iPhone 12", connector:"Lightning"}` | 10 | `null` | `null` |
| EZW-CHA-015-IPH13 | `{model:"iPhone 13", connector:"Lightning"}` | 11 | `null` | `null` |
| EZW-CHA-015-A23 | `{model:"Galaxy A23", connector:"USB-C"}` | 5 | `12000` → GH₵120.00 | `null` |

---

## 16. Redmi Note 13

| Field | Value |
|---|---|
| `name` | Xiaomi Redmi Note 13 |
| `slug` | xiaomi-redmi-note-13 |
| `category` | Phones |
| `price` | `245000` → GH₵2,450.00 |
| `costPrice` | `198000` → GH₵1,980.00 |
| `stock` | 16 |
| `sku` | EZW-XIA-016 |
| `barcode` | 690461500 |
| `shortDescription` | 108MP camera, AMOLED, 33W fast charge. |
| `description` | Redmi Note 13 with a 108MP main camera, 120Hz AMOLED display and 33W fast charging. |
| `images` | `["…/redmi-note-13.jpg"]` |
| `gallery` | `{ images: ["…/redmi-back.jpg"], videos: [] }` |
| `specs` | `[{label:"Display",value:"6.67in AMOLED 120Hz"},{label:"Charging",value:"33W"}]` |
| `weight` / `weightUnit` | `0.188` / `kg` |
| `isFragile` | `true` |
| `lowStockThreshold` | 4 |
| `supplier` | Accra Mobile Imports |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-XIA-016-MID128 | `{color:"Midnight Black", storage:"128GB"}` | 7 | `null` | `null` |
| EZW-XIA-016-ICE256 | `{color:"Ice Blue", storage:"256GB"}` | 6 | `278000` → GH₵2,780.00 | `null` |
| EZW-XIA-016-MIN256 | `{color:"Mint Green", storage:"256GB"}` | 3 | `278000` → GH₵2,780.00 | `null` |

---

## 17. JBL Go 3 Bluetooth Speaker

| Field | Value |
|---|---|
| `name` | JBL Go 3 Bluetooth Speaker |
| `slug` | jbl-go-3-bluetooth-speaker |
| `category` | Speakers |
| `price` | `38000` → GH₵380.00 |
| `costPrice` | `27000` → GH₵270.00 |
| `stock` | 24 |
| `sku` | EZW-JBL-017 |
| `barcode` | 605133500 |
| `shortDescription` | Waterproof pocket speaker, 5 hours playtime. |
| `description` | Compact IP67 waterproof Bluetooth speaker with about 5 hours of playtime. |
| `images` | `["…/jbl-go-3.jpg"]` |
| `specs` | `[{label:"Rating",value:"IP67"},{label:"Playtime",value:"5h"}]` |
| `weight` / `weightUnit` | `0.209` / `kg` |
| `lowStockThreshold` | 5 |
| `supplier` | Accra Mobile Imports |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-JBL-017-BLA | `{color:"Black"}` | 10 | `null` | `null` |
| EZW-JBL-017-BLU | `{color:"Blue"}` | 8 | `null` | `null` |
| EZW-JBL-017-RED | `{color:"Red"}` | 6 | `null` | `null` |

---

## 18. Laptop Sleeve

| Field | Value |
|---|---|
| `name` | Padded Laptop Sleeve |
| `slug` | padded-laptop-sleeve |
| `category` | Bags & Sleeves |
| `price` | `15000` → GH₵150.00 |
| `costPrice` | `8000` → GH₵80.00 |
| `stock` | 35 |
| `sku` | EZW-PAD-018 |
| `shortDescription` | Water-resistant padded sleeve with pocket. |
| `description` | Water-resistant padded laptop sleeve with a front accessory pocket and a soft lining. |
| `images` | `["…/laptop-sleeve.jpg"]` |
| `weight` / `weightUnit` | `0.28` / `kg` |
| `lowStockThreshold` | 7 |
| `supplier` | Kumasi Wholesale Electronics |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-PAD-018-GRE13 | `{color:"Grey", size:"13in"}` | 14 | `null` | `null` |
| EZW-PAD-018-GRE15 | `{color:"Grey", size:"15in"}` | 12 | `17000` → GH₵170.00 | `null` |
| EZW-PAD-018-BLA15 | `{color:"Black", size:"15in"}` | 9 | `17000` → GH₵170.00 | `null` |

---

## 19. Car Phone Holder

| Field | Value |
|---|---|
| `name` | Magnetic Car Phone Holder |
| `slug` | magnetic-car-phone-holder |
| `category` | Car Accessories |
| `price` | `7500` → GH₵75.00 |
| `costPrice` | `3200` → GH₵32.00 |
| `stock` | 55 |
| `sku` | EZW-MAG-019 |
| `shortDescription` | Magnetic mount for dashboard or vent. |
| `description` | Strong magnetic phone mount that fits a dashboard or air vent. Metal plate included. |
| `images` | `["…/car-holder.jpg"]` |
| `compatibleWith` | `["Any phone up to 7in"]` |
| `weight` / `weightUnit` | `0.12` / `kg` |
| `lowStockThreshold` | 12 |
| `supplier` | Kumasi Wholesale Electronics |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder.enabled` |
|---|---|---|---|---|
| EZW-MAG-019-VEN | `{mount:"Air Vent", color:"Black"}` | 22 | `null` | `null` |
| EZW-MAG-019-DAS | `{mount:"Dashboard", color:"Black"}` | 20 | `null` | `null` |
| EZW-MAG-019-WIR | `{mount:"Dashboard", feature:"Wireless Charging"}` | 13 | `16500` → GH₵165.00 | `null` |

---

## 20. Smart Watch

> Second pre-order example — the product is in stock, but **one variant alone** is on
> pre-order. This is the per-variant case: a single colour can be pre-ordered while its
> siblings still sell normally.

| Field | Value |
|---|---|
| `name` | Oraimo Watch 4 Smart Watch |
| `slug` | oraimo-watch-4-smart-watch |
| `category` | Wearables |
| `price` | `48000` → GH₵480.00 |
| `costPrice` | `32000` → GH₵320.00 |
| `stock` | 14 |
| `sku` | EZW-ORA-020 |
| `barcode` | 620345002001 |
| `shortDescription` | 1.8in display, heart rate, 7-day battery. |
| `description` | Smart watch with a 1.8in display, heart-rate and SpO2 tracking and about 7 days of battery. |
| `images` | `["…/oraimo-watch-4.jpg"]` |
| `gallery` | `{ images: ["…/watch-strap.jpg"], videos: ["…/watch-demo.mp4"] }` |
| `specs` | `[{label:"Display",value:"1.8in"},{label:"Battery",value:"7 days"},{label:"Water",value:"IP68"}]` |
| `weight` / `weightUnit` | `0.052` / `kg` |
| `isFragile` | `true` |
| `lowStockThreshold` | 4 |
| `supplier` | Oraimo Ghana |
| `notes` | Straps sold separately from Q4. |
| `sellOnline` / `sellInStore` / `useInRepairs` | `true` / `true` / `false` |
| `preorder` | `{ enabled: false, availableFrom: null, note: "", maxQty: null }` |

**Variants**

| SKU | `attributes` | `stock` | `price` | `preorder` |
|---|---|---|---|---|
| EZW-ORA-020-BLA | `{color:"Black", strap:"Silicone"}` | 8 | `null` | `null` |
| EZW-ORA-020-SIL | `{color:"Silver", strap:"Silicone"}` | 6 | `null` | `null` |
| EZW-ORA-020-GOL | `{color:"Gold", strap:"Milanese"}` | 0 | `56000` → GH₵560.00 | `{enabled:true, availableFrom:2026-10-20, note:"Gold Milanese restocking.", maxQty:3}` |

---

## Coverage notes

This set is deliberately not 20 near-identical rows — it exercises the edge cases:

| Case | Where |
|---|---|
| Variant price `null` (inherits base) | every product's first variant |
| Explicit variant price override | #1, #2, #8, #9, #18, #19 |
| Product-level pre-order, `stock: 0` | #10 AirPods Pro |
| **Per-variant** pre-order while siblings sell | #10 (engraved), #20 (Gold) |
| `useInRepairs: true` — sells online *and* goes on a job | #5, #6, #9, #12, #15 |
| `allowNegativeStock: true` — back-orderable | #5, #6, #15 |
| `partCategory` set (repair taxonomy) | #5, #6, #9, #12, #15 |
| Categories outside the old hardcoded six | Screen, Battery, Charging Port, Speakers, Bags & Sleeves, Car Accessories, Wearables |
| `gallery.videos` populated | #2, #20 |
| `specs` populated | #1, #2, #3, #4, #7, #8, #10, #11, #16, #17, #20 |
| `compatibleWith` populated | #5, #6, #9, #12, #13, #14, #15, #19 |

**Totals:** 20 products, 60 variants, 7 suppliers, 11 distinct categories.
