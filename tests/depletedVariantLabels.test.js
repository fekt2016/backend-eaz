// A product's stock column is the total across its variants, so it stays healthy
// while one size is unsellable — the depleted-variant warning is the only thing
// on the row that can say so. It was computed only when the depleted FILTER was
// on, so on the ordinary list every flagged row carried an empty label array and
// the admin warning rendered as a bare "—".
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");

async function adminToken() {
  const user = await User.create({
    name: "admin", email: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!", role: "admin", isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function seed() {
  await Product.create([
    {
      name: "iPhone 15 Pro", slug: "ip15p", price: 1850000, category: "Phones",
      stock: 12, lowStockThreshold: 3,
      variants: [
        { sku: "V-NAT128", attributes: { color: "Natural Titanium", storage: "128GB" }, stock: 0 },
        { sku: "V-BLU256", attributes: { color: "Blue Titanium", storage: "256GB" }, stock: 4 },
        { sku: "V-BLA512", attributes: { color: "Black Titanium", storage: "512GB" }, stock: 3 },
      ],
    },
    {
      name: "Healthy Product", slug: "healthy", price: 1000, category: "Phones", stock: 5,
      variants: [{ sku: "H-1", attributes: { color: "Black" }, stock: 5 }],
    },
  ]);
}

const BASE = "/api/v1/pos/inventory";
const find = (res, name) => res.body.data.find((d) => d.name === name);

describe("depleted-variant labels on the inventory list", () => {
  it("names the out-of-stock variant on the ORDINARY list, not only when filtering", async () => {
    await seed();
    const token = await adminToken();
    const res = await request(app).get(BASE).set("Authorization", `Bearer ${token}`);

    const ip = find(res, "iPhone 15 Pro");
    expect(ip.hasDepletedVariant).toBe(true);
    // The regression: flagged true with nothing to show.
    expect(ip.depletedVariantLabels).toEqual(["Natural Titanium 128GB"]);
  });

  it("reports stock as the variant total, not the stale top-level number", async () => {
    await seed();
    const token = await adminToken();
    const res = await request(app).get(BASE).set("Authorization", `Bearer ${token}`);

    // Stored stock says 12; the variants actually hold 7.
    expect(find(res, "iPhone 15 Pro").quantity).toBe(7);
  });

  it("leaves a fully stocked product unflagged", async () => {
    await seed();
    const token = await adminToken();
    const res = await request(app).get(BASE).set("Authorization", `Bearer ${token}`);

    const healthy = find(res, "Healthy Product");
    expect(healthy.hasDepletedVariant).toBe(false);
    expect(healthy.depletedVariantLabels).toEqual([]);
  });

  it("still names them when the depleted filter is on", async () => {
    await seed();
    const token = await adminToken();
    const res = await request(app).get(`${BASE}?depletedVariant=true`).set("Authorization", `Bearer ${token}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].depletedVariantLabels).toEqual(["Natural Titanium 128GB"]);
  });

  it("names them on the low-stock view too", async () => {
    await Product.create({
      name: "Low And Depleted", slug: "lowdep", price: 1000, category: "Phones",
      stock: 0, lowStockThreshold: 5,
      variants: [
        { sku: "L-1", attributes: { size: "S" }, stock: 0 },
        { sku: "L-2", attributes: { size: "M" }, stock: 1 },
      ],
    });
    const token = await adminToken();
    const res = await request(app).get(`${BASE}?lowStock=true`).set("Authorization", `Bearer ${token}`);

    expect(find(res, "Low And Depleted").depletedVariantLabels).toEqual(["S"]);
  });
});
