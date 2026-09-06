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

  it("releases a unit that was never in stock, because it never was", async () => {
    // The ordinary case. A pre-ordered unit is not on the shelf — that is what
    // makes it a pre-order — and when it lands it goes straight out to the
    // customer who paid for it, never into stock. Demanding stock here refused
    // every release the shop actually needed to make.
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.receivedDirect).toEqual(["Imported Phone"]);
    expect(res.body.meta.fromStock).toEqual([]);

    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(0);  // not taken from stock, and never negative
    expect(fresh.sold).toBe(1);   // but it was sold
    expect((await Order.findById(order._id)).items[0].preorderReleasedAt).toBeTruthy();
  });

  it("still takes it off the shelf when the batch WAS received into stock", async () => {
    // The other flow: twenty units received, fifteen spoken for. Releasing one
    // takes it off, exactly as an ordinary sale does.
    const token = await staffToken();
    const product = await makeProduct({ stock: 20, preorder: { enabled: true } });
    const order = await makePaidPreorder(product, 2);

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.fromStock).toEqual(["Imported Phone"]);
    expect(res.body.meta.receivedDirect).toEqual([]);

    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(18);
    expect(fresh.sold).toBe(2);
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

// The batch list moves a whole container; this is the other half — the one
// customer who ordered two instead of three, or whose line went onto the wrong
// container. Quantity is money on a paid pre-order, so the endpoint recomputes
// the totals and reports the difference rather than moving anything.
const Shipment = require("../models/Shipment");

describe("Editing a waiting pre-order line (T45)", () => {

  const patchLine = (orderId, token, body) =>
    request(app).patch(`/api/v1/orders/${orderId}/preorder-line`)
      .set("Authorization", `Bearer ${token}`).send(body);

  async function makeBatch(name = "March batch") {
    await Shipment.ensureReferenceCounter();
    return Shipment.create({
      name,
      reference: `SHP-TEST-${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      stage: "production",
      stageHistory: [{ stage: "production", date: new Date() }],
    });
  }

  it("changes the quantity and recomputes the order's money", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product, 1);

    const res = await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 3 });

    expect(res.status).toBe(200);
    expect(res.body.meta.oldTotal).toBe(500000);
    expect(res.body.meta.newTotal).toBe(1500000);
    expect(res.body.meta.difference).toBe(1000000);
    const fresh = await Order.findById(order._id);
    expect(fresh.items[0].qty).toBe(3);
    expect(fresh.subtotal).toBe(1500000);
    expect(fresh.total).toBe(1500000);
  });

  it("reports money owed BACK when the quantity drops", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product, 3);

    const res = await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 1 });

    expect(res.body.meta.difference).toBe(-1000000);
  });

  it("keeps the delivery fee in the recomputed total", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product, 1);
    await Order.updateOne({ _id: order._id }, { $set: { shippingFee: 2500, total: 502500 } });

    const res = await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 2 });

    expect(res.body.meta.newTotal).toBe(1002500);
  });

  it("respects the per-product pre-order cap", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true, maxQty: 2 } });
    const order = await makePaidPreorder(product, 1);

    const res = await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limited to 2/);
    expect((await Order.findById(order._id)).items[0].qty).toBe(1);
  });

  it("refuses a quantity below one", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 0 });

    expect(res.status).toBe(400);
  });

  it("moves a line onto a batch, and off one again", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    const batch = await makeBatch();

    const on = await patchLine(order._id, token, {
      itemId: order.items[0]._id.toString(), shipment: batch._id.toString(),
    });
    expect(on.status).toBe(200);
    expect(String((await Order.findById(order._id)).items[0].shipment)).toBe(String(batch._id));

    const off = await patchLine(order._id, token, {
      itemId: order.items[0]._id.toString(), shipment: null,
    });
    expect(off.status).toBe(200);
    expect((await Order.findById(order._id)).items[0].shipment).toBeNull();
  });

  it("clears the old batch's journey when the line comes off it", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    const batch = await makeBatch();
    await patchLine(order._id, token, {
      itemId: order.items[0]._id.toString(), shipment: batch._id.toString(),
    });
    expect((await Order.findById(order._id)).trackingHistory.some((e) => e.preorderStage)).toBe(true);

    await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), shipment: null });

    const fresh = await Order.findById(order._id);
    expect(fresh.trackingHistory.some((e) => e.preorderStage)).toBe(false);
    // The staff note recording the move survives.
    expect(fresh.trackingHistory.some((e) => /Pre-order updated/.test(e.note))).toBe(true);
  });

  it("leaves a released line alone — that is a refund, not an edit", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 5, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await request(app).patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);

    const res = await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been released/i);
  });

  it("records the change on the order's history", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product, 1);

    await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 2 });

    const fresh = await Order.findById(order._id);
    expect(fresh.trackingHistory.at(-1).note).toMatch(/Quantity 1 → 2/);
  });

  it("is closed to customers", async () => {
    const token = await staffToken("user");
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await patchLine(order._id, token, { itemId: order.items[0]._id.toString(), qty: 2 });

    expect(res.status).toBe(403);
  });
});

// A batch is an efficiency for the container carrying twenty customers' goods —
// it was never meant to be the price of recording a stage at all. Without this,
// a single pre-order showed the customer five stages and gave staff no way to
// update any of them.
describe("Recording a pre-order's stage with no batch (T45)", () => {
  const setStage = (orderId, token, body) =>
    request(app).patch(`/api/v1/orders/${orderId}/preorder-stage`)
      .set("Authorization", `Bearer ${token}`).send(body);

  it("records a stage on an order that is on no batch", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await setStage(order._id, token, {
      stage: "production", date: "2026-06-01T09:00:00Z", note: "Factory started",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("production");
    expect(res.body.data.preorder.label).toBe("In production");
    const fresh = await Order.findById(order._id).select("+items.preorderStageHistory");
    expect(fresh.items[0].preorderStage).toBe("production");
    expect(fresh.items[0].preorderStageHistory).toHaveLength(1);
  });

  it("puts it on the customer's own tracking history, message and all", async () => {
    const trackingNumber = `EZWTRK-OWN${Date.now()}`;
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await Order.updateOne({ _id: order._id }, { $set: { trackingNumber } });

    await setStage(order._id, token, { stage: "shipped", note: "The vessel is running late" });

    const res = await request(app).get(`/api/v1/orders/track/${trackingNumber}`);
    expect(res.body.data.preorder.stage).toBe("shipped");
    const entry = res.body.data.history.find((e2) => e2.preorderStage === "shipped");
    expect(entry).toBeTruthy();
    // The stage's own wording, and the message staff wrote beside it.
    expect(entry.note).toBe("Shipped — on its way to Ghana");
    expect(entry.detail).toBe("The vessel is running late");
  });

  it("builds the journey up one stage at a time", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    await setStage(order._id, token, { stage: "production" });
    await setStage(order._id, token, { stage: "shipped" });
    const res = await setStage(order._id, token, { stage: "port_ghana" });

    expect(res.body.data.preorder.history.map((h) => h.stage))
      .toEqual(["production", "shipped", "port_ghana"]);
  });

  it("corrects the date of the stage it is already on", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await setStage(order._id, token, { stage: "production" });

    await setStage(order._id, token, { stage: "production", date: "2026-05-04T08:30:00Z" });

    const fresh = await Order.findById(order._id).select("+items.preorderStageHistory");
    expect(fresh.items[0].preorderStageHistory).toHaveLength(1);
    expect(fresh.items[0].preorderStageHistory[0].date.toISOString()).toBe("2026-05-04T08:30:00.000Z");
  });

  it("drops the stages a corrected order never reached", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await setStage(order._id, token, { stage: "port_ghana" });

    await setStage(order._id, token, { stage: "shipped" });

    const fresh = await Order.findById(order._id).select("+items.preorderStageHistory");
    expect(fresh.items[0].preorderStage).toBe("shipped");
    expect(fresh.items[0].preorderStageHistory.map((e) => e.stage)).toEqual(["shipped"]);
  });

  it("refuses when the line rides on a batch — one source drives one journey", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    const batch = await Shipment.create({
      name: "March batch", reference: `SHP-X-${Date.now()}`,
      stage: "production", stageHistory: [{ stage: "production", date: new Date() }],
    });
    await Order.updateOne({ _id: order._id }, { $set: { "items.0.shipment": batch._id } });

    const res = await setStage(order._id, token, { stage: "shipped" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rides on a shipment batch/i);
  });

  it("tells staff which source drives the journey", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await setStage(order._id, token, { stage: "production", note: "Factory started" });

    const res = await request(app).get(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.preorder.journey.source).toBe("order");
    expect(res.body.data.preorder.journey.batch).toBeNull();
    expect(res.body.data.preorder.journey.history[0].note).toBe("Factory started");
    expect(res.body.data.preorder.journey.history[0].customerLabel).toBe("In production");
  });

  it("rejects a stage that is not on the journey", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await setStage(order._id, token, { stage: "customs" });

    expect(res.status).toBe(400);
  });

  it("is closed to customers", async () => {
    const token = await staffToken("user");
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await setStage(order._id, token, { stage: "production" });

    expect(res.status).toBe(403);
  });
});

// The note staff write with a stage IS for the customer — "held at customs,
// expect three more days" is the most useful thing on the page. What must never
// cross is who recorded it and which container it came in on.
describe("What crosses with a pre-order stage, and what does not (T45)", () => {
  async function recordedWithNote() {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    const trackingNumber = `EZWTRK-SEC${Date.now()}`;
    // A reference too: the confirmation page is looked up by it, and without one
    // that probe 404s and every "must not contain" assertion passes vacuously.
    await Order.updateOne({ _id: order._id }, {
      $set: { trackingNumber, paystackReference: `REF_SEC_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
    });
    await request(app).patch(`/api/v1/orders/${order._id}/preorder-stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "shipped", note: "Held at the port — about three more days" });
    return { token, order: await Order.findById(order._id), trackingNumber };
  }

  const message = /Held at the port/i;
  const noAuthor = (entries) => entries.every((e) => e.updatedBy === undefined);

  it("shows the message on the public tracking-number page", async () => {
    const { trackingNumber } = await recordedWithNote();
    const res = await request(app).get(`/api/v1/orders/track/${trackingNumber}`);
    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("shipped");
    expect(JSON.stringify(res.body)).toMatch(message);
    // Against the right entry, not loose in the payload.
    expect(res.body.data.history.find((e) => e.preorderStage === "shipped").detail).toMatch(message);
    // But never who wrote it.
    expect(noAuthor(res.body.data.preorder.history)).toBe(true);
    expect(res.body.data.history.every((e) => e.updatedBy === undefined)).toBe(true);
  });

  it("shows it on the order-number lookup, without the staff name", async () => {
    const { order } = await recordedWithNote();
    const res = await request(app).post("/api/v1/orders/track")
      .send({ orderNumber: order.orderNumber, phone: "0244000000" });
    expect(res.status).toBe(200);
    expect(res.body.data.preorder.history.at(-1).note).toMatch(message);
    expect(noAuthor(res.body.data.preorder.history)).toBe(true);
  });

  it("shows it on the confirmation page", async () => {
    const { order } = await recordedWithNote();
    const res = await request(app).get(`/api/v1/orders/by-reference/${order.paystackReference}`);
    expect(res.body.data.preorder.history.at(-1).note).toMatch(message);
    expect(noAuthor(res.body.data.preorder.history)).toBe(true);
  });

  it("never leaks the RAW internal history onto the customer's own order", async () => {
    // The message reaches the customer through the derived journey. The stored
    // history behind it also carries `updatedBy`, so it stays select:false and
    // must not ride out on the raw order these endpoints return.
    const { order } = await recordedWithNote();
    const customer = await User.create({
      name: "Ama", email: `ama-${Date.now()}@t.com`, password: "Password123!",
      role: "user", isVerified: true, phone: "0244000000",
    });
    const ctok = jwt.sign({ id: customer._id.toString() }, process.env.JWT_SECRET);

    const list = await request(app).get("/api/v1/orders/mine").set("Authorization", `Bearer ${ctok}`);
    const detail = await request(app).get(`/api/v1/orders/mine/${order._id}`).set("Authorization", `Bearer ${ctok}`);

    expect(detail.body.data.items[0].preorderStageHistory).toBeUndefined();
    expect((list.body.data[0]?.items || []).every((i) => i.preorderStageHistory === undefined)).toBe(true);
    expect(noAuthor(detail.body.data.preorder.history)).toBe(true);
    // The customer still sees where their order is, and why.
    expect(detail.body.data.preorder.stage).toBe("shipped");
    expect(detail.body.data.preorder.history.at(-1).note).toMatch(message);
  });

  it("shows staff the message and who recorded it", async () => {
    const { token, order } = await recordedWithNote();
    const res = await request(app).get(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.preorder.journey.source).toBe("order");
    expect(res.body.data.preorder.journey.history.at(-1).note).toMatch(message);
    expect(res.body.data.preorder.journey.history.at(-1).updatedBy).toBe("staff");
  });
});

// "Arrived at our warehouse" IS the release: the goods are here and going
// straight out. Recording the stage and then pressing Release was two clicks for
// one event, and forgetting the second left a customer told their order had
// landed while it still sat in the waiting queue.
describe("Arriving at the warehouse releases the order (T45)", () => {
  const setStage = (orderId, token, stage) =>
    request(app).patch(`/api/v1/orders/${orderId}/preorder-stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage });

  it("releases the waiting lines the moment the stage is recorded", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    const res = await setStage(order._id, token, "at_shop");

    expect(res.status).toBe(200);
    expect(res.body.meta.released).toBe(1);
    expect(res.body.meta.receivedDirect).toEqual(["Imported Phone"]);
    const fresh = await Order.findById(order._id);
    expect(fresh.items[0].preorderReleasedAt).toBeTruthy();
    expect((await Product.findById(product._id)).sold).toBe(1);
  });

  it("does not release at any earlier stage", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    for (const stage of ["production", "container_warehouse", "shipped", "port_ghana"]) {
      const res = await setStage(order._id, token, stage);
      expect(res.body.meta.released).toBe(0);
    }

    expect((await Order.findById(order._id)).items[0].preorderReleasedAt).toBeNull();
  });

  it("takes the order out of the waiting queue", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await setStage(order._id, token, "at_shop");

    const queue = await request(app).get("/api/v1/orders/preorders")
      .set("Authorization", `Bearer ${token}`);

    expect((queue.body.data || []).some((o) => o._id === String(order._id))).toBe(false);
  });

  it("emails the customer that their item has arrived", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);

    await setStage(order._id, token, "at_shop");

    await new Promise((r) => setTimeout(r, 60));
    expect(await EmailLog.findOne({ type: "preorder_ready", orderId: order._id })).toBeTruthy();
  });

  it("lifts the fulfilment hold, so local tracking can start", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await setStage(order._id, token, "at_shop");

    const res = await request(app).patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`).send({ status: "processing" });

    expect(res.status).toBe(200);
  });

  it("cannot sell the unit twice", async () => {
    const token = await staffToken();
    const product = await makeProduct({ stock: 0, preorder: { enabled: true } });
    const order = await makePaidPreorder(product);
    await setStage(order._id, token, "at_shop");

    // The journey is over once released — there is no pre-order left to stage,
    // so a second "at our warehouse" is refused rather than counting the sale
    // again.
    const again = await setStage(order._id, token, "at_shop");

    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/no pre-order lines waiting/i);
    expect((await Product.findById(product._id)).sold).toBe(1);
  });
});
