// T3b — Paystack webhook E2E verification for e-commerce (shop) orders.
//
// Proves the full round-trip: signed webhook → signature check → event
// routing → amount/currency validation → fulfilShopOrder → order marked paid.
// The Paystack SDK is NOT mocked here — only the webhook delivery path is
// tested (the SDK is used for outgoing refund.create, not incoming webhooks).
//
// afterEach in setup.js wipes ALL collections after every test, so every
// describe block uses `beforeEach` for seed data.
const crypto = require("crypto");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");

const BASE = "/api/v1";

// ── Helpers ──────────────────────────────────────────────────────────────────

function signPayload(payload) {
  const secret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
  return crypto.createHmac("sha512", secret).update(JSON.stringify(payload)).digest("hex");
}

function sendWebhook(payload) {
  return request(app)
    .post("/api/webhooks/paystack")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", signPayload(payload))
    .send(payload);
}

function sendRawWebhook(rawBody, signature) {
  return request(app)
    .post("/api/webhooks/paystack")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", signature)
    .send(rawBody);
}

async function makeUser(role = "admin") {
  const user = await User.create({
    name: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

// ── Signature verification ─────────────────────────────────────────────────

describe("Webhook signature verification", () => {
  it("rejects a webhook with no signature header", async () => {
    const res = await request(app)
      .post("/api/webhooks/paystack")
      .set("Content-Type", "application/json")
      .send({ event: "charge.success", data: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  it("rejects a webhook with a wrong signature", async () => {
    const payload = { event: "charge.success", data: { reference: "REF_BAD" } };
    const res = await sendRawWebhook(payload, "deadbeef".repeat(16));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  it("rejects a webhook when PAYSTACK_SECRET is empty", async () => {
    const orig = process.env.PAYSTACK_SECRET;
    process.env.PAYSTACK_SECRET = "";
    const payload = { event: "charge.success", data: { reference: "REF_NO_SECRET" } };
    const res = await sendRawWebhook(payload, "any");
    expect(res.status).toBe(400);
    process.env.PAYSTACK_SECRET = orig;
  });

  it("accepts a properly signed webhook", async () => {
    const { user } = await makeUser();
    const product = await Product.create({
      name: "Webhook Test Cable", slug: "webhook-test-cable",
      price: 3000, stock: 50, isActive: true, category: "Accessories",
    });
    const ref = `REF_WEBHOOK_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const order = await Order.create({
      orderNumber: `EZW-WH-${Date.now()}`,
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price,
      status: "pending",
      paystackReference: ref,
      customer: { name: "Webhook Test", phone: "0244000000", email: "wh@test.com" },
    });

    const payload = {
      event: "charge.success",
      data: { reference: ref, amount: product.price, currency: "GHS" },
    };

    const res = await sendWebhook(payload);
    expect(res.status).toBe(200);

    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe("paid");
    expect(fresh.paidAt).toBeTruthy();
    expect(fresh.stockDeducted).toBe(true);
  });

  it("idempotent — second webhook for same reference is a no-op", async () => {
    const { user } = await makeUser();
    const product = await Product.create({
      name: "Idempotent Cable", slug: "idempotent-cable",
      price: 2000, stock: 30, isActive: true, category: "Accessories",
    });
    const ref = `REF_IDEM_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await Order.create({
      orderNumber: `EZW-IDEM-${Date.now()}`,
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price,
      status: "pending",
      paystackReference: ref,
      customer: { name: "Idem Test", phone: "0244000001", email: "idem@test.com" },
    });

    const payload = {
      event: "charge.success",
      data: { reference: ref, amount: product.price, currency: "GHS" },
    };

    const res1 = await sendWebhook(payload);
    expect(res1.status).toBe(200);

    const res2 = await sendWebhook(payload);
    expect(res2.status).toBe(200);
  });

  it("rejects amount mismatch", async () => {
    const { user } = await makeUser();
    const product = await Product.create({
      name: "Mismatch Cable", slug: "mismatch-cable",
      price: 5000, stock: 20, isActive: true, category: "Accessories",
    });
    const ref = `REF_MISMATCH_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await Order.create({
      orderNumber: `EZW-MISMATCH-${Date.now()}`,
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price,
      status: "pending",
      paystackReference: ref,
      customer: { name: "Mismatch", phone: "0244000002", email: "mismatch@test.com" },
    });

    const payload = {
      event: "charge.success",
      data: { reference: ref, amount: product.price + 1000, currency: "GHS" },
    };

    const res = await sendWebhook(payload);
    expect(res.status).toBe(400);

    const fresh = await Order.findOne({ paystackReference: ref });
    expect(fresh.status).toBe("pending");
  });

  it("rejects currency mismatch (non-GHS)", async () => {
    const { user } = await makeUser();
    const product = await Product.create({
      name: "Currency Cable", slug: "currency-cable",
      price: 4000, stock: 20, isActive: true, category: "Accessories",
    });
    const ref = `REF_CUR_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await Order.create({
      orderNumber: `EZW-CUR-${Date.now()}`,
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price,
      status: "pending",
      paystackReference: ref,
      customer: { name: "Currency", phone: "0244000003", email: "cur@test.com" },
    });

    const payload = {
      event: "charge.success",
      data: { reference: ref, amount: product.price, currency: "USD" },
    };

    const res = await sendWebhook(payload);
    expect(res.status).toBe(400);
  });

  it("unknown events return 200 (ack, don't error)", async () => {
    const payload = { event: "subscription.create", data: {} };
    const res = await sendWebhook(payload);
    expect(res.status).toBe(200);
  });

  it("refund.processed updates order refund status", async () => {
    const { user } = await makeUser();
    const ref = `REF_REFUND_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const refundId = Math.floor(Math.random() * 1000000);
    const order = await Order.create({
      orderNumber: `EZW-REF-${Date.now()}`,
      items: [{ name: "Refund item", price: 3000, qty: 1 }],
      subtotal: 3000,
      total: 3000,
      status: "paid",
      paystackReference: ref,
      customer: { name: "Refund", phone: "0244000004", email: "refund@test.com" },
      refund: {
        status: "processing",
        amount: 3000,
        requestedBy: user._id,
        requestedAt: new Date(),
      },
    });

    // Patch the refund reference so the webhook can find it
    await Order.findByIdAndUpdate(order._id, { "refund.reference": String(refundId) });

    const payload = {
      event: "refund.processed",
      data: { id: refundId, amount: 3000, currency: "GHS" },
    };

    const res = await sendWebhook(payload);
    expect(res.status).toBe(200);

    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe("completed");
  });

  it("refund.failed updates order refund status", async () => {
    const { user } = await makeUser();
    const ref = `REF_REFFAIL_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const refundId = Math.floor(Math.random() * 1000000);
    const order = await Order.create({
      orderNumber: `EZW-REFFAIL-${Date.now()}`,
      items: [{ name: "Refund fail item", price: 3000, qty: 1 }],
      subtotal: 3000,
      total: 3000,
      status: "paid",
      paystackReference: ref,
      customer: { name: "RefFail", phone: "0244000005", email: "reffail@test.com" },
      refund: {
        status: "processing",
        amount: 3000,
        requestedBy: user._id,
        requestedAt: new Date(),
      },
    });

    await Order.findByIdAndUpdate(order._id, { "refund.reference": String(refundId) });

    const payload = {
      event: "refund.failed",
      data: { id: refundId, amount: 3000, currency: "GHS" },
    };

    const res = await sendWebhook(payload);
    expect(res.status).toBe(200);

    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe("failed");
  });
});
