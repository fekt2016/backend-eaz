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
  it("counts one view per detail read, and returns the updated figure", async () => {
    const product = await makeProduct();

    const first = await request(app).get(`/api/v1/products/${product.slug}`);
    expect(first.status).toBe(200);
    expect(first.body.data.views).toBe(1);

    await request(app).get(`/api/v1/products/${product.slug}`);
    const refreshed = await Product.findById(product._id);
    expect(refreshed.views).toBe(2);
  });

  it("counts every simultaneous reader — no lost updates", async () => {
    const product = await makeProduct();

    await Promise.all(
      Array.from({ length: 8 }, () => request(app).get(`/api/v1/products/${product.slug}`)),
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

  it("does not count a miss on an inactive product", async () => {
    const product = await makeProduct({ isActive: false });

    const res = await request(app).get(`/api/v1/products/${product.slug}`);

    expect(res.status).toBe(404);
    const refreshed = await Product.findById(product._id);
    expect(refreshed.views).toBe(0);
  });
});

describe("Product sold count (T48)", () => {
  it("adds the paid quantity when an order is fulfilled", async () => {
    const product = await makeProduct({ stock: 5 });
    await makeOrder("REF_SOLD_1", [{ product: product._id, name: "Widget", price: 1000, qty: 2 }]);

    await fulfilShopOrder("REF_SOLD_1");

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(2);
    expect(refreshed.stock).toBe(3);
  });

  it("counts once when the webhook is retried", async () => {
    const product = await makeProduct({ stock: 5 });
    await makeOrder("REF_SOLD_2", [{ product: product._id, name: "Widget", price: 1000, qty: 2 }]);

    await fulfilShopOrder("REF_SOLD_2");
    const second = await fulfilShopOrder("REF_SOLD_2"); // Paystack retry

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

    await fulfilShopOrder("REF_SOLD_3");

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(4); // 1 plain + 3 variant
  });

  it("does not count a line that failed the stock guard", async () => {
    const product = await makeProduct({ stock: 1 });
    await makeOrder("REF_SOLD_4", [{ product: product._id, name: "Widget", price: 1000, qty: 5 }]);

    await fulfilShopOrder("REF_SOLD_4");

    const refreshed = await Product.findById(product._id);
    expect(refreshed.sold).toBe(0);
    expect(refreshed.stock).toBe(1); // never oversold, so never counted as sold
  });
});

describe("Product sold count — reversals (T48)", () => {
  it("gives the units back when a paid order is restocked", async () => {
    const product = await makeProduct({ stock: 5 });
    const order = await makeOrder("REF_REV_1", [{ product: product._id, name: "Widget", price: 1000, qty: 2 }]);

    await fulfilShopOrder("REF_REV_1");
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
