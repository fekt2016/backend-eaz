// The shop's browse bar is built from the categories actually in use, not a
// hardcoded list (owner request, 2026-09-04). Categories are typed freely on the
// item form, so anything outside the old six names had no button — repair parts
// especially, which carry their own taxonomy.
const request = require("supertest");
const Product = require("../models/Product");
const app = require("../app");
// The endpoint caches for a minute, so a suite that seeds between requests has
// to drop it — the same reason the publish migration's effect is not instant.
const { clearCategoryCache } = require("../controllers/productController");

const BASE = "/api/v1/products/categories";

async function seed() {
  await Product.create([
    { name: "Case A",  slug: "ca", price: 5000,  category: "Phone Cases & Covers", sellOnline: true },
    { name: "Case B",  slug: "cb", price: 5000,  category: "Phone Cases & Covers", sellOnline: true },
    { name: "Case C",  slug: "cc", price: 5000,  category: "Phone Cases & Covers", sellOnline: true },
    { name: "Screen A", slug: "sa", price: 30000, category: "Screen", sellOnline: true },
    { name: "Screen B", slug: "sb", price: 30000, category: "Screen", sellOnline: true },
    { name: "Pixel",   slug: "px", price: 90000, category: "Phones", sellOnline: true },
    // Hidden stock must not put a button in the customer's browse bar.
    { name: "Hidden Battery", slug: "hb", price: 12000, category: "Battery", sellOnline: false },
  ]);
}

const names = (res) => res.body.data.map((c) => c.category);

describe("GET /products/categories", () => {
  beforeEach(() => clearCategoryCache());
  it("returns the categories actually in use, busiest first", async () => {
    await seed();
    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 3 cases > 2 screens > 1 phone
    expect(names(res)).toEqual(["Phone Cases & Covers", "Screen", "Phones"]);
    expect(res.body.data[0].count).toBe(3);
  });

  it("includes a repair-taxonomy category once its stock is on sale", async () => {
    await seed();
    // Exactly what the publish migration does.
    await Product.updateMany({ sellOnline: { $ne: true } }, { $set: { sellOnline: true, isActive: true } });
    clearCategoryCache(); // a direct DB write cannot invalidate it by itself

    const res = await request(app).get(BASE);
    expect(names(res)).toContain("Battery");
  });

  it("omits categories no sellable item carries", async () => {
    await seed();
    const res = await request(app).get(BASE);
    expect(names(res)).not.toContain("Battery");
  });

  it("is public — the shop bar renders for signed-out visitors", async () => {
    await seed();
    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
  });
});
