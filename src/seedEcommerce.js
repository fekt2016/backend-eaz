const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/Product");
const DeliveryZone = require("../models/DeliveryZone");
const { logDbTarget } = require("../utils/dbTarget");

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

// ─── Gallery images added in CATALOG_CLEANUP_TASK.md Phase B ───────────
// Real per-product galleries sourced from the same official brand CDN as
// each product's existing hero image (verified HTTP 200 before use).
const SPIGEN_TOUGH_ARMOR_GALLERY = [
  "https://partners.spigen.com/cdn/shop/files/detail_web_ip16_tougharmor_black_02.jpg?v=1725899076",
  "https://partners.spigen.com/cdn/shop/files/detail_web_ip16_tougharmor_black_03.jpg?v=1725899076",
  "https://partners.spigen.com/cdn/shop/files/detail_web_ip16_tougharmor_black_04.jpg?v=1725899076",
  "https://partners.spigen.com/cdn/shop/files/detail_web_ip16_tougharmor_black_05.jpg?v=1725899076",
];
const SPIGEN_TOUGH_ARMOR_VARIANT_IMG = SPIGEN_TOUGH_ARMOR_IMG;
const SPIGEN_TEMPERED_GLASS_GALLERY = [
  "https://www.spigen.com/cdn/shop/files/id_ip6.7p_glas_tr_ezfit_privacy_03.jpg?v=1749662407",
  "https://www.spigen.com/cdn/shop/files/id_ip6.7p_glas_tr_ezfit_privacy_04.jpg?v=1749662407",
  "https://www.spigen.com/cdn/shop/files/id_ip6.7p_glas_tr_ezfit_privacy_05.jpg?v=1749662407",
  "https://www.spigen.com/cdn/shop/files/id_ip6.7p_glas_tr_ezfit_privacy_06.jpg?v=1749662407",
];
const ESR_PROTECTOR_GALLERY = [
  "https://www.esrtech.com/cdn/shop/files/iPhone-17-Pro-Max-UltraFit-Armoriter_-Screen-Protector-2-Pack-ESR-240689653.jpg?v=1783011417",
  "https://www.esrtech.com/cdn/shop/files/iPhone-17-Pro-Max-UltraFit-Armoriter_-Screen-Protector-2-Pack-ESR-240689795.jpg?v=1783011450",
  "https://www.esrtech.com/cdn/shop/files/iPhone-17-Pro-Max-UltraFit-Armoriter_-Screen-Protector-2-Pack-ESR-240689881.jpg?v=1783011441",
  "https://www.esrtech.com/cdn/shop/files/iPhone-17-Pro-Max-UltraFit-Armoriter_-Screen-Protector-2-Pack-ESR-240689988.jpg?v=1783011457",
];
const BASEUS_POWERBANK_20000_GALLERY = [
  "https://eu.baseus.com/cdn/shop/files/Baseus_Qpow2_Power_Bank_22.5W_20000mAh_front_800x.jpg",
  "https://eu.baseus.com/cdn/shop/files/Baseus_Qpow2_Power_Bank_22.5W_20000mAh_back_800x.jpg",
  "https://eu.baseus.com/cdn/shop/files/Baseus_Qpow2_Power_Bank_22.5W_20000mAh_side_800x.jpg",
  "https://eu.baseus.com/cdn/shop/files/Baseus_Qpow2_Power_Bank_22.5W_20000mAh_2_800x.jpg",
];
const SAMSUNG_POWERBANK_GALLERY = [
  "https://images.samsung.com/is/image/samsung/p6pim/us/eb-u2510xuegus/gallery/us-wireless-battery-pack-10000mah-eb-u2510-eb-u2510xuegus-551220655",
  "https://images.samsung.com/is/image/samsung/p6pim/us/eb-u2510xuegus/gallery/us-wireless-battery-pack-10000mah-eb-u2510-eb-u2510xuegus-551220656",
  "https://images.samsung.com/is/image/samsung/p6pim/us/eb-u2510xuegus/gallery/us-wireless-battery-pack-10000mah-eb-u2510-eb-u2510xuegus-551220657",
  "https://images.samsung.com/is/image/samsung/p6pim/us/eb-u2510xuegus/gallery/us-wireless-battery-pack-10000mah-eb-u2510-eb-u2510xuegus-551220658",
];
const JBL_230NC_GALLERY = [
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwd5a85262/2.JBL_TUNE_230NC_Product%20Image_Front_Black.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwfb3bad76/3.JBL_TUNE_230NC_Product%20Image_Earbud%20Back_Black_.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwe3a9f190/4.JBL_TUNE_230NC_Product%20Image_Case%20open_Black.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwfa5c5952/5.JBL_TUNE_230NC_Product%20Image_Case%20Front_Black.png?sw=535&sh=535",
];
const JBL_510BT_GALLERY = [
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw4924f1d3/JBL_TUNE_510BT_Product%20Image_Front_White.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw6b2d4c88/JBL_TUNE_510BT_Product%20Image_Cushion_White.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwf4a553c1/JBL_TUNE_510BT_Product%20Image_Folded%202_White.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwfa712045/JBL_TUNE_510BT_Product%20Image_Detail_White.png?sw=535&sh=535",
];
const JBL_770NC_GALLERY = [
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw838c5c35/2.JBL_Tune_770NC_Product%20Image_Front_Black.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw2323e116/3.JBL_Tune_770NC_Product%20Image_Back_Black.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwadcd0ffa/4.JBL_Tune_770NC_Product%20Image_Left_Black.png?sw=535&sh=535",
  "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwd40cda26/6.JBL_Tune_770NC_Product%20Image_Folded_Black.png?sw=535&sh=535",
];
const ESR_SHOCKPROOF_GALLERY = [
  "https://www.esrtech.com/cdn/shop/files/iPhone_16_Pro_Cyber_Tough_Magsafe_Case_with_Stand_and_Camera_Control_Button_Black_KF1.jpg",
  "https://www.esrtech.com/cdn/shop/files/iPhone_16_Pro_Cyber_Tough_Magsafe_Case_with_Stand_and_Camera_Control_Button_Black_KF2.jpg",
  "https://www.esrtech.com/cdn/shop/files/iPhone_16_Pro_Cyber_Tough_Magsafe_Case_with_Stand_and_Camera_Control_Button_Black_KF3.jpg",
  "https://www.esrtech.com/cdn/shop/files/iPhone_16_Pro_Cyber_Tough_Magsafe_Case_with_Stand_and_Camera_Control_Button_Black_KF4.jpg",
];
const RINGKE_ONYX_GALLERY = [
  "https://www.ringkestore.com/cdn/shop/files/IP17_ONX_BK_Sub2.jpg",
  "https://www.ringkestore.com/cdn/shop/files/IP17_ONX_BK_Sub3.jpg",
  "https://www.ringkestore.com/cdn/shop/files/IP17_ONX_BK_Sub4.jpg",
  "https://www.ringkestore.com/cdn/shop/files/IP17_ONX_BK_Sub5.jpg",
];
const SUPCASE_UB_PRO_GALLERY = [
  "https://supcase.com/cdn/shop/files/SUPCASE_iPhone_17_Pro_Max_Unicorn_Beetle_Pro_Rugged_phone_case_Black_10_1024x1024.webp",
  "https://supcase.com/cdn/shop/files/SUPCASE_iPhone_17_Pro_Max_Unicorn_Beetle_Pro_Rugged_phone_case_Black_11_1024x1024.webp",
  "https://supcase.com/cdn/shop/files/SUPCASE_iPhone_17_Pro_Max_Unicorn_Beetle_Pro_Rugged_phone_case_Black_12_1024x1024.webp",
  "https://supcase.com/cdn/shop/files/SUPCASE_iPhone_17_Pro_Max_Unicorn_Beetle_Pro_Rugged_phone_case_Black_13_1024x1024.webp",
];
const NILLKIN_SHIELD_PRO_GALLERY = [
  "https://www.nillkin.com/cdn/shop/files/Super-Frosted-Shield-Pro-Case-for-iPhone-17ProMax-black_2.jpg",
  "https://www.nillkin.com/cdn/shop/files/Super-Frosted-Shield-Pro-Case-for-iPhone-17ProMax-black_3.jpg",
  "https://www.nillkin.com/cdn/shop/files/Super-Frosted-Shield-Pro-Case-for-iPhone-17ProMax-black_4.jpg",
  "https://www.nillkin.com/cdn/shop/files/Super-Frosted-Shield-Pro-Case-for-iPhone-17ProMax-black_5.jpg",
];
const OTTERBOX_DEFENDER_GALLERY = [
  "https://www.otterbox.com/cdn/shop/files/defender-iphd23-black-1.png",
  "https://www.otterbox.com/cdn/shop/files/defender-iphd23-black-2.png",
  "https://www.otterbox.com/cdn/shop/files/defender-iphd23-black-3.png",
];
const UGREEN_100W_GALLERY = [
  "https://us.ugreen.com/cdn/shop/products/ugreen-usb-c-to-usb-c-100w-fast-cable-2-pack-291907.jpg",
  "https://us.ugreen.com/cdn/shop/products/ugreen-usb-c-to-usb-c-100w-fast-cable-2-pack-364763.jpg",
  "https://us.ugreen.com/cdn/shop/products/ugreen-usb-c-to-usb-c-100w-fast-cable-2-pack-546551.jpg",
  "https://us.ugreen.com/cdn/shop/products/ugreen-usb-c-to-usb-c-100w-fast-cable-2-pack-619671.jpg",
];
const ANKER_NANO_20W_GALLERY = [
  "https://cdn.shopify.com/s/files/1/0493/9834/9974/files/A2637126_TD02_V1-1280x1280.jpg",
  "https://cdn.shopify.com/s/files/1/0493/9834/9974/files/A2637126_TD03_V1-1280x1280.jpg",
  "https://cdn.shopify.com/s/files/1/0493/9834/9974/files/A2637126_TD04_V1-1280x1280.jpg",
  "https://cdn.shopify.com/s/files/1/0493/9834/9974/files/A2637126_TD05_V1-1280x1280.jpg",
];
const BELKIN_BOOSTCHARGE_GALLERY = [
  "https://www.belkin.com/dw/image/v2/BGBH_PRD/on/demandware.static/-/Sites-master-product-catalog-blk/default/dw5f89f3fa/images/hi-res/5/5f89f3fa5abd4f15_CAB004bt0MBK_CAB004bt2MBK_Gallery4.jpg?sw=700&sh=700&sm=fit&sfrm=png",
  "https://www.belkin.com/dw/image/v2/BGBH_PRD/on/demandware.static/-/Sites-master-product-catalog-blk/default/dw25e82375/images/hi-res/9/25e82375e1a97a79_CAB004bt0MBK_CAB004bt2MBK_Gallery2.jpg?sw=700&sh=700&sm=fit&sfrm=png",
  "https://www.belkin.com/dw/image/v2/BGBH_PRD/on/demandware.static/-/Sites-master-product-catalog-blk/default/dw59b910dd/images/hi-res/b/59b910dd3b7f2c35_CAB004bt0MBK_Gallery5.jpg?sw=700&sh=700&sm=fit&sfrm=png",
  "https://www.belkin.com/dw/image/v2/BGBH_PRD/on/demandware.static/-/Sites-master-product-catalog-blk/default/dw53b7eff4/images/hi-res/5/53b7eff4d0836079_CAB004btBK-boostcharge-braided-usb-c-to-usb-c-cable-doctom-webgg1-6000x6000-us__lz__en_US.jpg?sw=700&sh=700&sm=fit&sfrm=png",
];
const APPLE_MAGSAFE_GALLERY = [
  "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/MGD74_AV1?wid=1000&hei=1000&fmt=jpeg&qlt=95",
  "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/MGD74_AV2?wid=1000&hei=1000&fmt=jpeg&qlt=95",
  "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/MGD74_AV3?wid=1000&hei=1000&fmt=jpeg&qlt=95",
  "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/MGD74_AV4?wid=1000&hei=1000&fmt=jpeg&qlt=95",
];

// ─── iPhone 14/16/17 series images added in CATALOG_CLEANUP_TASK.md
// Phase C — hotlinked from Apple Newsroom announcement pages (same domain
// pattern as the existing iPhone 15-series images above).
const IPHONE_14_HERO_IMG =
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-hero-220907_Full-Bleed-Image.jpg.large.jpg";
const IPHONE_14_GALLERY = [
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-blue-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-midnight-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-purple-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-starlight-220907_inline.jpg.large.jpg",
];
const IPHONE_14_PLUS_GALLERY = [
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-PRODUCT-RED-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-midnight-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-purple-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-starlight-220907_inline.jpg.large.jpg",
];
const IPHONE_14_COLOR_IMG = {
  red: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-PRODUCT-RED-220907_inline.jpg.large.jpg",
  blue: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-blue-220907_inline.jpg.large.jpg",
  midnight: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-midnight-220907_inline.jpg.large.jpg",
  purple: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-purple-220907_inline.jpg.large.jpg",
  starlight: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-iPhone-14-Plus-2up-starlight-220907_inline.jpg.large.jpg",
};

const IPHONE_14_PRO_HERO_IMG =
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-hero-220907_Full-Bleed-Image.jpg.large.jpg";
const IPHONE_14_PRO_GALLERY = [
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-gold-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-silver-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-deep-purple-220907_inline.jpg.large.jpg",
];
const IPHONE_14_PRO_MAX_GALLERY = [
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-space-black-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-gold-220907_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-deep-purple-220907_inline.jpg.large.jpg",
];
const IPHONE_14_PRO_COLOR_IMG = {
  spaceblack: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-space-black-220907_inline.jpg.large.jpg",
  silver: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-silver-220907_inline.jpg.large.jpg",
  gold: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-gold-220907_inline.jpg.large.jpg",
  deeppurple: "https://www.apple.com/newsroom/images/product/iphone/standard/Apple-iPhone-14-Pro-iPhone-14-Pro-Max-deep-purple-220907_inline.jpg.large.jpg",
};

const IPHONE_16_HERO_IMG =
  "https://www.apple.com/newsroom/images/2024/09/apple-introduces-iphone-16-and-iphone-16-plus/tile/Apple-iPhone-16-lineup-240909-lp.jpg.og.jpg";
const IPHONE_16_GALLERY = [
  "https://www.apple.com/newsroom/images/2024/09/apple-introduces-iphone-16-and-iphone-16-plus/article/Apple-iPhone-16-Camera-Control-01-240909_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2024/09/apple-introduces-iphone-16-and-iphone-16-plus/article/Apple-iPhone-16-Camera-Control-02-240909_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2024/09/apple-introduces-iphone-16-and-iphone-16-plus/article/Apple-iPhone-16-Fusion-2x-Telephoto-photography-240909_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2024/09/apple-introduces-iphone-16-and-iphone-16-plus/article/Apple-iPhone-16-Photographic-Styles-01-240909_inline.jpg.large.jpg",
];

const IPHONE_16_PRO_HERO_IMG =
  "https://www.apple.com/newsroom/images/2024/09/apple-debuts-iphone-16-pro-and-iphone-16-pro-max/tile/Apple-iPhone-16-Pro-hero-240909-lp.jpg.og.jpg";
const IPHONE_16_PRO_GALLERY = [
  "https://www.apple.com/newsroom/images/2024/09/apple-debuts-iphone-16-pro-and-iphone-16-pro-max/article/Apple-iPhone-16-Pro-hero-240909_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2024/09/apple-debuts-iphone-16-pro-and-iphone-16-pro-max/article/Apple-iPhone-16-Pro-finish-lineup-240909_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2024/09/apple-debuts-iphone-16-pro-and-iphone-16-pro-max/article/Apple-iPhone-16-Pro-camera-system-240909_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2024/09/apple-debuts-iphone-16-pro-and-iphone-16-pro-max/article/Apple-iPhone-16-Pro-Fusion-photography-01-240909_big.jpg.large.jpg",
];

const IPHONE_16E_HERO_IMG =
  "https://www.apple.com/newsroom/images/2025/02/apple-debuts-iphone-16e-a-powerful-new-member-of-the-iphone-16-family/tile/Apple-iPhone-16e-hero-250219-lp.jpg.og.jpg";
const IPHONE_16E_GALLERY = [
  "https://www.apple.com/newsroom/images/2025/02/apple-debuts-iphone-16e-a-powerful-new-member-of-the-iphone-16-family/article/Apple-iPhone-16e-2-up-250219_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/02/apple-debuts-iphone-16e-a-powerful-new-member-of-the-iphone-16-family/article/Apple-iPhone-16e-color-lineup-back-250219_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/02/apple-debuts-iphone-16e-a-powerful-new-member-of-the-iphone-16-family/article/Apple-iPhone-16e-USB-C-250219_inline.jpg.large.jpg",
];

const IPHONE_17_HERO_IMG =
  "https://www.apple.com/newsroom/images/2025/09/apple-debuts-iphone-17/tile/Apple-iPhone-17-hero-250909-lp.jpg.og.jpg";
const IPHONE_17_GALLERY = [
  "https://www.apple.com/newsroom/images/2025/09/apple-debuts-iphone-17/article/Apple-iPhone-17-color-lineup-250909_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/09/apple-debuts-iphone-17/article/Apple-iPhone-17-lineup-250909_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/09/apple-debuts-iphone-17/article/Apple-iPhone-17-48MP-Fusion-1x-photography-250909_big.jpg.large.jpg",
];

const IPHONE_17_AIR_HERO_IMG =
  "https://www.apple.com/newsroom/images/2025/09/introducing-iphone-air-a-powerful-new-iphone-with-a-breakthrough-design/tile/Apple-iPhone-Air-hero-250909-lp.jpg.og.jpg";
const IPHONE_17_AIR_GALLERY = [
  "https://www.apple.com/newsroom/images/2025/09/introducing-iphone-air-a-powerful-new-iphone-with-a-breakthrough-design/article/Apple-iPhone-Air-color-lineup-250909_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/09/introducing-iphone-air-a-powerful-new-iphone-with-a-breakthrough-design/article/Apple-iPhone-Air-family-lineup-250909_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/09/introducing-iphone-air-a-powerful-new-iphone-with-a-breakthrough-design/article/Apple-iPhone-Air-profile-250909_big.jpg.large.jpg",
];

const IPHONE_17_PRO_HERO_IMG =
  "https://www.apple.com/newsroom/images/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/tile/Apple-iPhone-17-Pro-camera-close-up-250909-lp.jpg.og.jpg";
const IPHONE_17_PRO_GALLERY = [
  "https://www.apple.com/newsroom/images/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/article/Apple-iPhone-17-Pro-color-lineup-250909_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/article/Apple-iPhone-17-Pro-cosmic-orange-250909_inline.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max/article/Apple-iPhone-17-Pro-camera-close-up-250909_big.jpg.large.jpg",
];

const IPHONE_17E_HERO_IMG =
  "https://www.apple.com/newsroom/images/2026/03/apple-introduces-iphone-17e/tile/Apple-iPhone-17e-hero-260302-lp.jpg.og.jpg";
const IPHONE_17E_GALLERY = [
  "https://www.apple.com/newsroom/images/2026/03/apple-introduces-iphone-17e/article/Apple-iPhone-17e-family-lineup-260302_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2026/03/apple-introduces-iphone-17e/article/Apple-iPhone-17e-photography-48MP-260302_big.jpg.large.jpg",
  "https://www.apple.com/newsroom/images/2026/03/apple-introduces-iphone-17e/article/Apple-iPhone-17e-accessories-260302_big.jpg.large.jpg",
];

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
    variants: [
      { sku: "EZW-IPH-001-NAT256", attributes: { color: "Natural Titanium", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-001-NAT512", attributes: { color: "Natural Titanium", storage: "512GB" }, stock: 3 },
      { sku: "EZW-IPH-001-NAT1T", attributes: { color: "Natural Titanium", storage: "1TB" }, stock: 2 },
      { sku: "EZW-IPH-001-BLU256", attributes: { color: "Blue Titanium", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-001-BLU512", attributes: { color: "Blue Titanium", storage: "512GB" }, stock: 2 },
      { sku: "EZW-IPH-001-BLU1T", attributes: { color: "Blue Titanium", storage: "1TB" }, stock: 1 },
      { sku: "EZW-IPH-001-BLK256", attributes: { color: "Black Titanium", storage: "256GB" }, stock: 6 },
      { sku: "EZW-IPH-001-BLK512", attributes: { color: "Black Titanium", storage: "512GB" }, stock: 4 },
      { sku: "EZW-IPH-001-BLK1T", attributes: { color: "Black Titanium", storage: "1TB" }, stock: 2 },
    ],
    specs: [
      { label: "Display", value: "6.7-inch Super Retina XDR, ProMotion 120Hz" },
      { label: "Chipset", value: "Apple A17 Pro" },
      { label: "Camera", value: "48MP Pro camera system" },
      { label: "Battery", value: "Up to 29 hours video playback" },
    ],
    isActive: true,
  },
  {
    // Duplicate of EZW-IPH-004 below (identical variant set — same model,
    // just a separate document from an earlier session). Merged into
    // EZW-IPH-004 and deactivated in the live DB; kept here (rather than
    // removed) so a future seed run doesn't accidentally resurrect it as
    // active — never had any order/review references (checked before
    // merging; see review.md "Duplicate iPhone 15 Pro merge").
    name: "iPhone 15 Pro (512GB)",
    slug: "iphone-15-pro-512gb",
    description:
      "Apple iPhone 15 Pro with 48MP main camera, A17 Pro chip, and advanced titanium frame design.",
    price: 1099999,
    images: [IPHONE_15_PRO_IMG],
    category: "Phones",
    stock: 25,
    sku: "EZW-IPH-002",
    variants: [
      { sku: "EZW-IPH-002-NAT128", attributes: { color: "Natural Titanium", storage: "128GB" }, stock: 4 },
      { sku: "EZW-IPH-002-NAT256", attributes: { color: "Natural Titanium", storage: "256GB" }, stock: 3 },
      { sku: "EZW-IPH-002-NAT512", attributes: { color: "Natural Titanium", storage: "512GB" }, stock: 2 },
      { sku: "EZW-IPH-002-BLU128", attributes: { color: "Blue Titanium", storage: "128GB" }, stock: 5 },
      { sku: "EZW-IPH-002-BLU256", attributes: { color: "Blue Titanium", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-002-BLU512", attributes: { color: "Blue Titanium", storage: "512GB" }, stock: 1 },
      { sku: "EZW-IPH-002-WHT128", attributes: { color: "White Titanium", storage: "128GB" }, stock: 6 },
      { sku: "EZW-IPH-002-WHT256", attributes: { color: "White Titanium", storage: "256GB" }, stock: 3 },
      { sku: "EZW-IPH-002-WHT512", attributes: { color: "White Titanium", storage: "512GB" }, stock: 2 },
    ],
    isActive: false,
  },
  {
    // Surviving/canonical iPhone 15 Pro document after the merge — stock
    // below is the sum of this document's original stock plus the
    // deactivated EZW-IPH-002 duplicate's stock (both were mock numbers
    // for the same never-ordered product; summed rather than picked
    // arbitrarily). See review.md "Duplicate iPhone 15 Pro merge".
    name: "iPhone 15 Pro (256GB)",
    slug: "iphone-15-pro-256gb",
    description:
      "Apple iPhone 15 Pro with A17 Pro chip, titanium frame, and pro-grade 48MP camera.",
    price: 949999,
    images: [IPHONE_15_PRO_TILE_IMG],
    category: "Phones",
    stock: 55,
    sku: "EZW-IPH-004",
    variants: [
      { sku: "EZW-IPH-004-NAT128", attributes: { color: "Natural Titanium", storage: "128GB" }, stock: 9 },
      { sku: "EZW-IPH-004-NAT256", attributes: { color: "Natural Titanium", storage: "256GB" }, stock: 7 },
      { sku: "EZW-IPH-004-NAT512", attributes: { color: "Natural Titanium", storage: "512GB" }, stock: 4 },
      { sku: "EZW-IPH-004-BLU128", attributes: { color: "Blue Titanium", storage: "128GB" }, stock: 11 },
      { sku: "EZW-IPH-004-BLU256", attributes: { color: "Blue Titanium", storage: "256GB" }, stock: 7 },
      { sku: "EZW-IPH-004-BLU512", attributes: { color: "Blue Titanium", storage: "512GB" }, stock: 2 },
      { sku: "EZW-IPH-004-WHT128", attributes: { color: "White Titanium", storage: "128GB" }, stock: 13 },
      { sku: "EZW-IPH-004-WHT256", attributes: { color: "White Titanium", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-004-WHT512", attributes: { color: "White Titanium", storage: "512GB" }, stock: 3 },
    ],
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
    variants: [
      { sku: "EZW-IPH-003-BLK128", attributes: { color: "Black", storage: "128GB" }, stock: 7 },
      { sku: "EZW-IPH-003-BLK256", attributes: { color: "Black", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-003-BLU128", attributes: { color: "Blue", storage: "128GB" }, stock: 6 },
      { sku: "EZW-IPH-003-BLU256", attributes: { color: "Blue", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-003-GRN128", attributes: { color: "Green", storage: "128GB" }, stock: 5 },
      { sku: "EZW-IPH-003-GRN256", attributes: { color: "Green", storage: "256GB" }, stock: 3 },
      { sku: "EZW-IPH-003-PNK128", attributes: { color: "Pink", storage: "128GB" }, stock: 4 },
      { sku: "EZW-IPH-003-PNK256", attributes: { color: "Pink", storage: "256GB" }, stock: 2 },
    ],
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
    variants: [
      { sku: "EZW-SAM-001-TGR256", attributes: { color: "Titanium Gray", storage: "256GB" }, stock: 5 },
      { sku: "EZW-SAM-001-TGR512", attributes: { color: "Titanium Gray", storage: "512GB" }, stock: 4 },
      { sku: "EZW-SAM-001-TGR1T", attributes: { color: "Titanium Gray", storage: "1TB" }, stock: 2 },
      { sku: "EZW-SAM-001-TBK256", attributes: { color: "Titanium Black", storage: "256GB" }, stock: 6 },
      { sku: "EZW-SAM-001-TBK512", attributes: { color: "Titanium Black", storage: "512GB" }, stock: 3 },
      { sku: "EZW-SAM-001-TBK1T", attributes: { color: "Titanium Black", storage: "1TB" }, stock: 2 },
      { sku: "EZW-SAM-001-TV256", attributes: { color: "Titanium Violet", storage: "256GB" }, stock: 4 },
      { sku: "EZW-SAM-001-TV512", attributes: { color: "Titanium Violet", storage: "512GB" }, stock: 3 },
      { sku: "EZW-SAM-001-TV1T", attributes: { color: "Titanium Violet", storage: "1TB" }, stock: 1 },
    ],
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
    variants: [
      { sku: "EZW-SAM-002-ONX128", attributes: { color: "Onyx Black", storage: "128GB" }, stock: 5 },
      { sku: "EZW-SAM-002-ONX256", attributes: { color: "Onyx Black", storage: "256GB" }, stock: 4 },
      { sku: "EZW-SAM-002-ONX512", attributes: { color: "Onyx Black", storage: "512GB" }, stock: 2 },
      { sku: "EZW-SAM-002-MGR128", attributes: { color: "Marble Gray", storage: "128GB" }, stock: 6 },
      { sku: "EZW-SAM-002-MGR256", attributes: { color: "Marble Gray", storage: "256GB" }, stock: 3 },
      { sku: "EZW-SAM-002-MGR512", attributes: { color: "Marble Gray", storage: "512GB" }, stock: 2 },
      { sku: "EZW-SAM-002-CVT128", attributes: { color: "Cobalt Violet", storage: "128GB" }, stock: 4 },
      { sku: "EZW-SAM-002-CVT256", attributes: { color: "Cobalt Violet", storage: "256GB" }, stock: 3 },
      { sku: "EZW-SAM-002-CVT512", attributes: { color: "Cobalt Violet", storage: "512GB" }, stock: 1 },
    ],
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
    variants: [
      { sku: "EZW-SAM-003-ONX128", attributes: { color: "Onyx Black", storage: "128GB" }, stock: 9 },
      { sku: "EZW-SAM-003-ONX256", attributes: { color: "Onyx Black", storage: "256GB" }, stock: 7 },
      { sku: "EZW-SAM-003-MGR128", attributes: { color: "Marble Gray", storage: "128GB" }, stock: 8 },
      { sku: "EZW-SAM-003-MGR256", attributes: { color: "Marble Gray", storage: "256GB" }, stock: 6 },
      { sku: "EZW-SAM-003-CVT128", attributes: { color: "Cobalt Violet", storage: "128GB" }, stock: 5 },
      { sku: "EZW-SAM-003-CVT256", attributes: { color: "Cobalt Violet", storage: "256GB" }, stock: 4 },
    ],
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
    variants: [
      { sku: "EZW-SAM-004-GRP128", attributes: { color: "Graphite", storage: "128GB" }, stock: 8 },
      { sku: "EZW-SAM-004-GRP256", attributes: { color: "Graphite", storage: "256GB" }, stock: 6 },
      { sku: "EZW-SAM-004-GRP512", attributes: { color: "Graphite", storage: "512GB" }, stock: 4 },
      { sku: "EZW-SAM-004-CRM128", attributes: { color: "Cream", storage: "128GB" }, stock: 7 },
      { sku: "EZW-SAM-004-CRM256", attributes: { color: "Cream", storage: "256GB" }, stock: 5 },
      { sku: "EZW-SAM-004-CRM512", attributes: { color: "Cream", storage: "512GB" }, stock: 3 },
      { sku: "EZW-SAM-004-MNT128", attributes: { color: "Mint", storage: "128GB" }, stock: 6 },
      { sku: "EZW-SAM-004-MNT256", attributes: { color: "Mint", storage: "256GB" }, stock: 4 },
      { sku: "EZW-SAM-004-MNT512", attributes: { color: "Mint", storage: "512GB" }, stock: 2 },
    ],
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
    variants: [
      { sku: "EZW-IPH-005-BLK128", attributes: { color: "Black", storage: "128GB" }, stock: 6 },
      { sku: "EZW-IPH-005-BLK256", attributes: { color: "Black", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-005-BLU128", attributes: { color: "Blue", storage: "128GB" }, stock: 5 },
      { sku: "EZW-IPH-005-BLU256", attributes: { color: "Blue", storage: "256GB" }, stock: 3 },
      { sku: "EZW-IPH-005-GRN128", attributes: { color: "Green", storage: "128GB" }, stock: 5 },
      { sku: "EZW-IPH-005-GRN256", attributes: { color: "Green", storage: "256GB" }, stock: 2 },
      { sku: "EZW-IPH-005-PNK128", attributes: { color: "Pink", storage: "128GB" }, stock: 4 },
      { sku: "EZW-IPH-005-PNK256", attributes: { color: "Pink", storage: "256GB" }, stock: 1 },
    ],
    specs: [
      { label: "Display", value: "6.7-inch Super Retina XDR (OLED)" },
      { label: "Chipset", value: "Apple A16 Bionic" },
      { label: "Camera", value: "48MP main + 12MP Ultra Wide" },
      { label: "Battery", value: "Up to 26 hours video playback" },
    ],
    isActive: true,
  },

  // ─── iPhone 14/16/17 series, added CATALOG_CLEANUP_TASK.md Phase C ──
  {
    name: "iPhone 14 (128GB)",
    slug: "iphone-14-128gb",
    description:
      "Apple iPhone 14 with A15 Bionic, a durable dual-camera system with Photonic Engine, and Crash Detection for added safety.",
    price: 599999,
    images: [IPHONE_14_HERO_IMG],
    category: "Phones",
    stock: 32,
    sku: "EZW-IPH-006",
    gallery: { images: IPHONE_14_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.1-inch Super Retina XDR (OLED)" },
      { label: "Chipset", value: "Apple A15 Bionic (5-core GPU)" },
      { label: "Rear Camera", value: "Dual 12MP (Main + Ultra Wide) with Photonic Engine" },
      { label: "Battery", value: "Up to 20 hours video playback" },
      { label: "Safety", value: "Crash Detection, Emergency SOS via satellite" },
      { label: "Connectivity", value: "5G, Lightning port" },
    ],
    variants: [
      { sku: "EZW-IPH-006-RED128", attributes: { color: "(PRODUCT)RED", storage: "128GB" }, stock: 8, images: [IPHONE_14_COLOR_IMG.red] },
      { sku: "EZW-IPH-006-RED256", attributes: { color: "(PRODUCT)RED", storage: "256GB" }, stock: 7, images: [IPHONE_14_COLOR_IMG.red] },
      { sku: "EZW-IPH-006-RED512", attributes: { color: "(PRODUCT)RED", storage: "512GB" }, stock: 6, images: [IPHONE_14_COLOR_IMG.red] },
      { sku: "EZW-IPH-006-BLU128", attributes: { color: "Blue", storage: "128GB" }, stock: 5, images: [IPHONE_14_COLOR_IMG.blue] },
      { sku: "EZW-IPH-006-BLU256", attributes: { color: "Blue", storage: "256GB" }, stock: 4, images: [IPHONE_14_COLOR_IMG.blue] },
      { sku: "EZW-IPH-006-BLU512", attributes: { color: "Blue", storage: "512GB" }, stock: 3, images: [IPHONE_14_COLOR_IMG.blue] },
      { sku: "EZW-IPH-006-MID128", attributes: { color: "Midnight", storage: "128GB" }, stock: 2, images: [IPHONE_14_COLOR_IMG.midnight] },
      { sku: "EZW-IPH-006-MID256", attributes: { color: "Midnight", storage: "256GB" }, stock: 8, images: [IPHONE_14_COLOR_IMG.midnight] },
      { sku: "EZW-IPH-006-MID512", attributes: { color: "Midnight", storage: "512GB" }, stock: 7, images: [IPHONE_14_COLOR_IMG.midnight] },
      { sku: "EZW-IPH-006-PUR128", attributes: { color: "Purple", storage: "128GB" }, stock: 6, images: [IPHONE_14_COLOR_IMG.purple] },
      { sku: "EZW-IPH-006-PUR256", attributes: { color: "Purple", storage: "256GB" }, stock: 5, images: [IPHONE_14_COLOR_IMG.purple] },
      { sku: "EZW-IPH-006-PUR512", attributes: { color: "Purple", storage: "512GB" }, stock: 4, images: [IPHONE_14_COLOR_IMG.purple] },
      { sku: "EZW-IPH-006-STA128", attributes: { color: "Starlight", storage: "128GB" }, stock: 3, images: [IPHONE_14_COLOR_IMG.starlight] },
      { sku: "EZW-IPH-006-STA256", attributes: { color: "Starlight", storage: "256GB" }, stock: 2, images: [IPHONE_14_COLOR_IMG.starlight] },
      { sku: "EZW-IPH-006-STA512", attributes: { color: "Starlight", storage: "512GB" }, stock: 8, images: [IPHONE_14_COLOR_IMG.starlight] },
    ],
    isActive: true,
  },
  {
    name: "iPhone 14 Plus (128GB)",
    slug: "iphone-14-plus-128gb",
    description:
      "Apple iPhone 14 Plus brings the iPhone 14's A15 Bionic power and camera system to a bigger 6.7-inch display with all-day battery life.",
    price: 649999,
    images: [IPHONE_14_HERO_IMG],
    category: "Phones",
    stock: 28,
    sku: "EZW-IPH-007",
    gallery: { images: IPHONE_14_PLUS_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.7-inch Super Retina XDR (OLED)" },
      { label: "Chipset", value: "Apple A15 Bionic (5-core GPU)" },
      { label: "Rear Camera", value: "Dual 12MP (Main + Ultra Wide) with Photonic Engine" },
      { label: "Battery", value: "Up to 26 hours video playback" },
      { label: "Safety", value: "Crash Detection, Emergency SOS via satellite" },
      { label: "Connectivity", value: "5G, Lightning port" },
    ],
    variants: [
      { sku: "EZW-IPH-007-RED128", attributes: { color: "(PRODUCT)RED", storage: "128GB" }, stock: 7, images: [IPHONE_14_COLOR_IMG.red] },
      { sku: "EZW-IPH-007-RED256", attributes: { color: "(PRODUCT)RED", storage: "256GB" }, stock: 6, images: [IPHONE_14_COLOR_IMG.red] },
      { sku: "EZW-IPH-007-RED512", attributes: { color: "(PRODUCT)RED", storage: "512GB" }, stock: 5, images: [IPHONE_14_COLOR_IMG.red] },
      { sku: "EZW-IPH-007-BLU128", attributes: { color: "Blue", storage: "128GB" }, stock: 4, images: [IPHONE_14_COLOR_IMG.blue] },
      { sku: "EZW-IPH-007-BLU256", attributes: { color: "Blue", storage: "256GB" }, stock: 3, images: [IPHONE_14_COLOR_IMG.blue] },
      { sku: "EZW-IPH-007-BLU512", attributes: { color: "Blue", storage: "512GB" }, stock: 2, images: [IPHONE_14_COLOR_IMG.blue] },
      { sku: "EZW-IPH-007-MID128", attributes: { color: "Midnight", storage: "128GB" }, stock: 1, images: [IPHONE_14_COLOR_IMG.midnight] },
      { sku: "EZW-IPH-007-MID256", attributes: { color: "Midnight", storage: "256GB" }, stock: 7, images: [IPHONE_14_COLOR_IMG.midnight] },
      { sku: "EZW-IPH-007-MID512", attributes: { color: "Midnight", storage: "512GB" }, stock: 6, images: [IPHONE_14_COLOR_IMG.midnight] },
      { sku: "EZW-IPH-007-PUR128", attributes: { color: "Purple", storage: "128GB" }, stock: 5, images: [IPHONE_14_COLOR_IMG.purple] },
      { sku: "EZW-IPH-007-PUR256", attributes: { color: "Purple", storage: "256GB" }, stock: 4, images: [IPHONE_14_COLOR_IMG.purple] },
      { sku: "EZW-IPH-007-PUR512", attributes: { color: "Purple", storage: "512GB" }, stock: 3, images: [IPHONE_14_COLOR_IMG.purple] },
      { sku: "EZW-IPH-007-STA128", attributes: { color: "Starlight", storage: "128GB" }, stock: 2, images: [IPHONE_14_COLOR_IMG.starlight] },
      { sku: "EZW-IPH-007-STA256", attributes: { color: "Starlight", storage: "256GB" }, stock: 1, images: [IPHONE_14_COLOR_IMG.starlight] },
      { sku: "EZW-IPH-007-STA512", attributes: { color: "Starlight", storage: "512GB" }, stock: 7, images: [IPHONE_14_COLOR_IMG.starlight] },
    ],
    isActive: true,
  },
  {
    name: "iPhone 14 Pro (128GB)",
    slug: "iphone-14-pro-128gb",
    description:
      "Apple iPhone 14 Pro introduces Dynamic Island, an Always-On display, and a 48MP Main camera powered by the A16 Bionic chip.",
    price: 779999,
    images: [IPHONE_14_PRO_HERO_IMG],
    category: "Phones",
    stock: 24,
    sku: "EZW-IPH-008",
    gallery: { images: IPHONE_14_PRO_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.1-inch Super Retina XDR, ProMotion 120Hz, Dynamic Island" },
      { label: "Chipset", value: "Apple A16 Bionic" },
      { label: "Rear Camera", value: "48MP Main + 12MP Ultra Wide + 12MP Telephoto (3x)" },
      { label: "Battery", value: "Up to 23 hours video playback" },
      { label: "Display Feature", value: "Always-On display" },
      { label: "Connectivity", value: "5G, Lightning port" },
    ],
    variants: [
      { sku: "EZW-IPH-008-BLK128", attributes: { color: "Space Black", storage: "128GB" }, stock: 6, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-008-BLK256", attributes: { color: "Space Black", storage: "256GB" }, stock: 5, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-008-BLK512", attributes: { color: "Space Black", storage: "512GB" }, stock: 4, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-008-BLK1T", attributes: { color: "Space Black", storage: "1TB" }, stock: 3, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-008-SLV128", attributes: { color: "Silver", storage: "128GB" }, stock: 2, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-008-SLV256", attributes: { color: "Silver", storage: "256GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-008-SLV512", attributes: { color: "Silver", storage: "512GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-008-SLV1T", attributes: { color: "Silver", storage: "1TB" }, stock: 6, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-008-GLD128", attributes: { color: "Gold", storage: "128GB" }, stock: 5, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-008-GLD256", attributes: { color: "Gold", storage: "256GB" }, stock: 4, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-008-GLD512", attributes: { color: "Gold", storage: "512GB" }, stock: 3, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-008-GLD1T", attributes: { color: "Gold", storage: "1TB" }, stock: 2, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-008-PUR128", attributes: { color: "Deep Purple", storage: "128GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
      { sku: "EZW-IPH-008-PUR256", attributes: { color: "Deep Purple", storage: "256GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
      { sku: "EZW-IPH-008-PUR512", attributes: { color: "Deep Purple", storage: "512GB" }, stock: 6, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
      { sku: "EZW-IPH-008-PUR1T", attributes: { color: "Deep Purple", storage: "1TB" }, stock: 5, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
    ],
    isActive: true,
  },
  {
    name: "iPhone 14 Pro Max (128GB)",
    slug: "iphone-14-pro-max-128gb",
    description:
      "Apple iPhone 14 Pro Max pairs the Pro camera system and Dynamic Island with a 6.7-inch display and Apple's longest iPhone battery life.",
    price: 899999,
    images: [IPHONE_14_PRO_HERO_IMG],
    category: "Phones",
    stock: 22,
    sku: "EZW-IPH-009",
    gallery: { images: IPHONE_14_PRO_MAX_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.7-inch Super Retina XDR, ProMotion 120Hz, Dynamic Island" },
      { label: "Chipset", value: "Apple A16 Bionic" },
      { label: "Rear Camera", value: "48MP Main + 12MP Ultra Wide + 12MP Telephoto (3x)" },
      { label: "Battery", value: "Up to 29 hours video playback" },
      { label: "Display Feature", value: "Always-On display" },
      { label: "Connectivity", value: "5G, Lightning port" },
    ],
    variants: [
      { sku: "EZW-IPH-009-BLK128", attributes: { color: "Space Black", storage: "128GB" }, stock: 5, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-009-BLK256", attributes: { color: "Space Black", storage: "256GB" }, stock: 4, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-009-BLK512", attributes: { color: "Space Black", storage: "512GB" }, stock: 3, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-009-BLK1T", attributes: { color: "Space Black", storage: "1TB" }, stock: 2, images: [IPHONE_14_PRO_COLOR_IMG.spaceblack] },
      { sku: "EZW-IPH-009-SLV128", attributes: { color: "Silver", storage: "128GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-009-SLV256", attributes: { color: "Silver", storage: "256GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-009-SLV512", attributes: { color: "Silver", storage: "512GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-009-SLV1T", attributes: { color: "Silver", storage: "1TB" }, stock: 5, images: [IPHONE_14_PRO_COLOR_IMG.silver] },
      { sku: "EZW-IPH-009-GLD128", attributes: { color: "Gold", storage: "128GB" }, stock: 4, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-009-GLD256", attributes: { color: "Gold", storage: "256GB" }, stock: 3, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-009-GLD512", attributes: { color: "Gold", storage: "512GB" }, stock: 2, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-009-GLD1T", attributes: { color: "Gold", storage: "1TB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.gold] },
      { sku: "EZW-IPH-009-PUR128", attributes: { color: "Deep Purple", storage: "128GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
      { sku: "EZW-IPH-009-PUR256", attributes: { color: "Deep Purple", storage: "256GB" }, stock: 1, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
      { sku: "EZW-IPH-009-PUR512", attributes: { color: "Deep Purple", storage: "512GB" }, stock: 5, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
      { sku: "EZW-IPH-009-PUR1T", attributes: { color: "Deep Purple", storage: "1TB" }, stock: 4, images: [IPHONE_14_PRO_COLOR_IMG.deeppurple] },
    ],
    isActive: true,
  },
  {
    name: "iPhone 16 (128GB)",
    slug: "iphone-16-128gb",
    description:
      "Apple iPhone 16 with A18 chip, Camera Control, and a 48MP Fusion camera system, built for Apple Intelligence.",
    price: 849999,
    images: [IPHONE_16_HERO_IMG],
    category: "Phones",
    stock: 30,
    sku: "EZW-IPH-010",
    gallery: { images: IPHONE_16_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.1-inch Super Retina XDR (OLED)" },
      { label: "Chipset", value: "Apple A18" },
      { label: "Rear Camera", value: "48MP Fusion + 12MP Ultra Wide with autofocus" },
      { label: "Controls", value: "Camera Control, Action button" },
      { label: "Battery", value: "Best all-day battery life of any iPhone 16-size model" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-010-BLK128", attributes: { color: "Black", storage: "128GB" }, stock: 8 },
      { sku: "EZW-IPH-010-BLK256", attributes: { color: "Black", storage: "256GB" }, stock: 7 },
      { sku: "EZW-IPH-010-BLK512", attributes: { color: "Black", storage: "512GB" }, stock: 6 },
      { sku: "EZW-IPH-010-WHT128", attributes: { color: "White", storage: "128GB" }, stock: 5 },
      { sku: "EZW-IPH-010-WHT256", attributes: { color: "White", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-010-WHT512", attributes: { color: "White", storage: "512GB" }, stock: 3 },
      { sku: "EZW-IPH-010-PNK128", attributes: { color: "Pink", storage: "128GB" }, stock: 2 },
      { sku: "EZW-IPH-010-PNK256", attributes: { color: "Pink", storage: "256GB" }, stock: 8 },
      { sku: "EZW-IPH-010-PNK512", attributes: { color: "Pink", storage: "512GB" }, stock: 7 },
      { sku: "EZW-IPH-010-TEA128", attributes: { color: "Teal", storage: "128GB" }, stock: 6 },
      { sku: "EZW-IPH-010-TEA256", attributes: { color: "Teal", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-010-TEA512", attributes: { color: "Teal", storage: "512GB" }, stock: 4 },
      { sku: "EZW-IPH-010-ULT128", attributes: { color: "Ultramarine", storage: "128GB" }, stock: 3 },
      { sku: "EZW-IPH-010-ULT256", attributes: { color: "Ultramarine", storage: "256GB" }, stock: 2 },
      { sku: "EZW-IPH-010-ULT512", attributes: { color: "Ultramarine", storage: "512GB" }, stock: 8 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 16 Plus (128GB)",
    slug: "iphone-16-plus-128gb",
    description:
      "Apple iPhone 16 Plus brings the A18 chip and 48MP Fusion camera system to a bigger 6.7-inch display with all-day battery life.",
    price: 899999,
    images: [IPHONE_16_HERO_IMG],
    category: "Phones",
    stock: 26,
    sku: "EZW-IPH-011",
    gallery: { images: IPHONE_16_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.7-inch Super Retina XDR (OLED)" },
      { label: "Chipset", value: "Apple A18" },
      { label: "Rear Camera", value: "48MP Fusion + 12MP Ultra Wide with autofocus" },
      { label: "Controls", value: "Camera Control, Action button" },
      { label: "Battery", value: "Best battery life ever in an iPhone" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-011-BLK128", attributes: { color: "Black", storage: "128GB" }, stock: 7 },
      { sku: "EZW-IPH-011-BLK256", attributes: { color: "Black", storage: "256GB" }, stock: 6 },
      { sku: "EZW-IPH-011-BLK512", attributes: { color: "Black", storage: "512GB" }, stock: 5 },
      { sku: "EZW-IPH-011-WHT128", attributes: { color: "White", storage: "128GB" }, stock: 4 },
      { sku: "EZW-IPH-011-WHT256", attributes: { color: "White", storage: "256GB" }, stock: 3 },
      { sku: "EZW-IPH-011-WHT512", attributes: { color: "White", storage: "512GB" }, stock: 2 },
      { sku: "EZW-IPH-011-PNK128", attributes: { color: "Pink", storage: "128GB" }, stock: 1 },
      { sku: "EZW-IPH-011-PNK256", attributes: { color: "Pink", storage: "256GB" }, stock: 7 },
      { sku: "EZW-IPH-011-PNK512", attributes: { color: "Pink", storage: "512GB" }, stock: 6 },
      { sku: "EZW-IPH-011-TEA128", attributes: { color: "Teal", storage: "128GB" }, stock: 5 },
      { sku: "EZW-IPH-011-TEA256", attributes: { color: "Teal", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-011-TEA512", attributes: { color: "Teal", storage: "512GB" }, stock: 3 },
      { sku: "EZW-IPH-011-ULT128", attributes: { color: "Ultramarine", storage: "128GB" }, stock: 2 },
      { sku: "EZW-IPH-011-ULT256", attributes: { color: "Ultramarine", storage: "256GB" }, stock: 1 },
      { sku: "EZW-IPH-011-ULT512", attributes: { color: "Ultramarine", storage: "512GB" }, stock: 7 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 16 Pro (128GB)",
    slug: "iphone-16-pro-128gb",
    description:
      "Apple iPhone 16 Pro features a larger titanium design, A18 Pro chip, and a pro camera system with a 5x Telephoto camera.",
    price: 1049999,
    images: [IPHONE_16_PRO_HERO_IMG],
    category: "Phones",
    stock: 22,
    sku: "EZW-IPH-012",
    gallery: { images: IPHONE_16_PRO_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.3-inch Super Retina XDR, ProMotion 120Hz, Always-On" },
      { label: "Chipset", value: "Apple A18 Pro" },
      { label: "Rear Camera", value: "48MP Fusion + 48MP Ultra Wide + 12MP 5x Telephoto" },
      { label: "Video", value: "4K120 fps Dolby Vision" },
      { label: "Build", value: "Titanium design, Ceramic Shield" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-012-BLK128", attributes: { color: "Black Titanium", storage: "128GB" }, stock: 6 },
      { sku: "EZW-IPH-012-BLK256", attributes: { color: "Black Titanium", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-012-BLK512", attributes: { color: "Black Titanium", storage: "512GB" }, stock: 4 },
      { sku: "EZW-IPH-012-BLK1T", attributes: { color: "Black Titanium", storage: "1TB" }, stock: 3 },
      { sku: "EZW-IPH-012-WHT128", attributes: { color: "White Titanium", storage: "128GB" }, stock: 2 },
      { sku: "EZW-IPH-012-WHT256", attributes: { color: "White Titanium", storage: "256GB" }, stock: 1 },
      { sku: "EZW-IPH-012-WHT512", attributes: { color: "White Titanium", storage: "512GB" }, stock: 1 },
      { sku: "EZW-IPH-012-WHT1T", attributes: { color: "White Titanium", storage: "1TB" }, stock: 6 },
      { sku: "EZW-IPH-012-NAT128", attributes: { color: "Natural Titanium", storage: "128GB" }, stock: 5 },
      { sku: "EZW-IPH-012-NAT256", attributes: { color: "Natural Titanium", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-012-NAT512", attributes: { color: "Natural Titanium", storage: "512GB" }, stock: 3 },
      { sku: "EZW-IPH-012-NAT1T", attributes: { color: "Natural Titanium", storage: "1TB" }, stock: 2 },
      { sku: "EZW-IPH-012-DES128", attributes: { color: "Desert Titanium", storage: "128GB" }, stock: 1 },
      { sku: "EZW-IPH-012-DES256", attributes: { color: "Desert Titanium", storage: "256GB" }, stock: 1 },
      { sku: "EZW-IPH-012-DES512", attributes: { color: "Desert Titanium", storage: "512GB" }, stock: 6 },
      { sku: "EZW-IPH-012-DES1T", attributes: { color: "Desert Titanium", storage: "1TB" }, stock: 5 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 16 Pro Max (128GB)",
    slug: "iphone-16-pro-max-128gb",
    description:
      "Apple iPhone 16 Pro Max pairs the A18 Pro chip and pro camera system with a 6.9-inch display and Apple's longest iPhone battery life.",
    price: 1399999,
    images: [IPHONE_16_PRO_HERO_IMG],
    category: "Phones",
    stock: 20,
    sku: "EZW-IPH-013",
    gallery: { images: IPHONE_16_PRO_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.9-inch Super Retina XDR, ProMotion 120Hz, Always-On" },
      { label: "Chipset", value: "Apple A18 Pro" },
      { label: "Rear Camera", value: "48MP Fusion + 48MP Ultra Wide + 12MP 5x Telephoto" },
      { label: "Video", value: "4K120 fps Dolby Vision" },
      { label: "Build", value: "Titanium design, Ceramic Shield" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-013-BLK256", attributes: { color: "Black Titanium", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-013-BLK512", attributes: { color: "Black Titanium", storage: "512GB" }, stock: 4 },
      { sku: "EZW-IPH-013-BLK1T", attributes: { color: "Black Titanium", storage: "1TB" }, stock: 3 },
      { sku: "EZW-IPH-013-WHT256", attributes: { color: "White Titanium", storage: "256GB" }, stock: 2 },
      { sku: "EZW-IPH-013-WHT512", attributes: { color: "White Titanium", storage: "512GB" }, stock: 1 },
      { sku: "EZW-IPH-013-WHT1T", attributes: { color: "White Titanium", storage: "1TB" }, stock: 1 },
      { sku: "EZW-IPH-013-NAT256", attributes: { color: "Natural Titanium", storage: "256GB" }, stock: 1 },
      { sku: "EZW-IPH-013-NAT512", attributes: { color: "Natural Titanium", storage: "512GB" }, stock: 5 },
      { sku: "EZW-IPH-013-NAT1T", attributes: { color: "Natural Titanium", storage: "1TB" }, stock: 4 },
      { sku: "EZW-IPH-013-DES256", attributes: { color: "Desert Titanium", storage: "256GB" }, stock: 3 },
      { sku: "EZW-IPH-013-DES512", attributes: { color: "Desert Titanium", storage: "512GB" }, stock: 2 },
      { sku: "EZW-IPH-013-DES1T", attributes: { color: "Desert Titanium", storage: "1TB" }, stock: 1 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 16e (128GB)",
    slug: "iphone-16e-128gb",
    description:
      "Apple iPhone 16e delivers the A18 chip and the new Apple C1 modem at a more affordable price, with a 48MP Fusion camera and Apple Intelligence support.",
    price: 649999,
    images: [IPHONE_16E_HERO_IMG],
    category: "Phones",
    stock: 34,
    sku: "EZW-IPH-014",
    gallery: { images: IPHONE_16E_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.1-inch OLED" },
      { label: "Chipset", value: "Apple A18" },
      { label: "Modem", value: "Apple C1 — Apple's first cellular modem" },
      { label: "Rear Camera", value: "Single 48MP Fusion camera" },
      { label: "Battery", value: "Best battery life of any iPhone this size" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-014-BLK128", attributes: { color: "Black", storage: "128GB" }, stock: 9 },
      { sku: "EZW-IPH-014-BLK256", attributes: { color: "Black", storage: "256GB" }, stock: 8 },
      { sku: "EZW-IPH-014-BLK512", attributes: { color: "Black", storage: "512GB" }, stock: 7 },
      { sku: "EZW-IPH-014-WHT128", attributes: { color: "White", storage: "128GB" }, stock: 6 },
      { sku: "EZW-IPH-014-WHT256", attributes: { color: "White", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-014-WHT512", attributes: { color: "White", storage: "512GB" }, stock: 4 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 17 (256GB)",
    slug: "iphone-17-256gb",
    description:
      "Apple iPhone 17 with A19 chip, a larger 6.3-inch display, an 18MP Center Stage front camera, and a 48MP Fusion camera system with 2x Telephoto.",
    price: 949999,
    images: [IPHONE_17_HERO_IMG],
    category: "Phones",
    stock: 30,
    sku: "EZW-IPH-015",
    gallery: { images: IPHONE_17_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.3-inch Super Retina XDR, Ceramic Shield 2" },
      { label: "Chipset", value: "Apple A19" },
      { label: "Rear Camera", value: "48MP Fusion Main (with 2x Telephoto) + 48MP Fusion Ultra Wide" },
      { label: "Front Camera", value: "18MP Center Stage" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-015-LAV256", attributes: { color: "Lavender", storage: "256GB" }, stock: 8 },
      { sku: "EZW-IPH-015-LAV512", attributes: { color: "Lavender", storage: "512GB" }, stock: 7 },
      { sku: "EZW-IPH-015-SAG256", attributes: { color: "Sage", storage: "256GB" }, stock: 6 },
      { sku: "EZW-IPH-015-SAG512", attributes: { color: "Sage", storage: "512GB" }, stock: 5 },
      { sku: "EZW-IPH-015-MST256", attributes: { color: "Mist Blue", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-015-MST512", attributes: { color: "Mist Blue", storage: "512GB" }, stock: 3 },
      { sku: "EZW-IPH-015-WHT256", attributes: { color: "White", storage: "256GB" }, stock: 2 },
      { sku: "EZW-IPH-015-WHT512", attributes: { color: "White", storage: "512GB" }, stock: 8 },
      { sku: "EZW-IPH-015-BLK256", attributes: { color: "Black", storage: "256GB" }, stock: 7 },
      { sku: "EZW-IPH-015-BLK512", attributes: { color: "Black", storage: "512GB" }, stock: 6 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 17 Air (256GB)",
    slug: "iphone-17-air-256gb",
    description:
      "Apple iPhone 17 Air is Apple's thinnest iPhone ever, with an A19 Pro chip, an 18MP Center Stage front camera, and a 48MP Fusion Main camera.",
    price: 1099999,
    images: [IPHONE_17_AIR_HERO_IMG],
    category: "Phones",
    stock: 20,
    sku: "EZW-IPH-016",
    gallery: { images: IPHONE_17_AIR_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.5-inch Super Retina XDR, Ceramic Shield 2" },
      { label: "Chipset", value: "Apple A19 Pro" },
      { label: "Build", value: "Titanium unibody — Apple's thinnest iPhone ever" },
      { label: "Rear Camera", value: "Single 48MP Fusion Main camera" },
      { label: "Front Camera", value: "18MP Center Stage" },
      { label: "Connectivity", value: "eSIM only, 5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-016-SKY256", attributes: { color: "Sky Blue", storage: "256GB" }, stock: 6 },
      { sku: "EZW-IPH-016-SKY512", attributes: { color: "Sky Blue", storage: "512GB" }, stock: 5 },
      { sku: "EZW-IPH-016-GLD256", attributes: { color: "Light Gold", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-016-GLD512", attributes: { color: "Light Gold", storage: "512GB" }, stock: 3 },
      { sku: "EZW-IPH-016-CLW256", attributes: { color: "Cloud White", storage: "256GB" }, stock: 2 },
      { sku: "EZW-IPH-016-CLW512", attributes: { color: "Cloud White", storage: "512GB" }, stock: 1 },
      { sku: "EZW-IPH-016-BLK256", attributes: { color: "Space Black", storage: "256GB" }, stock: 1 },
      { sku: "EZW-IPH-016-BLK512", attributes: { color: "Space Black", storage: "512GB" }, stock: 6 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 17 Pro (256GB)",
    slug: "iphone-17-pro-256gb",
    description:
      "Apple iPhone 17 Pro features an Apple-designed vapor chamber, an A19 Pro chip, and three 48MP Fusion cameras with an all-new Telephoto offering 8x optical-quality zoom.",
    price: 1199999,
    images: [IPHONE_17_PRO_HERO_IMG],
    category: "Phones",
    stock: 20,
    sku: "EZW-IPH-017",
    gallery: { images: IPHONE_17_PRO_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.3-inch Super Retina XDR, Ceramic Shield 2" },
      { label: "Chipset", value: "Apple A19 Pro" },
      { label: "Rear Camera", value: "Three 48MP Fusion cameras — Main, Ultra Wide, and 8x Telephoto" },
      { label: "Build", value: "Aluminum unibody with laser-welded vapor chamber cooling" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-017-ORG256", attributes: { color: "Cosmic Orange", storage: "256GB" }, stock: 6 },
      { sku: "EZW-IPH-017-ORG512", attributes: { color: "Cosmic Orange", storage: "512GB" }, stock: 5 },
      { sku: "EZW-IPH-017-ORG1T", attributes: { color: "Cosmic Orange", storage: "1TB" }, stock: 4 },
      { sku: "EZW-IPH-017-BLU256", attributes: { color: "Deep Blue", storage: "256GB" }, stock: 3 },
      { sku: "EZW-IPH-017-BLU512", attributes: { color: "Deep Blue", storage: "512GB" }, stock: 2 },
      { sku: "EZW-IPH-017-BLU1T", attributes: { color: "Deep Blue", storage: "1TB" }, stock: 1 },
      { sku: "EZW-IPH-017-SLV256", attributes: { color: "Silver", storage: "256GB" }, stock: 1 },
      { sku: "EZW-IPH-017-SLV512", attributes: { color: "Silver", storage: "512GB" }, stock: 6 },
      { sku: "EZW-IPH-017-SLV1T", attributes: { color: "Silver", storage: "1TB" }, stock: 5 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 17 Pro Max (256GB)",
    slug: "iphone-17-pro-max-256gb",
    description:
      "Apple iPhone 17 Pro Max pairs the vapor-chamber-cooled A19 Pro chip and triple 48MP Fusion camera system with a 6.9-inch display and Apple's biggest battery.",
    price: 1499999,
    images: [IPHONE_17_PRO_HERO_IMG],
    category: "Phones",
    stock: 18,
    sku: "EZW-IPH-018",
    gallery: { images: IPHONE_17_PRO_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.9-inch Super Retina XDR, Ceramic Shield 2" },
      { label: "Chipset", value: "Apple A19 Pro" },
      { label: "Rear Camera", value: "Three 48MP Fusion cameras — Main, Ultra Wide, and 8x Telephoto" },
      { label: "Build", value: "Aluminum unibody with laser-welded vapor chamber cooling" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-018-ORG256", attributes: { color: "Cosmic Orange", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-018-ORG512", attributes: { color: "Cosmic Orange", storage: "512GB" }, stock: 4 },
      { sku: "EZW-IPH-018-ORG1T", attributes: { color: "Cosmic Orange", storage: "1TB" }, stock: 3 },
      { sku: "EZW-IPH-018-ORG2T", attributes: { color: "Cosmic Orange", storage: "2TB" }, stock: 2 },
      { sku: "EZW-IPH-018-BLU256", attributes: { color: "Deep Blue", storage: "256GB" }, stock: 1 },
      { sku: "EZW-IPH-018-BLU512", attributes: { color: "Deep Blue", storage: "512GB" }, stock: 1 },
      { sku: "EZW-IPH-018-BLU1T", attributes: { color: "Deep Blue", storage: "1TB" }, stock: 1 },
      { sku: "EZW-IPH-018-BLU2T", attributes: { color: "Deep Blue", storage: "2TB" }, stock: 5 },
      { sku: "EZW-IPH-018-SLV256", attributes: { color: "Silver", storage: "256GB" }, stock: 4 },
      { sku: "EZW-IPH-018-SLV512", attributes: { color: "Silver", storage: "512GB" }, stock: 3 },
      { sku: "EZW-IPH-018-SLV1T", attributes: { color: "Silver", storage: "1TB" }, stock: 2 },
      { sku: "EZW-IPH-018-SLV2T", attributes: { color: "Silver", storage: "2TB" }, stock: 1 },
    ],
    isActive: true,
  },
  {
    name: "iPhone 17e (256GB)",
    slug: "iphone-17e-256gb",
    description:
      "Apple iPhone 17e delivers the A19 chip, a 48MP Fusion camera with 2x Telephoto, Ceramic Shield 2, and MagSafe, now starting at double the storage.",
    price: 749999,
    images: [IPHONE_17E_HERO_IMG],
    category: "Phones",
    stock: 32,
    sku: "EZW-IPH-019",
    gallery: { images: IPHONE_17E_GALLERY, videos: [] },
    specs: [
      { label: "Display", value: "6.1-inch Super Retina XDR, Ceramic Shield 2" },
      { label: "Chipset", value: "Apple A19" },
      { label: "Rear Camera", value: "48MP Fusion Main with 2x optical-quality Telephoto" },
      { label: "Video", value: "4K60 fps Dolby Vision" },
      { label: "Charging", value: "MagSafe support" },
      { label: "Connectivity", value: "5G, USB-C, Apple Intelligence" },
    ],
    variants: [
      { sku: "EZW-IPH-019-BLK256", attributes: { color: "Black", storage: "256GB" }, stock: 9 },
      { sku: "EZW-IPH-019-BLK512", attributes: { color: "Black", storage: "512GB" }, stock: 8 },
      { sku: "EZW-IPH-019-WHT256", attributes: { color: "White", storage: "256GB" }, stock: 7 },
      { sku: "EZW-IPH-019-WHT512", attributes: { color: "White", storage: "512GB" }, stock: 6 },
      { sku: "EZW-IPH-019-PNK256", attributes: { color: "Soft Pink", storage: "256GB" }, stock: 5 },
      { sku: "EZW-IPH-019-PNK512", attributes: { color: "Soft Pink", storage: "512GB" }, stock: 4 },
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
      { sku: "EZW-SPG-001-BLK", attributes: { color: "Black" }, stock: 60, images: [SPIGEN_TOUGH_ARMOR_VARIANT_IMG] },
      { sku: "EZW-SPG-001-BLU", attributes: { color: "Blue" }, stock: 50, images: [SPIGEN_TOUGH_ARMOR_VARIANT_IMG] },
      { sku: "EZW-SPG-001-WHT", attributes: { color: "White" }, stock: 40, images: [SPIGEN_TOUGH_ARMOR_VARIANT_IMG] },
    ],
    // Gallery fixed in CATALOG_CLEANUP_TASK.md Phase B — was leftover
    // Cloudinary demo placeholders unrelated to this product; replaced with
    // real Spigen detail-angle photography (Black is Spigen's only
    // photographed colorway for this SKU — used as the representative
    // image for all 3 variants, same as the hero).
    gallery: {
      images: SPIGEN_TOUGH_ARMOR_GALLERY,
      videos: [],
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
    variants: [
      { sku: "EZW-SUP-001-BLK", attributes: { color: "Black" }, stock: 48 },
      { sku: "EZW-SUP-001-GRY", attributes: { color: "Gray" }, stock: 40 },
      { sku: "EZW-SUP-001-RED", attributes: { color: "Red" }, stock: 32 },
    ],
    gallery: { images: SUPCASE_UB_PRO_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-NIL-001-BLK", attributes: { color: "Black" }, stock: 40 },
      { sku: "EZW-NIL-001-WHT", attributes: { color: "White" }, stock: 34 },
      { sku: "EZW-NIL-001-GRN", attributes: { color: "Green" }, stock: 26 },
    ],
    gallery: { images: NILLKIN_SHIELD_PRO_GALLERY, videos: [] },
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
      { sku: "EZW-UAG-001-CMO", attributes: { color: "Camouflage" }, stock: 12, images: [CLOUD_CASE_GRAY] },
      { sku: "EZW-UAG-001-RED", attributes: { color: "Red" }, stock: 8, images: [CLOUD_CASE_WHITE] },
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
    variants: [
      { sku: "EZW-MOS-001-BLK", attributes: { color: "Black" }, stock: 14 },
      { sku: "EZW-MOS-001-GRY", attributes: { color: "Gray" }, stock: 12 },
      { sku: "EZW-MOS-001-SLV", attributes: { color: "Silver" }, stock: 9 },
    ],
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
    variants: [
      { sku: "EZW-SPG-002-CLR", attributes: { color: "Clear" }, stock: 60 },
      { sku: "EZW-SPG-002-BLK", attributes: { color: "Black" }, stock: 48 },
      { sku: "EZW-SPG-002-BLU", attributes: { color: "Blue" }, stock: 32 },
    ],
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
    variants: [
      { sku: "EZW-NIL-002-BLK", attributes: { color: "Black" }, stock: 34 },
      { sku: "EZW-NIL-002-WHT", attributes: { color: "White" }, stock: 28 },
      { sku: "EZW-NIL-002-SLV", attributes: { color: "Silver" }, stock: 23 },
    ],
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
    variants: [
      { sku: "EZW-RIN-001-BLK", attributes: { color: "Black" }, stock: 44 },
      { sku: "EZW-RIN-001-GRY", attributes: { color: "Gray" }, stock: 38 },
      { sku: "EZW-RIN-001-BLU", attributes: { color: "Blue" }, stock: 28 },
    ],
    gallery: { images: RINGKE_ONYX_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-ESR-001-BLK", attributes: { color: "Black" }, stock: 40 },
      { sku: "EZW-ESR-001-RED", attributes: { color: "Red" }, stock: 30 },
      { sku: "EZW-ESR-001-GRN", attributes: { color: "Green" }, stock: 25 },
    ],
    gallery: { images: ESR_SHOCKPROOF_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-LAM-001-BLK", attributes: { color: "Black" }, stock: 30 },
      { sku: "EZW-LAM-001-BRN", attributes: { color: "Brown" }, stock: 25 },
      { sku: "EZW-LAM-001-NVY", attributes: { color: "Navy" }, stock: 20 },
    ],
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
    variants: [
      { sku: "EZW-OTT-001-BLK", attributes: { color: "Black" }, stock: 20 },
      { sku: "EZW-OTT-001-RED", attributes: { color: "Red" }, stock: 13 },
      { sku: "EZW-OTT-001-BLU", attributes: { color: "Blue" }, stock: 12 },
    ],
    specs: [
      { label: "Material", value: "Multi-layer polycarbonate + synthetic rubber" },
      { label: "Compatibility", value: "iPhone 15 Pro Max (order size variant)" },
      { label: "Protection", value: "Drop tested to MIL-STD-810G" },
      { label: "Extras", value: "Belt-clip holster included" },
    ],
    gallery: { images: OTTERBOX_DEFENDER_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-ANK-001-BLK", attributes: { color: "Black" }, stock: 48 },
      { sku: "EZW-ANK-001-WHT", attributes: { color: "White" }, stock: 32 },
    ],
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
    variants: [
      { sku: "EZW-AMZ-001-M1", attributes: { length: "1m" }, stock: 70 },
      { sku: "EZW-AMZ-001-M2", attributes: { length: "2m" }, stock: 90 },
      { sku: "EZW-AMZ-001-M3", attributes: { length: "3m" }, stock: 40 },
    ],
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
    variants: [],
    gallery: { images: APPLE_MAGSAFE_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-BAS-001-BLK", attributes: { color: "Black" }, stock: 36 },
      { sku: "EZW-BAS-001-WHT", attributes: { color: "White" }, stock: 30 },
      { sku: "EZW-BAS-001-GRY", attributes: { color: "Gray" }, stock: 24 },
    ],
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
    variants: [
      { sku: "EZW-ANK-005-BLK", attributes: { color: "Black" }, stock: 24 },
      { sku: "EZW-ANK-005-WHT", attributes: { color: "White" }, stock: 18 },
      { sku: "EZW-ANK-005-GRY", attributes: { color: "Gray" }, stock: 13 },
    ],
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
    variants: [
      { sku: "EZW-ANK-006-WHT", attributes: { color: "White" }, stock: 75 },
      { sku: "EZW-ANK-006-BLK", attributes: { color: "Black" }, stock: 55 },
    ],
    gallery: { images: ANKER_NANO_20W_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-BLK-001-M1", attributes: { length: "1m" }, stock: 60 },
      { sku: "EZW-BLK-001-M2", attributes: { length: "2m" }, stock: 100 },
    ],
    gallery: { images: BELKIN_BOOSTCHARGE_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-UGR-001-BLK", attributes: { color: "Black" }, stock: 42 },
      { sku: "EZW-UGR-001-WHT", attributes: { color: "White" }, stock: 28 },
    ],
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
    variants: [
      { sku: "EZW-ANK-008-WHT", attributes: { color: "White" }, stock: 65 },
      { sku: "EZW-ANK-008-BLK", attributes: { color: "Black" }, stock: 45 },
    ],
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
    variants: [
      { sku: "EZW-UGR-002-M2", attributes: { length: "2m" }, stock: 80 },
      { sku: "EZW-UGR-002-M3", attributes: { length: "3m" }, stock: 60 },
    ],
    specs: [
      { label: "Length", value: "2m / 3m options" },
      { label: "Power", value: "100W (USB PD 3.0 with E-marker chip)" },
      { label: "Data", value: "USB 2.0, 480Mbps" },
      { label: "Material", value: "Nylon braided jacket" },
    ],
    gallery: { images: UGREEN_100W_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-ANK-002-BLK", attributes: { color: "Black" }, stock: 28 },
      { sku: "EZW-ANK-002-WHT", attributes: { color: "White" }, stock: 20 },
      { sku: "EZW-ANK-002-BLU", attributes: { color: "Blue" }, stock: 12 },
    ],
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
    variants: [
      { sku: "EZW-ANK-003-BLK", attributes: { color: "Black" }, stock: 18 },
      { sku: "EZW-ANK-003-WHT", attributes: { color: "White" }, stock: 13 },
      { sku: "EZW-ANK-003-GRY", attributes: { color: "Gray" }, stock: 9 },
    ],
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
    variants: [
      { sku: "EZW-PHI-001-BLK", attributes: { color: "Black" }, stock: 22 },
      { sku: "EZW-PHI-001-WHT", attributes: { color: "White" }, stock: 17 },
      { sku: "EZW-PHI-001-BLU", attributes: { color: "Blue" }, stock: 11 },
    ],
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
    variants: [
      { sku: "EZW-ANK-007-BLK", attributes: { color: "Black" }, stock: 20 },
      { sku: "EZW-ANK-007-WHT", attributes: { color: "White" }, stock: 15 },
    ],
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
    variants: [
      { sku: "EZW-BAS-002-BLK", attributes: { color: "Black" }, stock: 32 },
      { sku: "EZW-BAS-002-WHT", attributes: { color: "White" }, stock: 23 },
    ],
    gallery: { images: BASEUS_POWERBANK_20000_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-SAM-005-BLK", attributes: { color: "Black" }, stock: 26 },
      { sku: "EZW-SAM-005-WHT", attributes: { color: "White" }, stock: 19 },
    ],
    gallery: { images: SAMSUNG_POWERBANK_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-ANK-009-BLK", attributes: { color: "Black" }, stock: 42 },
      { sku: "EZW-ANK-009-WHT", attributes: { color: "White" }, stock: 28 },
    ],
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
    variants: [
      { sku: "EZW-XIA-001-BLK", attributes: { color: "Black" }, stock: 34 },
      { sku: "EZW-XIA-001-WHT", attributes: { color: "White" }, stock: 26 },
    ],
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
    variants: [
      { sku: "EZW-BAS-003-BLK", attributes: { color: "Black" }, stock: 42 },
      { sku: "EZW-BAS-003-WHT", attributes: { color: "White" }, stock: 28 },
      { sku: "EZW-BAS-003-PNK", attributes: { color: "Pink" }, stock: 15 },
    ],
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
    variants: [
      { sku: "EZW-SNY-001-BLK", attributes: { color: "Black" }, stock: 20 },
      { sku: "EZW-SNY-001-WHT", attributes: { color: "White" }, stock: 10 },
      { sku: "EZW-SNY-001-BLU", attributes: { color: "Blue" }, stock: 5 },
    ],
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
    variants: [
      { sku: "EZW-SAM-006-BLK", attributes: { color: "Black" }, stock: 30 },
      { sku: "EZW-SAM-006-GRY", attributes: { color: "Gray" }, stock: 24 },
      { sku: "EZW-SAM-006-PNK", attributes: { color: "Pink" }, stock: 16 },
    ],
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
    variants: [
      { sku: "EZW-JBL-001-BLK", attributes: { color: "Black" }, stock: 30 },
      { sku: "EZW-JBL-001-WHT", attributes: { color: "White" }, stock: 22 },
      { sku: "EZW-JBL-001-RED", attributes: { color: "Red" }, stock: 13 },
    ],
    // jbl.com only exposed Black colorway photography for this product's
    // gallery — hero is Blue, so this is a representative (not exact-color)
    // match. Logged in review.md.
    gallery: { images: JBL_230NC_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-ANK-004-BLK", attributes: { color: "Black" }, stock: 20 },
      { sku: "EZW-ANK-004-BLU", attributes: { color: "Blue" }, stock: 15 },
      { sku: "EZW-ANK-004-WHT", attributes: { color: "White" }, stock: 10 },
    ],
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
    variants: [],
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
    variants: [
      { sku: "EZW-JBL-002-BLK", attributes: { color: "Black" }, stock: 28 },
      { sku: "EZW-JBL-002-BLU", attributes: { color: "Blue" }, stock: 20 },
      { sku: "EZW-JBL-002-WHT", attributes: { color: "White" }, stock: 12 },
    ],
    // jbl.com only exposed White colorway photography for this product's
    // gallery — hero is Black, same representative-match caveat as 230NC.
    gallery: { images: JBL_510BT_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-JBL-003-BLK", attributes: { color: "Black" }, stock: 18 },
      { sku: "EZW-JBL-003-WHT", attributes: { color: "White" }, stock: 14 },
      { sku: "EZW-JBL-003-BLU", attributes: { color: "Blue" }, stock: 8 },
    ],
    specs: [
      { label: "Battery", value: "Up to 70 hours (ANC off)" },
      { label: "Connectivity", value: "Bluetooth 5.3, multipoint pairing" },
      { label: "Noise Cancelling", value: "Adaptive ANC" },
      { label: "Drivers", value: "40mm dynamic" },
    ],
    gallery: { images: JBL_770NC_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-ANK-010-BLK", attributes: { color: "Black" }, stock: 30 },
      { sku: "EZW-ANK-010-WHT", attributes: { color: "White" }, stock: 20 },
    ],
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
    variants: [
      { sku: "EZW-SPG-003-IP15P", attributes: { model: "iPhone 15 Pro" }, stock: 100 },
      { sku: "EZW-SPG-003-IP15PM", attributes: { model: "iPhone 15 Pro Max" }, stock: 85 },
      { sku: "EZW-SPG-003-GS24", attributes: { model: "Galaxy S24" }, stock: 65 },
    ],
    specs: [
      { label: "Hardness", value: "9H tempered glass" },
      { label: "Thickness", value: "0.33 mm" },
      { label: "Compatibility", value: "iPhone 15 / Galaxy S24 (model specific)" },
      { label: "Extras", value: "Oleophobic coating + easy-install kit" },
    ],
    gallery: { images: SPIGEN_TEMPERED_GLASS_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-SUP-002-IP15", attributes: { model: "iPhone 15" }, stock: 120 },
      { sku: "EZW-SUP-002-IP14", attributes: { model: "iPhone 14" }, stock: 105 },
      { sku: "EZW-SUP-002-GS24", attributes: { model: "Galaxy S24" }, stock: 75 },
    ],
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
    variants: [
      { sku: "EZW-ESR-002-IP15P", attributes: { model: "iPhone 15 Pro" }, stock: 100 },
      { sku: "EZW-ESR-002-GS24U", attributes: { model: "Galaxy S24 Ultra" }, stock: 80 },
    ],
    gallery: { images: ESR_PROTECTOR_GALLERY, videos: [] },
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
    variants: [
      { sku: "EZW-ICA-001-IP15", attributes: { model: "iPhone 15" }, stock: 85 },
      { sku: "EZW-ICA-001-IP15P", attributes: { model: "iPhone 15 Pro" }, stock: 75 },
      { sku: "EZW-ICA-001-IP15PM", attributes: { model: "iPhone 15 Pro Max" }, stock: 60 },
    ],
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
    variants: [
      { sku: "EZW-FLA-001-GS24", attributes: { model: "Galaxy S24" }, stock: 85 },
      { sku: "EZW-FLA-001-GS24P", attributes: { model: "Galaxy S24+" }, stock: 70 },
      { sku: "EZW-FLA-001-GS24U", attributes: { model: "Galaxy S24 Ultra" }, stock: 55 },
    ],
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
    variants: [],
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
    variants: [
      { sku: "EZW-BLK-002-IP15", attributes: { model: "iPhone 15" }, stock: 60 },
      { sku: "EZW-BLK-002-IP14", attributes: { model: "iPhone 14" }, stock: 50 },
      { sku: "EZW-BLK-002-GS24", attributes: { model: "Galaxy S24" }, stock: 40 },
    ],
    specs: [
      { label: "Material", value: "Chemically strengthened glass" },
      { label: "Drop Protection", value: "2x stronger than standard glass" },
      { label: "Compatibility", value: "iPhone 15 / 14, Galaxy S24 (model specific)" },
      { label: "Finish", value: "Oleophobic + anti-glare" },
    ],
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
  const db = resolveDbUrl();
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");
  logDbTarget();

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
