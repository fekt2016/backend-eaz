const request = require("supertest");
const app = require("../app");
const Order = require("../models/Order");
const Product = require("../models/Product");
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

    const paid = await fulfilShopOrder("REF_A", { amountPesewas: 1000, currency: "GHS" });
    expect(paid.status).toBe("paid");
    expect((await Product.findById(product._id)).stock).toBe(1);

    // Idempotent: second call is a no-op (order no longer pending).
    const again = await fulfilShopOrder("REF_A", { amountPesewas: 1000, currency: "GHS" });
    expect(again).toBeNull();
    expect((await Product.findById(product._id)).stock).toBe(1);
  });

  it("never oversells — stock stays at zero when the order exceeds it", async () => {
    const product = await Product.create({
      name: "Scarce", slug: `s-${Date.now()}`, price: 1000, category: "x", stock: 1,
    });
    await makeOrder("REF_B", [{ product: product._id, name: "Scarce", price: 1000, qty: 5 }]);

    const paid = await fulfilShopOrder("REF_B", { amountPesewas: 1000, currency: "GHS" });
    expect(paid.status).toBe("paid"); // order still fulfils
    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(1); // guarded — not decremented below available
    expect(fresh.stock).toBeGreaterThanOrEqual(0);
  });

  // The amount/currency guard used to be duplicated at each call site; it now
  // lives in the helper, so these assert it there.
  it("refuses to fulfil when the charged amount doesn't match the order total", async () => {
    const product = await Product.create({
      name: "Guarded", slug: `g-${Date.now()}`, price: 1000, category: "x", stock: 3,
    });
    await makeOrder("REF_MISMATCH", [{ product: product._id, name: "Guarded", price: 1000, qty: 1 }]);

    await expect(
      fulfilShopOrder("REF_MISMATCH", { amountPesewas: 1, currency: "GHS" })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });

    const order = await Order.findOne({ paystackReference: "REF_MISMATCH" });
    expect(order.status).toBe("pending");
    expect((await Product.findById(product._id)).stock).toBe(3); // no stock moved
  });

  it("refuses a non-GHS charge", async () => {
    await makeOrder("REF_CURRENCY", [{ name: "Any", price: 1000, qty: 1 }]);
    await expect(
      fulfilShopOrder("REF_CURRENCY", { amountPesewas: 1000, currency: "USD" })
    ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
    expect((await Order.findOne({ paystackReference: "REF_CURRENCY" })).status).toBe("pending");
  });

  it("refuses to fulfil when the caller passes no amount at all", async () => {
    await makeOrder("REF_NOGUARD", [{ name: "Any", price: 1000, qty: 1 }]);
    await expect(fulfilShopOrder("REF_NOGUARD")).rejects.toMatchObject({
      code: "MISSING_PAYMENT_GUARD",
    });
    expect((await Order.findOne({ paystackReference: "REF_NOGUARD" })).status).toBe("pending");
  });

  it("decrements a Part when the item is a repair part", async () => {
    const part = await Product.create({
      name: "Battery", category: "Battery", partCategory: "Battery", sellOnline: true, sellInStore: true, stock: 4,
      costPrice: 5000, price: 9000, useInRepairs: true});
    await makeOrder("REF_C", [{ part: part._id, name: "Battery", price: 9000, qty: 3 }]);

    await fulfilShopOrder("REF_C", { amountPesewas: 1000, currency: "GHS" });
    expect((await Product.findById(part._id)).stock).toBe(1);
  });
});

// ── getPublicParts: repair-parts search hits real inventory ──
describe("GET /api/v1/track/parts", () => {
  it("returns real inventory with price (pesewas), stock and images", async () => {
    await Product.create({
      name: "iPhone 14 Screen", category: "Screen", partCategory: "Screen", sellOnline: true, sellInStore: true, stock: 6,
      costPrice: 40000, price: 65000,
      images: ["https://res.cloudinary.com/demo/s.jpg"], compatibleWith: ["iPhone 14"], useInRepairs: true});

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
    await Product.create({
      name: "Unpriced", category: "Other", partCategory: "Other", stock: 3, costPrice: 100, price: 0, useInRepairs: true});
    const res = await request(app).get("/api/v1/track/parts");
    expect(res.body.data.find((p) => p.name === "Unpriced")).toBeFalsy();
  });
});

// The POS search dropdown asks for a fixed number of rows, so the merged
// parts+products response has to honour `limit`. It used to fetch `limit` parts AND a
// further `limit` products and concatenate them, so ?limit=10 could return 20.
// Bench parts and shop stock are one collection now, so POS search spans both
// by construction. This used to fetch parts first and give products only what
// was left of `limit`, which meant a search matching a full page of parts
// returned no products at all.
describe("GET /api/v1/pos/inventory — one catalogue", () => {
  const request = require("supertest");
  const app = require("../app");
  const Product = require("../models/Product");

  async function staffToken() {
    const jwt = require("jsonwebtoken");
    const User = require("../models/User");
    const u = await User.create({
      name: "Staff",
      email: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
      password: "Password123!",
      role: "staff",
    });
    return jwt.sign({ id: u._id.toString() }, process.env.JWT_SECRET);
  }

  async function benchPart(name) {
    return Product.create({
      name, category: "Screen", partCategory: "Screen", costPrice: 500, price: 1000,
      stock: 5, sellOnline: false, sellInStore: true, useInRepairs: true,
    });
  }
  async function shopProduct(name, slug) {
    return Product.create({ name, slug, price: 2000, category: "widgets", stock: 5 });
  }

  it("never returns more than `limit` rows", async () => {
    const token = await staffToken();
    for (let i = 0; i < 8; i++) await benchPart(`Widget part ${i}`);
    for (let i = 0; i < 8; i++) await shopProduct(`Widget product ${i}`, `widget-product-${i}`);

    const res = await request(app)
      .get("/api/v1/pos/inventory?q=Widget&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(10);
    expect(res.body.total).toBe(16);
  });

  it("pages through one sorted list instead of dropping shop stock", async () => {
    // The regression this replaces was structural: products were given only
    // `limit - parts.length` rows, so a full page of parts dropped every
    // product no matter how the results were sorted or paged. Now the two are
    // one name-sorted list, so page 2 reaches the products.
    const token = await staffToken();
    for (let i = 0; i < 8; i++) await benchPart(`Widget part ${i}`);
    for (let i = 0; i < 8; i++) await shopProduct(`Widget product ${i}`, `widget-product-${i}`);

    const page1 = await request(app)
      .get("/api/v1/pos/inventory?q=Widget&limit=8&page=1")
      .set("Authorization", `Bearer ${token}`);
    const page2 = await request(app)
      .get("/api/v1/pos/inventory?q=Widget&limit=8&page=2")
      .set("Authorization", `Bearer ${token}`);

    expect(page1.body.total).toBe(16);
    const names1 = page1.body.data.map((d) => d.name);
    const names2 = page2.body.data.map((d) => d.name);
    expect(names2.some((n) => n.includes("product"))).toBe(true);
    // Each page is sorted, and page 2 continues where page 1 stopped.
    expect([...names1].sort()).toEqual(names1);
    expect(names1[names1.length - 1] < names2[0]).toBe(true);
  });

  it("still surfaces products when parts do not fill the limit", async () => {
    const token = await staffToken();
    await benchPart("Gadget part");
    await shopProduct("Gadget product", "gadget-product");

    const res = await request(app)
      .get("/api/v1/pos/inventory?q=Gadget&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((d) => d.name);
    expect(names).toContain("Gadget part");
    expect(names).toContain("Gadget product");
    // The POS clients still read the old field names.
    const row = res.body.data.find((d) => d.name === "Gadget product");
    expect(row.sellingPrice).toBe(2000);
    expect(row.quantity).toBe(5);
    expect(row._kind).toBe("product");
  });
});
