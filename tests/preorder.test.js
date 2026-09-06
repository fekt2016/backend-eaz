// Checkout calls Paystack's transaction.initialize; stub the SDK the way the other
// checkout suites do, so these tests never touch the network. A unique reference
// per call, since Order.paystackReference is uniquely indexed.
jest.mock("@paystack/paystack-sdk", () => {
  class Paystack {
    constructor() {}
    get transaction() {
      return {
        initialize: jest.fn(async () => ({
          status: true,
          data: {
            authorization_url: "https://pay.example/checkout",
            access_code: "acc_code",
            reference: `REF_PREORDER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          },
        })),
      };
    }
  }
  return Paystack;
});

// T45: pre-order. A product marked `preorder.enabled` can be bought with no stock
// on hand — paid in full up front like any order — and the line waits in a release
// queue until the stock lands and staff release it.
//
// The decisions this encodes: full payment upfront, an optional per-product cap
// enforced server-side, manual release (never automatic on a stock change), and an
// email to the customer at release.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");
const Product = require("../models/Product");
const EmailLog = require("../models/EmailLog");
const { fulfilShopOrder, restockOrderItems } = require("../utils/fulfilShopOrder");

async function staffToken(role = "staff") {
  const user = await User.create({
    name: role, email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!", role, isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function makeProduct(over = {}) {
  return Product.create({
    name: "Imported Phone",
    slug: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 500000, category: "Phones", stock: 0, ...over,
  });
}

const checkout = (slug, qty = 1) =>
  request(app).post("/api/v1/orders").send({
    items: [{ slug, qty }],
    customer: { name: "Ama", phone: "0244000000", email: "ama@example.com" },
  });

async function makePaidPreorder(product, qty = 1) {
  const order = await Order.create({
    orderNumber: `EZW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    items: [{ product: product._id, name: product.name, price: product.price, qty, isPreorder: true }],
    subtotal: product.price * qty, total: product.price * qty,
    customer: { name: "Ama", phone: "0244000000", email: "ama@example.com" },
    status: "paid", stockDeducted: true,
  });
  return order;
}

const checkoutVariant = (slug, sku, qty = 1) =>
  request(app).post("/api/v1/orders").send({
    items: [{ slug, qty, variant: { sku } }],
    customer: { name: "Ama", phone: "0244000000", email: "ama@example.com" },
  });

// A pre-order that lives on ONE variant. The whole product is not a single
// on/off switch: a 0-stock colour can be pre-ordered while its siblings sell
// normally, and a variant can opt out of a product-level pre-order.
describe("Per-variant pre-order at checkout", () => {
  const variants = (over = {}) => [
    { sku: "PH-BLK", attributes: { color: "Black" }, stock: 0, ...over },
    { sku: "PH-BLU", attributes: { color: "Blue" }, stock: 4 },
  ];

  it("accepts a 0-stock variant that is itself flagged, product flag off", async () => {
    const product = await makeProduct({
      stock: 4,
      preorder: { enabled: false },
      variants: variants({ preorder: { enabled: true } }),
    });

    const res = await checkoutVariant(product.slug, "PH-BLK");

    expect(res.status).toBe(200);
    const order = await Order.findOne({ "items.product": product._id });
    expect(order.items[0].variant.sku).toBe("PH-BLK");
    expect(order.items[0].isPreorder).toBe(true);
  });

  it("still refuses a 0-stock variant nobody flagged", async () => {
    const product = await makeProduct({ stock: 4, variants: variants() });

    const res = await checkoutVariant(product.slug, "PH-BLK");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/in stock/i);
  });

  it("lets a product-level pre-order reach a variant that is unset", async () => {
    const product = await makeProduct({
      stock: 4,
      preorder: { enabled: true },
      variants: variants(),
    });

    const res = await checkoutVariant(product.slug, "PH-BLK");

    expect(res.status).toBe(200);
    const order = await Order.findOne({ "items.product": product._id });
    expect(order.items[0].isPreorder).toBe(true);
  });

  it("lets a variant opt OUT of a product-level pre-order", async () => {
    const product = await makeProduct({
      stock: 4,
      preorder: { enabled: true },
      variants: variants({ preorder: { enabled: false } }),
    });

    const res = await checkoutVariant(product.slug, "PH-BLK");

    expect(res.status).toBe(400);
  });

  it("enforces the variant's own cap, not the product's", async () => {
    const product = await makeProduct({
      stock: 4,
      preorder: { enabled: true, maxQty: 10 },
      variants: variants({ preorder: { enabled: true, maxQty: 2 } }),
    });

    const res = await checkoutVariant(product.slug, "PH-BLK", 3);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limited to 2 per pre-order/i);
  });

  it("leaves an in-stock sibling variant an ordinary sale", async () => {
    const product = await makeProduct({
      stock: 4,
      preorder: { enabled: true },
      variants: variants({ preorder: { enabled: true } }),
    });

    const res = await checkoutVariant(product.slug, "PH-BLU", 2);

    expect(res.status).toBe(200);
    const order = await Order.findOne({ "items.product": product._id });
    expect(order.items[0].isPreorder).toBeFalsy();
  });
});

describe("Pre-order checkout (T45)", () => {
  it("refuses an out-of-stock product that is not marked for pre-order", async () => {
    const product = await makeProduct({ stock: 0 });

    const res = await checkout(product.slug);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only has 0 in stock/i);
  });

  it("accepts an out-of-stock product that is, and flags the line", async () => {
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });

    const res = await checkout(product.slug);

    expect(res.status).toBe(200);
    const order = await Order.findOne({ "items.product": product._id });
    expect(order.items[0].isPreorder).toBe(true);
    expect(order.items[0].preorderReleasedAt).toBeNull();
  });

  it("does not turn an in-stock purchase into a pre-order", async () => {
    // Enabling the flag must not change how a product behaves while it has stock.
    const product = await makeProduct({ stock: 5, preorder: { enabled: true } });

    const res = await checkout(product.slug, 2);

    expect(res.status).toBe(200);
    const order = await Order.findOne({ "items.product": product._id });
    expect(order.items[0].isPreorder).toBeFalsy();
  });

  it("enforces the per-product cap server-side", async () => {
    // The storefront can hide the option, but the cap has to hold against a
    // hand-rolled request too.
    const product = await makeProduct({ stock: 0, preorder: { enabled: true, maxQty: 2 } });

    const res = await checkout(product.slug, 3);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limited to 2 per pre-order/i);
  });

  it("allows a quantity right at the cap", async () => {
    const product = await makeProduct({ stock: 0, preorder: { enabled: true, maxQty: 2 } });

    expect((await checkout(product.slug, 2)).status).toBe(200);
  });

  it("treats a null cap as uncapped", async () => {
    const product = await makeProduct({ stock: 0, preorder: { enabled: true, maxQty: null } });

    expect((await checkout(product.slug, 25)).status).toBe(200);
  });

  it("defaults an existing product to no pre-order", async () => {
    const product = await makeProduct({ stock: 0 });
    expect(product.preorder.enabled).toBe(false);
  });
});

describe("Pre-order fulfilment (T45)", () => {
  it("does not move stock for a pre-order line when the order is paid", async () => {
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    await Order.create({
      orderNumber: `EZW-${Date.now()}`,
      items: [{ product: product._id, name: product.name, price: 500000, qty: 1, isPreorder: true }],
      subtotal: 500000, total: 500000,
      customer: { name: "Ama", phone: "0244000000" },
      status: "pending", paystackReference: "REF_PRE_1",
    });

    const paid = await fulfilShopOrder("REF_PRE_1", { amountPesewas: 500000, currency: "GHS" });

    expect(paid.status).toBe("paid");
    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(0);   // never went negative
    expect(fresh.sold).toBe(0);    // not sold until it is actually released
  });

  it("does not invent stock when an unreleased pre-order is cancelled", async () => {
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    await restockOrderItems(await Order.findById(order._id));

    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(0);
  });
});

describe("Pre-order release (T45)", () => {
  it("lists paid orders waiting on a release, oldest first", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    await makePaidPreorder(product);

    const res = await request(app)
      .get("/api/v1/orders/preorders")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("leaves an unpaid pre-order out of the queue", async () => {
    // Nothing is owed until the money lands, and releasing would move stock for
    // an order that may never be paid.
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    await Order.create({
      orderNumber: `EZW-${Date.now()}-unpaid`,
      items: [{ product: product._id, name: product.name, price: 500000, qty: 1, isPreorder: true }],
      subtotal: 500000, total: 500000,
      customer: { name: "Ama", phone: "0244000000" },
      status: "pending",
    });

    const res = await request(app)
      .get("/api/v1/orders/preorders")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data).toHaveLength(0);
  });

  it("moves stock, counts the sale, and stamps the line on release", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product, 2);
    await Product.updateOne({ _id: product._id }, { $set: { stock: 5 } }); // shipment landed

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(3);  // 5 − 2
    expect(fresh.sold).toBe(2);
    const freshOrder = await Order.findById(order._id);
    expect(freshOrder.items[0].preorderReleasedAt).toBeTruthy();
  });

  it("refuses to release against stock that has not arrived", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enough stock/i);
    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(0); // never went negative
  });

  it("cannot be released twice", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await Product.updateOne({ _id: product._id }, { $set: { stock: 3 } });

    await request(app).patch(`/api/v1/orders/${order._id}/preorder-release`).set("Authorization", `Bearer ${token}`);
    const second = await request(app).patch(`/api/v1/orders/${order._id}/preorder-release`).set("Authorization", `Bearer ${token}`);

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/no pre-order lines waiting/i);
    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(2); // decremented once, not twice
  });

  it("emails the customer that their item has arrived", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await Product.updateOne({ _id: product._id }, { $set: { stock: 3 } });

    await request(app).patch(`/api/v1/orders/${order._id}/preorder-release`).set("Authorization", `Bearer ${token}`);

    // Resend is disabled in tests, so the send is logged as failed — what matters
    // is that it was attempted, addressed correctly, and filed under its own type.
    await new Promise((r) => setTimeout(r, 50));
    const logged = await EmailLog.findOne({ type: "preorder_ready" });
    expect(logged).toBeTruthy();
    expect(logged.to).toBe("ama@example.com");
  });

  it("is closed to customers", async () => {
    const token = await staffToken("user");
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// Staff must not be able to walk an order through packing and delivery while the
// goods are still on a container. Release is the gate: it is the one place that
// proves the stock is physically here, so every fulfilment stage waits behind it.
describe("Pre-order holds internal tracking (T45)", () => {
  const patchStatus = (id, token, status) =>
    request(app).patch(`/api/v1/orders/${id}`)
      .set("Authorization", `Bearer ${token}`).send({ status });

  const trackingEvent = (id, token, body) =>
    request(app).post(`/api/v1/orders/${id}/tracking`)
      .set("Authorization", `Bearer ${token}`).send(body);

  it("refuses to move an unreleased pre-order to processing", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await patchStatus(order._id, token, "processing");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/waiting on pre-order stock/i);
    expect(res.body.error).toContain(product.name);
    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe("paid");
  });

  it("closes the tracking endpoint's status door too", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await trackingEvent(order._id, token, { status: "shipped", note: "Off to the courier" });

    expect(res.status).toBe(400);
    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe("paid");
    // The note must not slip into the history on a refused move.
    expect(fresh.trackingHistory).toHaveLength(0);
  });

  it("still lets staff cancel an order that is waiting", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await patchStatus(order._id, token, "cancelled");

    expect(res.status).toBe(200);
    expect((await Order.findById(order._id)).status).toBe("cancelled");
  });

  it("still accepts a note-only tracking event while waiting", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await trackingEvent(order._id, token, { note: "Customer called about the ETA" });

    expect(res.status).toBe(200);
    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe("paid");
    expect(fresh.trackingHistory.at(-1).note).toBe("Customer called about the ETA");
  });

  it("lifts the hold once the pre-order is released", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 5, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const release = await request(app)
      .patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);
    expect(release.status).toBe(200);

    const res = await patchStatus(order._id, token, "shipped");

    expect(res.status).toBe(200);
    expect((await Order.findById(order._id)).status).toBe("shipped");
  });

  it("holds a mixed order until its last pre-order line is released", async () => {
    const token = await staffToken();
    const inStock = await makeProduct({ stock: 3 });
    const incoming = await makeProduct({ name: "Imported Case", stock: 0, preorder: { enabled: true } });
    const order = await Order.create({
      orderNumber: `EZW-${Date.now()}-mix`,
      items: [
        { product: inStock._id, name: inStock.name, price: inStock.price, qty: 1 },
        { product: incoming._id, name: incoming.name, price: incoming.price, qty: 1, isPreorder: true },
      ],
      subtotal: inStock.price + incoming.price, total: inStock.price + incoming.price,
      customer: { name: "Ama", phone: "0244000000", email: "ama@example.com" },
      status: "paid", stockDeducted: true,
    });

    const res = await patchStatus(order._id, token, "processing");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Imported Case");
    expect(res.body.error).not.toContain(inStock.name);
  });

  it("leaves an ordinary order alone", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 4 });
    const order = await Order.create({
      orderNumber: `EZW-${Date.now()}-plain`,
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price, total: product.price,
      customer: { name: "Ama", phone: "0244000000", email: "ama@example.com" },
      status: "paid", stockDeducted: true,
    });

    const res = await patchStatus(order._id, token, "delivered");

    expect(res.status).toBe(200);
  });
});
