// T89 — a paid order that cannot ship must SAY SO.
// T121 — duplicate webhooks must not double-fulfil hosting or domain orders.
//
// Both are money-path correctness: T89 is "we took the money and one line
// silently never shipped", T121 is "we took the money once and did the work
// twice".
const crypto = require("crypto");
const request = require("supertest");
const mongoose = require("mongoose");

const app = require("../app");
const ActivityLog = require("../models/ActivityLog");

const Order = require("../models/Order");
const Product = require("../models/Product");
const HostingOrder = require("../models/HostingOrder");
const DomainOrder = require("../models/DomainOrder");
const { fulfilShopOrder } = require("../utils/fulfilShopOrder");

async function makeProduct(stock) {
  return Product.create({
    name: `Widget-${Math.random().toString(36).slice(2, 7)}`,
    slug: `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    price: 1000, category: "Phones", stock,
  });
}

async function makePendingOrder(items, total) {
  return Order.create({
    orderNumber: `ORD-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
    items, subtotal: total, total,
    customer: { name: "Ama", phone: "0241234567" },
    status: "pending",
    paystackReference: `ref_${Math.random().toString(36).slice(2, 12)}`,
  });
}

describe("T89 — a paid order records lines it could not fulfil", () => {
  it("records nothing when every line ships", async () => {
    const p = await makeProduct(10);
    const order = await makePendingOrder(
      [{ product: p._id, name: p.name, price: 1000, qty: 2 }], 2000,
    );

    const paid = await fulfilShopOrder(order.paystackReference, { amountPesewas: 2000 });
    expect(paid.status).toBe("paid");

    const fresh = await Order.findById(order._id);
    expect(fresh.fulfilmentIssues).toHaveLength(0);
    expect((await Product.findById(p._id)).stock).toBe(8);
  });

  // The defect: stock ran out between checkout and the webhook.
  it("records the shortfall instead of silently continuing", async () => {
    const p = await makeProduct(1);
    const order = await makePendingOrder(
      [{ product: p._id, name: "Sold Out Widget", price: 1000, qty: 5 }], 5000,
    );

    const paid = await fulfilShopOrder(order.paystackReference, { amountPesewas: 5000 });

    // Fulfilment still SUCCEEDS — the payment landed and must not be undone.
    expect(paid.status).toBe("paid");

    const fresh = await Order.findById(order._id);
    expect(fresh.fulfilmentIssues).toHaveLength(1);
    expect(fresh.fulfilmentIssues[0].itemName).toBe("Sold Out Widget");
    expect(fresh.fulfilmentIssues[0].qtyRequested).toBe(5);
    expect(fresh.fulfilmentIssues[0].reason).toBe("insufficient_stock");

    // And it never oversold — the guard still held.
    expect((await Product.findById(p._id)).stock).toBe(1);
  });

  it("records only the failing line when others succeed", async () => {
    const ok = await makeProduct(10);
    const short = await makeProduct(0);
    const order = await makePendingOrder([
      { product: ok._id,    name: "In Stock",  price: 1000, qty: 1 },
      { product: short._id, name: "Out Of It", price: 1000, qty: 1 },
    ], 2000);

    await fulfilShopOrder(order.paystackReference, { amountPesewas: 2000 });

    const fresh = await Order.findById(order._id);
    expect(fresh.fulfilmentIssues).toHaveLength(1);
    expect(fresh.fulfilmentIssues[0].itemName).toBe("Out Of It");
    expect((await Product.findById(ok._id)).stock).toBe(9); // the good line shipped
  });

  it("still marks stockDeducted, so the order is not reprocessed", async () => {
    const p = await makeProduct(0);
    const order = await makePendingOrder(
      [{ product: p._id, name: "Nope", price: 1000, qty: 1 }], 1000,
    );

    await fulfilShopOrder(order.paystackReference, { amountPesewas: 1000 });
    const fresh = await Order.findById(order._id);
    expect(fresh.stockDeducted).toBe(true);
    expect(fresh.fulfilmentIssues).toHaveLength(1);
  });

  it("stays idempotent — a replayed webhook does not duplicate the issues", async () => {
    const p = await makeProduct(0);
    const order = await makePendingOrder(
      [{ product: p._id, name: "Nope", price: 1000, qty: 1 }], 1000,
    );

    await fulfilShopOrder(order.paystackReference, { amountPesewas: 1000 });
    await fulfilShopOrder(order.paystackReference, { amountPesewas: 1000 }).catch(() => {});

    const fresh = await Order.findById(order._id);
    expect(fresh.fulfilmentIssues).toHaveLength(1);
  });
});

describe("T121 — the duplicate guard is atomic, not read-then-check", () => {
  // Driven through the REAL webhook endpoint, not a query written in the test.
  //
  // The first version of these tests defined their own findOneAndUpdate and
  // asserted on that — which passed happily even with the controller's guard
  // mutated to be unconditional, because it never touched the controller. A
  // test that mirrors the implementation proves nothing.
  const sign = (payload) =>
    crypto.createHmac("sha512", process.env.PAYSTACK_SECRET)
      .update(JSON.stringify(payload)).digest("hex");

  const fire = (payload) =>
    request(app)
      .post("/api/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", sign(payload))
      .send(payload);

  const charge = (reference, amountPesewas) => ({
    event: "charge.success",
    data: { reference, amount: amountPesewas, currency: "GHS", status: "success" },
  });

  it("hosting: a replayed webhook does not re-run fulfilment", async () => {
    const ref = `hr_${Math.random().toString(36).slice(2, 10)}`;
    const order = await HostingOrder.create({
      user: new mongoose.Types.ObjectId(),
      domain: `x-${Date.now()}.com`,
      planType: "shared", tier: "starter", billingCycle: "monthly",
      paymentMethod: "paystack_card",
      customer: { name: "Ama", email: "ama@eaz.test" },
      status: "pending", provisioningStatus: "not_started",
      amount: 100, amountPesewas: 10000,
      paystackReference: ref,
    });

    const first = await fire(charge(ref, 10000));
    expect(first.status).toBe(200);

    const afterFirst = await HostingOrder.findById(order._id);
    expect(afterFirst.status).toBe("paid");

    const logsAfterFirst = await ActivityLog.countDocuments({
      action: "PAYMENT_VERIFIED", resourceId: ref,
    });
    expect(logsAfterFirst).toBe(1);

    // Replay. The order is now paid AND provisioning has moved off
    // not_started, so the claim must refuse it.
    const second = await fire(charge(ref, 10000));
    expect(second.status).toBe(200);

    // The observable proof the second pass did NO work. paidAt is useless here:
    // the claim writes `paidAt || new Date()`, so on a replay it rewrites the
    // same value and looks unchanged either way — an earlier version of this
    // test asserted on it and passed happily with the guard removed. A second
    // PAYMENT_VERIFIED entry means the branch ran again, which in production
    // also means provisionHostingAccount() ran again.
    const logsAfterSecond = await ActivityLog.countDocuments({
      action: "PAYMENT_VERIFIED", resourceId: ref,
    });
    expect(logsAfterSecond).toBe(1);
  });

  it("domain: a replayed webhook does not re-complete the order", async () => {
    const ref = `dr_${Math.random().toString(36).slice(2, 10)}`;
    const order = await DomainOrder.create({
      user: new mongoose.Types.ObjectId(),
      domain: `y-${Date.now()}.com`,
      tld: "com", price: 100, amountPesewas: 10000,
      email: "ama@eaz.test", customerName: "Ama",
      status: "pending",
      paystackReference: ref,
    });

    const first = await fire(charge(ref, 10000));
    expect(first.status).toBe(200);

    const afterFirst = await DomainOrder.findById(order._id);
    expect(afterFirst.status).toBe("completed");
    const paidAtFirst = afterFirst.paidAt;

    const second = await fire(charge(ref, 10000));
    expect(second.status).toBe(200);

    const afterSecond = await DomainOrder.findById(order._id);
    // If the guard were unconditional, this second pass would stamp a new
    // paidAt — and, in production, register the domain a second time at real
    // cost. That is what this assertion protects.
    expect(afterSecond.paidAt.toISOString()).toBe(paidAtFirst.toISOString());
  });
});
