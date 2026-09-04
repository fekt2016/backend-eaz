// T110: bench stock and shop stock share one Product collection, so "parts vs
// accessories vs other" is a property of the document rather than a table. This
// pins the three buckets down — they must partition the collection with no item
// in two buckets and none left out.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");

async function adminToken() {
  const user = await User.create({
    name: "admin",
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role: "admin",
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function seed() {
  await Product.create([
    // Parts — on the repair taxonomy
    { name: "iPhone 12 Screen", slug: "s1", price: 30000, category: "Other", partCategory: "Screen" },
    { name: "Samsung Battery",  slug: "s2", price: 12000, category: "Other", partCategory: "Battery" },
    // Bench stock filed under the repair taxonomy's own "Accessory" type — it
    // belongs with accessories, not parts.
    { name: "Bench Lanyard",    slug: "s8", price: 2000,  category: "Other", partCategory: "Accessory" },
    // Accessories — shop add-ons
    { name: "Silicone Case",    slug: "s3", price: 5000,  category: "Phone Cases & Covers" },
    { name: "20W Charger",      slug: "s4", price: 9000,  category: "Chargers & Cables" },
    { name: "Power Bank 10k",   slug: "s5", price: 22000, category: "Power Banks" },
    // Other — a phone, and a category nobody has classified yet
    { name: "Pixel 8",          slug: "s6", price: 450000, category: "Phones" },
    { name: "Mystery Gadget",   slug: "s7", price: 1000,  category: "Uncategorised" },
  ]);
}

const BASE = "/api/v1/pos/inventory";
const names = (res) => res.body.data.map((d) => d.name).sort();

describe("GET /pos/inventory?kind= (T110)", () => {
  it("returns only repair-taxonomy items for kind=parts", async () => {
    const token = await adminToken();
    await seed();

    const res = await request(app).get(`${BASE}?kind=parts`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["Samsung Battery", "iPhone 12 Screen"]);
    expect(names(res)).not.toContain("Bench Lanyard");
  });

  it("returns only shop add-ons for kind=accessories", async () => {
    const token = await adminToken();
    await seed();

    const res = await request(app).get(`${BASE}?kind=accessories`).set("Authorization", `Bearer ${token}`);

    expect(names(res)).toEqual(["20W Charger", "Bench Lanyard", "Power Bank 10k", "Silicone Case"]);
  });

  it("puts phones and unclassified categories in kind=other", async () => {
    const token = await adminToken();
    await seed();

    const res = await request(app).get(`${BASE}?kind=other`).set("Authorization", `Bearer ${token}`);

    // A new shop category is deliberately "other", not silently an accessory.
    expect(names(res)).toEqual(["Mystery Gadget", "Pixel 8"]);
  });

  it("partitions the collection — every item in exactly one bucket", async () => {
    const token = await adminToken();
    await seed();

    const all = await request(app).get(BASE).set("Authorization", `Bearer ${token}`);
    const buckets = await Promise.all(
      ["parts", "accessories", "other"].map((k) =>
        request(app).get(`${BASE}?kind=${k}`).set("Authorization", `Bearer ${token}`),
      ),
    );

    const collected = buckets.flatMap((b) => b.body.data.map((d) => String(d._id)));
    expect(new Set(collected).size).toBe(collected.length);   // no item in two buckets
    expect(collected.length).toBe(all.body.data.length);      // none left out
  });

  it("composes with the search filter instead of replacing it", async () => {
    const token = await adminToken();
    await seed();

    const res = await request(app)
      .get(`${BASE}?kind=accessories&q=charger`)
      .set("Authorization", `Bearer ${token}`);

    expect(names(res)).toEqual(["20W Charger"]);
  });

  it("ignores an unrecognised kind rather than erroring", async () => {
    const token = await adminToken();
    await seed();

    const res = await request(app).get(`${BASE}?kind=nonsense`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(8); // degrades to everything
  });

  it("keeps an Accessory-typed bench item out of parts and in accessories", async () => {
    const token = await adminToken();
    await seed();

    const [parts, accessories] = await Promise.all([
      request(app).get(`${BASE}?kind=parts`).set("Authorization", `Bearer ${token}`),
      request(app).get(`${BASE}?kind=accessories`).set("Authorization", `Bearer ${token}`),
    ]);

    expect(names(parts)).not.toContain("Bench Lanyard");
    expect(names(accessories)).toContain("Bench Lanyard");
  });

  it("still composes with search now that accessories uses $or internally", async () => {
    const token = await adminToken();
    await seed();

    // The accessories branch builds an $or; `q` builds its own. They must AND,
    // not clobber each other.
    const res = await request(app)
      .get(`${BASE}?kind=accessories&q=lanyard`)
      .set("Authorization", `Bearer ${token}`);

    expect(names(res)).toEqual(["Bench Lanyard"]);
  });
});

describe("GET /pos/inventory?lowStock=true is variant-aware", () => {
  it("flags a variant product by the sum of its variants, not the stale top-level stock", async () => {
    const token = await adminToken();
    await Product.create([
      // Top-level stock says 10 (stale) but the only live variant has 0 → low.
      {
        name: "Variant Low Phone", slug: "vlow", price: 10000, category: "Phones",
        stock: 10, lowStockThreshold: 3,
        variants: [
          { sku: "v1", attributes: { storage: "128GB" }, stock: 0 },
          { sku: "v2", attributes: { storage: "256GB" }, stock: 0 },
        ],
      },
      // Total across variants is 4 > threshold 3 → NOT low, despite a 0-stock variant.
      {
        name: "Variant Healthy Phone", slug: "vok", price: 10000, category: "Phones",
        stock: 0, lowStockThreshold: 3,
        variants: [
          { sku: "h1", attributes: { storage: "128GB" }, stock: 1 },
          { sku: "h2", attributes: { storage: "256GB" }, stock: 3 },
        ],
      },
      // Non-variant product still uses its own stock.
      { name: "Plain Part", slug: "pp", price: 5000, category: "Other", partCategory: "Battery",
        stock: 2, lowStockThreshold: 3 },
    ]);

    const res = await request(app)
      .get(`${BASE}?lowStock=true`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.map((d) => [d.name, d]));
    expect(Object.keys(byName).sort())
      .toEqual(["Plain Part", "Variant Low Phone"].sort());
    expect(byName["Variant Low Phone"].quantity).toBe(0);
    expect(byName["Plain Part"].quantity).toBe(2);
    expect(byName["Variant Healthy Phone"]).toBeUndefined();
  });

  it("reports the uncapped total for the sidebar badge", async () => {
    const token = await adminToken();
    await Product.create([
      { name: "L1", slug: "l1", price: 100, category: "Parts", stock: 0, lowStockThreshold: 3 },
      { name: "L2", slug: "l2", price: 100, category: "Parts", stock: 1, lowStockThreshold: 3 },
      { name: "L3", slug: "l3", price: 100, category: "Parts", stock: 2, lowStockThreshold: 3 },
      { name: "OK", slug: "ok", price: 100, category: "Parts", stock: 9, lowStockThreshold: 3 },
    ]);

    // limit=1 still returns the real count via `total`.
    const res = await request(app)
      .get(`${BASE}?lowStock=true&limit=1`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(3);
  });
});

describe("GET /pos/inventory?depletedVariant=true", () => {
  it("returns only products with at least one variant at zero stock", async () => {
    const token = await adminToken();
    await Product.create([
      // One depleted variant, one healthy — should match
      {
        name: "Mixed Stock Phone", slug: "dmix", price: 10000, category: "Phones",
        variants: [
          { sku: "dm1", attributes: { color: "Lavender", storage: "128GB" }, stock: 0 },
          { sku: "dm2", attributes: { color: "Black", storage: "256GB" }, stock: 5 },
        ],
      },
      // All variants healthy — should NOT match
      {
        name: "Healthy Phone", slug: "dhok", price: 10000, category: "Phones",
        variants: [
          { sku: "dh1", attributes: { storage: "128GB" }, stock: 2 },
          { sku: "dh2", attributes: { storage: "256GB" }, stock: 3 },
        ],
      },
      // Non-variant product — should NOT match
      { name: "Plain Cable", slug: "dpc", price: 5000, category: "Chargers & Cables", stock: 10 },
    ]);

    const res = await request(app)
      .get(`${BASE}?depletedVariant=true`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Mixed Stock Phone");
    expect(res.body.data[0].hasDepletedVariant).toBe(true);
    expect(res.body.data[0].depletedVariantLabels).toEqual(["Lavender 128GB"]);
    expect(res.body.data[0].quantity).toBe(5);
  });

  it("does not overlap with the lowStock filter", async () => {
    const token = await adminToken();
    await Product.create([
      // Depleted variant BUT total across variants > threshold → not low stock
      {
        name: "Depleted But Not Low", slug: "dbnl", price: 10000, category: "Phones",
        lowStockThreshold: 2,
        variants: [
          { sku: "db1", attributes: { color: "White" }, stock: 0 },
          { sku: "db2", attributes: { color: "Black" }, stock: 5 },
        ],
      },
    ]);

    const [depleted, low] = await Promise.all([
      request(app).get(`${BASE}?depletedVariant=true`).set("Authorization", `Bearer ${token}`),
      request(app).get(`${BASE}?lowStock=true`).set("Authorization", `Bearer ${token}`),
    ]);

    expect(depleted.body.data).toHaveLength(1);
    expect(depleted.body.data[0].name).toBe("Depleted But Not Low");
    expect(low.body.data).toHaveLength(0); // total 5 > threshold 2
  });
});
