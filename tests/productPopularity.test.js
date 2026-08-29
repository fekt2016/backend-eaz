// T48: `views` and `sold` counters on Product.
//
// `views` moves only on the public detail read; `sold` moves only on the same
// update that deducts stock, so the two figures can never drift apart. The
// interesting cases are the reversals: an order cancelled after payment gives
// the units back, and an order paid *before* this feature shipped deducted stock
// without ever bumping `sold` — cancelling one of those must not drive the
// counter negative.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { fulfilShopOrder, restockOrderItems } = require("../utils/fulfilShopOrder");

async function makeProduct(over = {}) {
  return Product.create({
    name: "Widget",
    slug: `widget-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 1000,
    category: "gadgets",
    stock: 10,
    ...over,
  });
}

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

describe("Product popularity counters — defaults (T48)", () => {
  it("starts a new product at zero views and zero sold", async () => {
    const product = await makeProduct();
    expect(product.views).toBe(0);
    expect(product.sold).toBe(0);
  });

  it("ignores views/sold sent by an admin creating a product", async () => {
    const admin = await User.create({
      name: "Admin", email: `admin-${Date.now()}@t.com`, password: "Password123!",
      role: "admin", isVerified: true,
    });
    const token = jwt.sign({ id: admin._id.toString() }, process.env.JWT_SECRET);

    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Fake Popular", slug: `fake-${Date.now()}`, price: 1000,
        category: "gadgets", stock: 5, views: 9999, sold: 9999,
      });

    expect(res.status).toBe(201);
    const saved = await Product.findById(res.body.data._id);
    expect(saved.views).toBe(0);
    expect(saved.sold).toBe(0);
  });
});

describe("Product views (T48)", () => {
  // Counting lives on POST /products/:slug/view, not on the detail GET. The GET
  // is called by generateMetadata, by the server render of /shop/[slug], and
  // again by the client — three per visit — and Next prefetches the route on
  // link hover, so it counted products nobody opened.
  it("does not count a view when the product is merely fetched", async () => {
    const product = await makeProduct();

    const res = await request(app).get(`/api/v1/products/${product.slug}`);

    expect(res.status).toBe(200);
    const refreshed = await Product.findById(product._id);
    expect(refreshed.views).toBe(0);
  });

  it("counts one view per POST, and returns the updated figure", async () => {
    const product = await makeProduct();

    const first = await request(app).post(`/api/v1/products/${product.slug}/view`);
    expect(first.status).toBe(200);
    expect(first.body.data.views).toBe(1);

    const second = await request(app).post(`/api/v1/products/${product.slug}/view`);
    expect(second.body.data.views).toBe(2);
    const refreshed = await Product.findById(product._id);
    expect(refreshed.views).toBe(2);
  });

  it("counts every simultaneous visitor — no lost updates", async () => {
    const product = await makeProduct();

    await Promise.all(
      Array.from({ length: 8 }, () => request(app).post(`/api/v1/products/${product.slug}/view`)),
    );

    const refreshed = await Product.findById(product._id);
    expect(refreshed.views).toBe(8);
  });

  it("does not count list reads as views", async () => {
    const product = await makeProduct();

    await request(app).get("/api/v1/products");
    await request(app).get("/api/v1/products?q=Widget");

    const refreshed = await Product.findById(product._id);
    expect(refreshed.views).toBe(0);
  });

  it("404s rather than counting a view on an inactive product", async () => {
    const product = await makeProduct({ isActive: false });

    const res = await request(app).post(`/api/v1/products/${product.slug}/view`);

    expect(res.status).toBe(404);
    const refreshed = await Product.findById(product._id);
    expect(refreshed.views).toBe(0);
  });

  it("404s on a slug that does not exist", async () => {
    const res = await request(app).post("/api/v1/products/no-such-product/view");
    expect(res.status).toBe(404);
  });

  it("needs no login — a shopper is not signed in", async () => {
    const product = await makeProduct();

    const res = await request(app).post(`/api/v1/products/${product.slug}/view`);

    expect(res.status).toBe(200);
  });
});

describe("Product list exposes the counters (T48)", () => {
  // The list endpoint is an aggregation with an explicit $project, so a new
  // schema field does NOT reach the client for free. It shipped missing once:
  // the homepage cards had nothing to render.
  it("returns views and sold on every list row", async () => {
    const product = await makeProduct();
    await request(app).post(`/api/v1/products/${product.slug}/view`); // one view

    const res = await request(app).get("/api/v1/products?kind=product");

    expect(res.status).toBe(200);
    const row = res.body.data.find((p) => p.slug === product.slug);
    expect(row).toBeDefined();
    expect(row.views).toBe(1);
    expect(row.sold).toBe(0);
  });

  it("reports zero for products stored before the fields existed", async () => {
    // Straight into the collection, with no views/sold keys — an aggregation
    // applies no schema defaults, so the projection has to supply them.
    const product = await makeProduct();
    await Product.collection.updateOne(
      { _id: product._id },
      { $unset: { views: "", sold: "" } },
    );

    const res = await request(app).get("/api/v1/products?kind=product");

    const row = res.body.data.find((p) => p.slug === product.slug);
    expect(row.views).toBe(0);
    expect(row.sold).toBe(0);
  });
});

describe("Product sold count (T48)", () => {
  it("adds the paid quantity when an order is fulfilled", async () => {
    const product = await makeProduct({ stock: 5 });
    await makeOrder("REF_SOLD_1", [{ product: product._id, name: "Widget", price: 1000, qty: 2 }]);

    await fulfilShopOrder("REF_SOLD_1", { amountPesewas: 1000, currency: "GHS" });

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(2);
    expect(refreshed.stock).toBe(3);
  });

  it("counts once when the webhook is retried", async () => {
    const product = await makeProduct({ stock: 5 });
    await makeOrder("REF_SOLD_2", [{ product: product._id, name: "Widget", price: 1000, qty: 2 }]);

    await fulfilShopOrder("REF_SOLD_2", { amountPesewas: 1000, currency: "GHS" });
    const second = await fulfilShopOrder("REF_SOLD_2", { amountPesewas: 1000, currency: "GHS" }); // Paystack retry

    expect(second).toBeNull();
    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(2);
  });

  it("counts variant lines against the parent product", async () => {
    const product = await makeProduct({
      stock: 5,
      variants: [{ sku: "WID-BLK", attributes: {}, stock: 4 }],
    });
    await makeOrder("REF_SOLD_3", [
      { product: product._id, name: "Widget", price: 1000, qty: 1 },
      { product: product._id, variant: { sku: "WID-BLK" }, name: "Widget (Black)", price: 1000, qty: 3 },
    ]);

    await fulfilShopOrder("REF_SOLD_3", { amountPesewas: 1000, currency: "GHS" });

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(4); // 1 plain + 3 variant
  });

  it("does not count a line that failed the stock guard", async () => {
    const product = await makeProduct({ stock: 1 });
    await makeOrder("REF_SOLD_4", [{ product: product._id, name: "Widget", price: 1000, qty: 5 }]);

    await fulfilShopOrder("REF_SOLD_4", { amountPesewas: 1000, currency: "GHS" });

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(0);
    expect(refreshed.stock).toBe(1); // never oversold, so never counted as sold
  });
});

describe("Product sold count — reversals (T48)", () => {
  it("gives the units back when a paid order is restocked", async () => {
    const product = await makeProduct({ stock: 5 });
    const order = await makeOrder("REF_REV_1", [{ product: product._id, name: "Widget", price: 1000, qty: 2 }]);

    await fulfilShopOrder("REF_REV_1", { amountPesewas: 1000, currency: "GHS" });
    await restockOrderItems(await Order.findById(order._id));

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(0);
    expect(refreshed.stock).toBe(5);
  });

  it("clamps at zero for an order paid before the counter existed", async () => {
    // Stock was deducted under the old code, so `sold` is still 0. Cancelling it
    // now must not push the counter below zero.
    const product = await makeProduct({ stock: 3, sold: 0 });
    const order = await makeOrder(
      "REF_REV_2",
      [{ product: product._id, name: "Widget", price: 1000, qty: 2 }],
      { status: "paid", stockDeducted: true },
    );

    await restockOrderItems(await Order.findById(order._id));

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(0);
    expect(refreshed.stock).toBe(5); // stock still restored — the clamp is on `sold` only
  });
});

// ── T48 counters for retail parts (inventory products in the shop) ──────────
describe("Popularity counters for retail parts", () => {

  async function makeRetailPart(overrides = {}) {
    return Product.create({
      name: "Retail Screen", category: "Screen", partCategory: "Screen", sellOnline: true, sellInStore: true, stock: 10,
      costPrice: 40000, price: 65000, ...overrides, useInRepairs: true});
  }

  it("records a view against the part behind its synthetic slug", async () => {
    const part = await makeRetailPart();
    const res = await request(app).post(`/api/v1/products/part-${part._id}/view`);
    expect(res.status).toBe(200);
    expect(res.body.data.views).toBe(1);
    expect((await Product.findById(part._id)).views).toBe(1);
  });

  it("does not count views for an item that is not listed in the shop", async () => {
    const part = await makeRetailPart({ sellOnline: false, sellInStore: false });
    const res = await request(app).post(`/api/v1/products/part-${part._id}/view`);
    expect(res.status).toBe(404);
  });

  it("bumps `sold` when a part line is fulfilled, and gives it back on restock", async () => {
    const part = await makeRetailPart();
    await Order.create({
      orderNumber: `EZW-PART-${Date.now()}`,
      items: [{ part: part._id, name: part.name, price: 65000, qty: 3 }],
      subtotal: 195000, total: 195000,
      customer: { name: "Ama", phone: "0244000000" },
      status: "pending", paystackReference: "REF_PART_SOLD",
    });

    await fulfilShopOrder("REF_PART_SOLD", { amountPesewas: 195000, currency: "GHS" });
    let fresh = await Product.findById(part._id);
    expect(fresh.sold).toBe(3);
    expect(fresh.stock).toBe(7);

    await restockOrderItems(await Order.findOne({ paystackReference: "REF_PART_SOLD" }));
    fresh = await Product.findById(part._id);
    expect(fresh.sold).toBe(0);
    expect(fresh.stock).toBe(10);
  });

  it("never drives `sold` negative for a part sold before the counter existed", async () => {
    const part = await makeRetailPart();
    await Product.collection.updateOne({ _id: part._id }, { $unset: { sold: "" } });
    await Product.decrementSold(part._id, 5);
    expect((await Product.findById(part._id)).sold).toBe(0);
  });

  it("serves the counters on the shop listing so a part card matches a product card", async () => {
    const part = await makeRetailPart({ name: "Listed Screen" });
    await request(app).post(`/api/v1/products/part-${part._id}/view`);

    const res = await request(app).get("/api/v1/products");
    const listed = res.body.data.find((p) => String(p._id) === String(part._id));
    expect(listed).toBeTruthy();
    expect(listed.views).toBe(1);
    expect(listed.sold).toBe(0);
  });
});

// ── POS sales feed the same `sold` counter as the shop ─────────────────────
describe("POS sales count toward a part's sold total", () => {
  const { deductPartStock } = require("../utils/deductPartStock");

  it("bumps `sold` when a part is deducted for a repair job or counter sale", async () => {
    const part = await Product.create({
      name: "POS Screen", category: "Screen", partCategory: "Screen", sellOnline: true, sellInStore: true, stock: 10,
      costPrice: 40000, price: 65000, useInRepairs: true});

    const res = await deductPartStock(part._id, 2);
    expect(res.ok).toBe(true);

    const fresh = await Product.findById(part._id);
    expect(fresh.stock).toBe(8);
    expect(fresh.sold).toBe(2);
  });

  it("does not count a deduction that failed the stock guard", async () => {
    const part = await Product.create({
      name: "Scarce POS Part", category: "Battery", partCategory: "Battery", sellOnline: true, sellInStore: true, stock: 1,
      costPrice: 1000, price: 2000, useInRepairs: true});

    const res = await deductPartStock(part._id, 5);
    expect(res.ok).toBe(false);

    const fresh = await Product.findById(part._id);
    expect(fresh.stock).toBe(1); // untouched
    expect(fresh.sold).toBe(0);     // and not counted
  });

  it("still counts the sale when the part opts into negative stock", async () => {
    const part = await Product.create({
      name: "Backorder Part", category: "Cable", partCategory: "Cable", sellOnline: true, sellInStore: true, stock: 1,
      allowNegativeStock: true, costPrice: 1000, price: 2000, useInRepairs: true});

    const res = await deductPartStock(part._id, 3);
    expect(res.ok).toBe(true);
    expect(res.wentNegative).toBe(true);

    const fresh = await Product.findById(part._id);
    expect(fresh.stock).toBe(-2);
    expect(fresh.sold).toBe(3);
  });
});
