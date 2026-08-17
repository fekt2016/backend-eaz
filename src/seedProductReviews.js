const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("../models/User");
const Product = require("../models/Product");
const ProductReview = require("../models/ProductReview");
const { getRatingSummary } = require("../controllers/productReviewController");

// Mock customers created purely so the seeded reviews have a real user ref.
// Passwords satisfy the User schema but these accounts are not advertised
// anywhere — the review names are what the shop displays.
const MOCK_PASSWORD = "MockPass123!";

const MOCK_USERS = [
  { name: "Kofi Mensah", email: "kofi.mensah@example.com" },
  { name: "Ama Serwaa", email: "ama.serwaa@example.com" },
  { name: "Kwame Asante", email: "kwame.asante@example.com" },
  { name: "Efua Boateng", email: "efua.boateng@example.com" },
  { name: "Yaw Owusu", email: "yaw.owusu@example.com" },
  { name: "Abena Nkrumah", email: "abena.nkrumah@example.com" },
  { name: "Kojo Adjei", email: "kojo.adjei@example.com" },
  { name: "Akosua Frimpong", email: "akosua.frimpong@example.com" },
  { name: "Nana Yaa Darko", email: "nana.darko@example.com" },
  { name: "Kwabena Osei", email: "kwabena.osei@example.com" },
  { name: "Adwoa Amoah", email: "adwoa.amoah@example.com" },
  { name: "Kweku Tetteh", email: "kweku.tetteh@example.com" },
  { name: "Ama Ansah", email: "ama.ansah@example.com" },
  { name: "Kwesi Appiah", email: "kwesi.appiah@example.com" },
  { name: "Esi Gyamfi", email: "esi.gyamfi@example.com" },
  { name: "Kwame Ofori", email: "kwame.ofori@example.com" },
];

// productSlug + userEmail identify a review; the (product, user) pair is
// unique, so re-running this seed upserts rather than duplicates. Ratings
// lean 4–5 with one or two 3-star reviews per product for a realistic mix.
const PRODUCT_REVIEWS = [
  // ─── iPhone 15 Plus ───────────────────────────────────────
  { productSlug: "iphone-15-plus-256gb", userEmail: "kofi.mensah@example.com", rating: 5, comment: "Lovely display and the battery easily lasts me a full day of work." },
  { productSlug: "iphone-15-plus-256gb", userEmail: "ama.serwaa@example.com", rating: 5, comment: "Upgraded from an older iPhone and the camera quality is a huge step up." },
  { productSlug: "iphone-15-plus-256gb", userEmail: "kwame.asante@example.com", rating: 4, comment: "Great phone overall, though I wish it came with a charger in the box." },
  { productSlug: "iphone-15-plus-256gb", userEmail: "efua.boateng@example.com", rating: 3, comment: "Solid device but the delivery took longer than the promised two days." },

  // ─── OtterBox Defender ────────────────────────────────────
  { productSlug: "otterbox-defender-case", userEmail: "yaw.owusu@example.com", rating: 5, comment: "Drop-tested it twice already and my phone is perfectly protected." },
  { productSlug: "otterbox-defender-case", userEmail: "abena.nkrumah@example.com", rating: 4, comment: "Feels very sturdy. Slightly bulky but the protection is worth it." },
  { productSlug: "otterbox-defender-case", userEmail: "kojo.adjei@example.com", rating: 3, comment: "Good protection but the case is harder to fit than I expected." },

  // ─── Spigen Ultra Hybrid ──────────────────────────────────
  { productSlug: "spigen-ultra-hybrid-case", userEmail: "akosua.frimpong@example.com", rating: 5, comment: "Clear back shows off the phone colour and it still looks new after a month." },
  { productSlug: "spigen-ultra-hybrid-case", userEmail: "nana.darko@example.com", rating: 4, comment: "Solid case with good grip. Fingerprints show a bit on the back." },
  { productSlug: "spigen-ultra-hybrid-case", userEmail: "kwabena.osei@example.com", rating: 4, comment: "Light and slim. Buttons are clicky and easy to press." },

  // ─── Anker 20W Adapter ────────────────────────────────────
  { productSlug: "anker-20w-usb-c-power-adapter", userEmail: "adwoa.amoah@example.com", rating: 4, comment: "Charges my phone quickly and stays cool even during fast charging." },
  { productSlug: "anker-20w-usb-c-power-adapter", userEmail: "kweku.tetteh@example.com", rating: 5, comment: "Compact design that fits behind the bed stand, no more loose charger." },
  { productSlug: "anker-20w-usb-c-power-adapter", userEmail: "ama.ansah@example.com", rating: 3, comment: "Works fine, but the plug feels a little loose in some wall sockets." },

  // ─── UGREEN 100W Cable ────────────────────────────────────
  { productSlug: "ugreen-100w-braided-usb-c-cable", userEmail: "kwesi.appiah@example.com", rating: 5, comment: "Charges my laptop and phone with no issues, the braided build feels premium." },
  { productSlug: "ugreen-100w-braided-usb-c-cable", userEmail: "esi.gyamfi@example.com", rating: 4, comment: "Long cable with good quality. A bit stiff but stays coiled nicely." },
  { productSlug: "ugreen-100w-braided-usb-c-cable", userEmail: "kwame.ofori@example.com", rating: 4, comment: "Handles fast charging well and has survived daily bending so far." },

  // ─── Anker PowerCore Slim ─────────────────────────────────
  { productSlug: "anker-powercore-slim-10000", userEmail: "kofi.mensah@example.com", rating: 5, comment: "Small enough for my pocket and it charges my phone two full times." },
  { productSlug: "anker-powercore-slim-10000", userEmail: "ama.serwaa@example.com", rating: 5, comment: "Great battery life and the slim build fits perfectly in my bag." },
  { productSlug: "anker-powercore-slim-10000", userEmail: "yaw.owusu@example.com", rating: 4, comment: "Reliable and fast, just wish the included cable was a bit longer." },
  { productSlug: "anker-powercore-slim-10000", userEmail: "abena.nkrumah@example.com", rating: 3, comment: "Charges well but takes a long time to refill the power bank itself." },

  // ─── Xiaomi Power Bank 3 ──────────────────────────────────
  { productSlug: "xiaomi-mi-power-bank-3-20000mah", userEmail: "kojo.adjei@example.com", rating: 4, comment: "Huge capacity that keeps my devices running through a whole trip." },
  { productSlug: "xiaomi-mi-power-bank-3-20000mah", userEmail: "akosua.frimpong@example.com", rating: 5, comment: "Excellent value for the capacity and it charges three devices at once." },
  { productSlug: "xiaomi-mi-power-bank-3-20000mah", userEmail: "nana.darko@example.com", rating: 4, comment: "Solid build and reliable output, though it is a little heavy." },

  // ─── Baseus Mini Power Bank ───────────────────────────────
  { productSlug: "baseus-10000mah-mini-power-bank", userEmail: "kwabena.osei@example.com", rating: 5, comment: "Perfect size for daily carry and the fast charge is genuinely quick." },
  { productSlug: "baseus-10000mah-mini-power-bank", userEmail: "adwoa.amoah@example.com", rating: 4, comment: "Slim and handy with a clear capacity display on the side." },
  { productSlug: "baseus-10000mah-mini-power-bank", userEmail: "kweku.tetteh@example.com", rating: 4, comment: "Great backup for long commutes, charges my phone about one and a half times." },

  // ─── JBL Tune 770NC ───────────────────────────────────────
  { productSlug: "jbl-tune-770nc-headphones", userEmail: "ama.ansah@example.com", rating: 5, comment: "Noise cancelling is superb and the bass is punchy for this price." },
  { productSlug: "jbl-tune-770nc-headphones", userEmail: "kwesi.appiah@example.com", rating: 5, comment: "Comfortable for long listening sessions and the battery lasts days." },
  { productSlug: "jbl-tune-770nc-headphones", userEmail: "esi.gyamfi@example.com", rating: 4, comment: "Great sound quality, though the ear cups get warm after a few hours." },
  { productSlug: "jbl-tune-770nc-headphones", userEmail: "kwame.ofori@example.com", rating: 3, comment: "Sound is good but the ANC lets in more noise than I expected on the bus." },

  // ─── Anker Soundcore Space A40 ────────────────────────────
  { productSlug: "anker-soundcore-space-a40", userEmail: "kofi.mensah@example.com", rating: 5, comment: "Tiny case, huge battery life, and the noise cancelling works really well." },
  { productSlug: "anker-soundcore-space-a40", userEmail: "ama.serwaa@example.com", rating: 5, comment: "Clear calls and a comfortable fit, perfect for all-day remote work." },
  { productSlug: "anker-soundcore-space-a40", userEmail: "kojo.adjei@example.com", rating: 4, comment: "Impressive sound for the size, the app EQ also helps tune it to taste." },

  // ─── iCarez Screen Protector ──────────────────────────────
  { productSlug: "icarez-screen-protector-iphone-15", userEmail: "akosua.frimpong@example.com", rating: 5, comment: "Applied without bubbles and it fits the curved screen edges perfectly." },
  { productSlug: "icarez-screen-protector-iphone-15", userEmail: "nana.darko@example.com", rating: 4, comment: "Good clarity and touch sensitivity, smudges wipe off very easily." },
  { productSlug: "icarez-screen-protector-iphone-15", userEmail: "kwabena.osei@example.com", rating: 4, comment: "Nice matte feel and it has already saved my screen from one drop." },

  // ─── Flasfit Tempered Glass ───────────────────────────────
  { productSlug: "flasfit-tempered-glass-samsung-s24", userEmail: "adwoa.amoah@example.com", rating: 4, comment: "Fits the screen edge to edge and the installation kit made it effortless." },
  { productSlug: "flasfit-tempered-glass-samsung-s24", userEmail: "kweku.tetteh@example.com", rating: 5, comment: "Crystal clear and fingerprint resistant, exactly what I needed." },
  { productSlug: "flasfit-tempered-glass-samsung-s24", userEmail: "ama.ansah@example.com", rating: 4, comment: "Great value for a 2-pack, the second one is already my backup." },

  // ─── Whitestone Dome Glass ────────────────────────────────
  { productSlug: "whitestone-dome-glass-iphone-15-pro-max", userEmail: "kwesi.appiah@example.com", rating: 5, comment: "Expensive but the install is flawless and it feels factory made." },
  { productSlug: "whitestone-dome-glass-iphone-15-pro-max", userEmail: "esi.gyamfi@example.com", rating: 4, comment: "Excellent protection and clarity, the UV install takes a steady hand." },

  // ─── Belkin UltraGlass ────────────────────────────────────
  { productSlug: "belkin-ultraglass-screen-protector", userEmail: "kwame.ofori@example.com", rating: 4, comment: "Feels like there is no protector on at all, the clarity is that good." },
  { productSlug: "belkin-ultraglass-screen-protector", userEmail: "kofi.mensah@example.com", rating: 4, comment: "Durable and easy to clean, already survived two weeks of pocket use." },
  { productSlug: "belkin-ultraglass-screen-protector", userEmail: "abena.nkrumah@example.com", rating: 3, comment: "Good protector but it did not cover the very edge of my phone screen." },
];

const NEW_PRODUCT_SLUGS = [
  "iphone-15-plus-256gb",
  "otterbox-defender-case",
  "spigen-ultra-hybrid-case",
  "anker-20w-usb-c-power-adapter",
  "ugreen-100w-braided-usb-c-cable",
  "anker-powercore-slim-10000",
  "xiaomi-mi-power-bank-3-20000mah",
  "baseus-10000mah-mini-power-bank",
  "jbl-tune-770nc-headphones",
  "anker-soundcore-space-a40",
  "icarez-screen-protector-iphone-15",
  "flasfit-tempered-glass-samsung-s24",
  "whitestone-dome-glass-iphone-15-pro-max",
  "belkin-ultraglass-screen-protector",
];

// Upsert mock users by email. New users go through User.create() so the
// password pre-save hook hashes them; existing users only get their name
// refreshed (password untouched).
async function seedUsers() {
  let created = 0;
  let renamed = 0;
  let unchanged = 0;
  for (const u of MOCK_USERS) {
    const existing = await User.findOne({ email: u.email }).select("name");
    if (!existing) {
      await User.create({
        name: u.name,
        email: u.email,
        password: MOCK_PASSWORD,
        isVerified: true,
      });
      created += 1;
    } else if (existing.name !== u.name) {
      await User.updateOne({ _id: existing._id }, { $set: { name: u.name } });
      renamed += 1;
    } else {
      unchanged += 1;
    }
  }
  return { created, renamed, unchanged };
}

// Upsert reviews by (product, user) — idempotent across runs, and the unique
// compound index guarantees one review per user per product.
async function seedReviews() {
  const slugs = [...new Set(PRODUCT_REVIEWS.map((r) => r.productSlug))];
  const emails = [...new Set(PRODUCT_REVIEWS.map((r) => r.userEmail))];
  const [products, users] = await Promise.all([
    Product.find({ slug: { $in: slugs } }).select("_id slug"),
    User.find({ email: { $in: emails } }).select("_id email"),
  ]);
  const productIdBySlug = new Map(products.map((p) => [p.slug, p._id]));
  const userIdByEmail = new Map(users.map((u) => [u.email, u._id]));

  let inserted = 0;
  let modified = 0;
  let skipped = 0;
  for (const r of PRODUCT_REVIEWS) {
    const productId = productIdBySlug.get(r.productSlug);
    const userId = userIdByEmail.get(r.userEmail);
    if (!productId || !userId) {
      console.warn(`[seedProductReviews] skipping review for ${r.productSlug} / ${r.userEmail} (missing product or user)`);
      skipped += 1;
      continue;
    }
    const res = await ProductReview.updateOne(
      { product: productId, user: userId },
      { $set: { rating: r.rating, comment: r.comment, approved: true } },
      { upsert: true },
    );
    if (res.upsertedCount) inserted += 1;
    else if (res.modifiedCount) modified += 1;
    else skipped += 1;
  }
  return { inserted, modified, skipped };
}

// Confirm the real getRatingSummary aggregation agrees with the seeded data.
async function verifyRatingSummaries() {
  const results = [];
  for (const slug of NEW_PRODUCT_SLUGS) {
    const product = await Product.findOne({ slug }).select("_id name");
    if (!product) {
      results.push({ slug, error: "product not found" });
      continue;
    }
    const summary = await getRatingSummary(product._id);
    const reviews = PRODUCT_REVIEWS.filter((r) => r.productSlug === slug);
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    const expected = {
      average: Math.round(avg * 10) / 10,
      count: reviews.length,
    };
    results.push({
      slug,
      name: product.name,
      summary,
      expected,
      ok: summary.count === expected.count && summary.average === expected.average,
    });
  }
  return results;
}

async function printCategoryBreakdown() {
  const breakdown = await Product.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  for (const b of breakdown) console.log(`  ${b._id}: ${b.count}`);
  return breakdown;
}

async function run() {
  dotenv.config({ path: "./.env" });
  const mongoUrlRaw =
    process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!mongoUrlRaw) {
    throw new Error("MONGO_URL is not defined in environment variables");
  }
  const dbPassword =
    process.env.DATABASE_PASSWORD || process.env.database_password;
  const db =
    mongoUrlRaw.includes("<PASSWORD>") && dbPassword
      ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
      : mongoUrlRaw;

  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");

  const u = await seedUsers();
  console.log(
    `Mock users — ${u.created} created, ${u.renamed} renamed, ${u.unchanged} unchanged`,
  );

  const r = await seedReviews();
  console.log(
    `Product reviews — ${r.inserted} inserted, ${r.modified} updated, ${r.skipped} skipped`,
  );

  console.log("Rating summary verification (real getRatingSummary aggregation):");
  let failures = 0;
  for (const row of await verifyRatingSummaries()) {
    if (row.error) {
      console.log(`  ${row.slug}: ERROR ${row.error}`);
      failures += 1;
      continue;
    }
    if (!row.ok) failures += 1;
    console.log(
      `  ${row.slug}: ${JSON.stringify(row.summary)} expected ${JSON.stringify(row.expected)} ${row.ok ? "OK" : "MISMATCH"}`,
    );
  }

  console.log("Active products by category:");
  await printCategoryBreakdown();

  const totalReviews = await ProductReview.countDocuments();
  const totalUsers = await User.countDocuments({ email: { $regex: /@example\.com$/ } });
  console.log(`Totals — product reviews: ${totalReviews}, mock users: ${totalUsers}`);

  await mongoose.connection.close();
  console.log(
    failures === 0
      ? "Seed complete — all rating summaries verified"
      : `Seed complete — ${failures} rating summary mismatch(es)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

module.exports = {
  MOCK_USERS,
  PRODUCT_REVIEWS,
  NEW_PRODUCT_SLUGS,
  MOCK_PASSWORD,
  seedUsers,
  seedReviews,
  verifyRatingSummaries,
  printCategoryBreakdown,
};

if (require.main === module) {
  run().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
