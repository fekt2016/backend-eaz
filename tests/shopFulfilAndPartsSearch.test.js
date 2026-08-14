const request = require("supertest");
const app = require("../app");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Part = require("../models/Part");
const { fulfilShopOrder } = require("../utils/fulfilShopOrder");

// ── fulfilShopOrder: paid transition + no-oversell + idempotency ──
describe("fulfilShopOrder", () => {
  async function makeOrder(ref, items, extra = {}) {
    return Order.create({
      orderNumber: `EZW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      items,
      subtotal: 1000,
      total: 1000,
      customer: { name: "A", phone: "0244000000" },
      status: "pending",
      paystackReference: ref,
      ...extra,
    });
  }

  it("marks the order paid and decrements product stock once", async () => {
    const product = await Product.create({
      name: "Widget", slug: `w-${Date.now()}`, price: 1000, category: "x", stock: 3,
    });
    await makeOrder("REF_A", [{ product: product._id, name: "Widget", price: 1000, qty: 2 }]);

    const paid = await fulfilShopOrder("REF_A");
    expect(paid.status).toBe("paid");
    expect((await Product.findById(product._id)).stock).toBe(1);

    // Idempotent: second call is a no-op (order no longer pending).
    const again = await fulfilShopOrder("REF_A");
    expect(again).toBeNull();
    expect((await Product.findById(product._id)).stock).toBe(1);
  });

  it("never oversells — stock stays at zero when the order exceeds it", async () => {
    const product = await Product.create({
      name: "Scarce", slug: `s-${Date.now()}`, price: 1000, category: "x", stock: 1,
    });
    await makeOrder("REF_B", [{ product: product._id, name: "Scarce", price: 1000, qty: 5 }]);

    const paid = await fulfilShopOrder("REF_B");
    expect(paid.status).toBe("paid"); // order still fulfils
    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(1); // guarded — not decremented below available
    expect(fresh.stock).toBeGreaterThanOrEqual(0);
  });

  it("decrements a Part when the item is a repair part", async () => {
    const part = await Part.create({
      name: "Battery", category: "Battery", isRetail: true, quantity: 4,
      costPrice: 5000, sellingPrice: 9000,
    });
    await makeOrder("REF_C", [{ part: part._id, name: "Battery", price: 9000, qty: 3 }]);

    await fulfilShopOrder("REF_C");
    expect((await Part.findById(part._id)).quantity).toBe(1);
  });
});

// ── getPublicParts: repair-parts search hits real inventory ──
describe("GET /api/v1/track/parts", () => {
  it("returns real inventory with price (pesewas), stock and images", async () => {
    await Part.create({
      name: "iPhone 14 Screen", category: "Screen", isRetail: true, quantity: 6,
      costPrice: 40000, sellingPrice: 65000,
      images: ["https://res.cloudinary.com/demo/s.jpg"], compatibleWith: ["iPhone 14"],
    });

    const res = await request(app).get("/api/v1/track/parts?q=iphone");
    expect(res.status).toBe(200);
    const row = res.body.data.find((p) => p.name === "iPhone 14 Screen");
    expect(row).toBeTruthy();
    expect(row.sellingPrice).toBe(65000); // pesewas
    expect(row.quantity).toBe(6);
    expect(row.images).toHaveLength(1);
    expect(row.costPrice).toBeUndefined(); // cost never exposed publicly
  });

  it("excludes parts with no price", async () => {
    await Part.create({
      name: "Unpriced", category: "Other", quantity: 3, costPrice: 100, sellingPrice: 0,
    });
    const res = await request(app).get("/api/v1/track/parts");
    expect(res.body.data.find((p) => p.name === "Unpriced")).toBeFalsy();
  });
});
