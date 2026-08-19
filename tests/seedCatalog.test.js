const request = require("supertest");
const app = require("../app");
const Product = require("../models/Product");
const ProductReview = require("../models/ProductReview");
const { PRODUCTS } = require("../src/seedEcommerce");
const {
  PRODUCT_REVIEWS,
  NEW_PRODUCT_SLUGS,
  seedUsers,
  seedReviews,
} = require("../src/seedProductReviews");

const NEW_PRODUCTS = PRODUCTS.filter((p) => NEW_PRODUCT_SLUGS.includes(p.slug));

// Original seed products backfilled with specs as a spot-check.
const SPOT_CHECK_SLUGS = [
  "iphone-15-pro-max-1tb",
  "samsung-galaxy-s24-ultra-512gb",
  "spigen-tempered-glass-screen-protector",
  "anker-powercore-20000",
];

async function seedCatalog() {
  await Product.bulkWrite(
    PRODUCTS.map((p) => ({
      updateOne: { filter: { slug: p.slug }, update: { $set: p }, upsert: true },
    })),
  );
  await seedUsers();
  await seedReviews();
}

const expectedSummary = (slug) => {
  const reviews = PRODUCT_REVIEWS.filter((r) => r.productSlug === slug);
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return { average: Math.round(avg * 10) / 10, count: reviews.length };
};

describe("Seeded catalog + product reviews", () => {
  it("keeps slugs and SKUs unique across the full seed catalog", () => {
    const slugs = PRODUCTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const skus = PRODUCTS.map((p) => p.sku).filter(Boolean);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it("adds 14 new products across all six categories", () => {
    expect(NEW_PRODUCTS).toHaveLength(14);
    const cats = new Set(NEW_PRODUCTS.map((p) => p.category));
    for (const category of ["Phones", "Phone Cases & Covers", "Chargers & Cables", "Power Banks", "Earphones & Headphones", "Screen Protectors"]) {
      expect(cats.has(category)).toBe(true);
    }
  });

  // Bumped from the 30s default: seedCatalog() now bulk-upserts 71 products
  // (was 57 before CATALOG_CLEANUP_TASK.md Phase C added 14 iPhones), and
  // this test makes ~18 sequential API round-trips on top of that — fine
  // in isolation but can cross 30s under full-suite parallel load.
  it("seeds structured specs for new + spot-check products and serves them via the API", async () => {
    await seedCatalog();

    for (const slug of [...NEW_PRODUCT_SLUGS, ...SPOT_CHECK_SLUGS]) {
      const res = await request(app).get(`/api/v1/products/${slug}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.specs)).toBe(true);
      expect(res.body.data.specs.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.specs.length).toBeLessThanOrEqual(4);
      for (const spec of res.body.data.specs) {
        expect(typeof spec.label).toBe("string");
        expect(spec.label.length).toBeGreaterThan(0);
        expect(typeof spec.value).toBe("string");
        expect(spec.value.length).toBeGreaterThan(0);
      }
    }
  }, 60000);

  it("seeds the catalog and computes correct rating summaries via the API", async () => {
    await seedCatalog();

    const active = await Product.find({ isActive: true }).select("category").lean();
    const counts = active.reduce((acc, p) => {
      acc[p.category] = (acc[p.category] || 0) + 1;
      return acc;
    }, {});
    // Phones went from 9 to 22 (CATALOG_CLEANUP_TASK.md Phase C: 14 new
    // iPhone 14/16/17-series models added, 1 pre-existing duplicate iPhone
    // 15 Pro document deactivated). Other categories unchanged.
    expect(counts["Phones"]).toBe(22);
    expect(counts["Phone Cases & Covers"]).toBe(13);
    expect(counts["Chargers & Cables"]).toBe(10);
    expect(counts["Power Banks"]).toBe(9);
    expect(counts["Earphones & Headphones"]).toBe(9);
    expect(counts["Screen Protectors"]).toBe(7);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(70);

    // Every new product must expose the seeded reviews' rating summary.
    for (const slug of NEW_PRODUCT_SLUGS) {
      const res = await request(app).get(`/api/v1/products/${slug}`);
      expect(res.status).toBe(200);
      expect(res.body.data.ratingSummary).toEqual(expectedSummary(slug));
    }

    // Public review list matches the seeded reviewers.
    const product = await Product.findOne({ slug: NEW_PRODUCT_SLUGS[0] });
    const list = await request(app).get(`/api/v1/products/${product._id}/reviews`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(expectedSummary(NEW_PRODUCT_SLUGS[0]).count);
    expect(list.body.data[0].userName).toBeTruthy();
  }, 60000);

  it("seeds idempotently and enforces one review per user per product", async () => {
    await seedCatalog();
    const firstCount = await ProductReview.countDocuments();
    await seedCatalog();
    const secondCount = await ProductReview.countDocuments();

    expect(firstCount).toBe(PRODUCT_REVIEWS.length);
    expect(secondCount).toBe(firstCount);

    const dupes = await ProductReview.aggregate([
      { $group: { _id: { product: "$product", user: "$user" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]);
    expect(dupes).toHaveLength(0);
  });
});