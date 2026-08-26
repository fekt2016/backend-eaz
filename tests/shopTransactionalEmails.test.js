// T62 — transactional email coverage for everything that used to send nothing:
// shop receipts, shop status moves, refund outcomes, domain orders and service
// deposits. Resend is mocked at the module boundary so `send()` really sends and
// every assertion can read the subject/html that would have gone out.
//
// RESEND_API_KEY is blanked by tests/setup.js; it is set here BEFORE the first
// require of ../utils/email, because the module decides once — at import time —
// whether it has a live client.
process.env.RESEND_API_KEY = "re_test_dummy";

const mockResendSend = jest.fn(async () => ({ id: "msg_1" }));
jest.mock("resend", () => ({
  Resend: class {
    constructor() {
      this.emails = { send: mockResendSend };
    }
  },
}));

const request = require("supertest");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const app = require("../app");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const DeliveryZone = require("../models/DeliveryZone");
const DomainOrder = require("../models/DomainOrder");
const ServiceOrder = require("../models/ServiceOrder");
const User = require("../models/User");
const EmailLog = require("../models/EmailLog");
const { fulfilShopOrder } = require("../utils/fulfilShopOrder");
const { applyRefundOutcome } = require("../utils/refunds");
const {
  sendShopOrderConfirmationEmail,
  sendShopStatusEmail,
  sendRefundOutcomeEmail,
  sendDomainConfirmationEmail,
  sendServiceConfirmationEmail,
} = require("../utils/email");

// A paid-looking shop order as plain objects — the email builders read fields,
// not models.
function fakeShopOrder(over = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    orderNumber: "EZW-1000",
    trackingNumber: "EZWTRK-TEST01",
    status: "paid",
    subtotal: 500000,
    deliveryFee: 2000,
    total: 502000,
    customer: { name: "Ama Owusu", phone: "0244000000", email: "ama@example.com" },
    items: [
      { name: "Phone Case", price: 500000, qty: 1 },
      { name: "Imported Charger", price: 100000, qty: 2, isPreorder: true },
    ],
    ...over,
  };
}

beforeEach(() => {
  mockResendSend.mockClear();
});

describe("sendShopOrderConfirmationEmail (T62 gap 1)", () => {
  it("sends the receipt with the tracking link, zone name, totals and pre-order section", async () => {
    const order = fakeShopOrder();
    const ok = await sendShopOrderConfirmationEmail(order, {
      deliveryZoneName: "Accra Central",
      preorderNotes: ["Imported Charger (expected from 12 Sep 2026)"],
    });

    expect(ok).toBe(true);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const { to, subject, html } = mockResendSend.mock.calls[0][0];
    expect(to).toEqual(["ama@example.com"]);
    expect(subject).toContain("EZW-1000");
    expect(html).toContain("/track/order/EZWTRK-TEST01");
    expect(html).toContain("Accra Central");
    // Pesewas rendered through formatGhs: 502000 → GH₵5,020.00
    expect(html).toContain("GH₵5,020.00");
    expect(html).toContain("(pre-order)");
    expect(html).toContain("expected from 12 Sep 2026");
    expect(html).toContain("reaches our shop");
  });

  it("returns quietly when the customer has no email — phone-first checkout", async () => {
    const order = fakeShopOrder({ customer: { name: "Ama", phone: "0244000000", email: "" } });
    const ok = await sendShopOrderConfirmationEmail(order);

    expect(ok).toBe(false);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("omits the pre-order section on an ordinary order", async () => {
    const order = fakeShopOrder({
      items: [{ name: "Phone Case", price: 500000, qty: 1 }],
    });
    await sendShopOrderConfirmationEmail(order);

    const { html } = mockResendSend.mock.calls[0][0];
    expect(html).not.toContain("(pre-order)");
    expect(html).not.toContain("reaches our shop");
  });
});

describe("sendShopStatusEmail (T62 gap 3)", () => {
  it.each(["processing", "shipped", "delivered", "cancelled"])(
    "has a message for %s",
    async (status) => {
      const ok = await sendShopStatusEmail(fakeShopOrder({ status }));
      expect(ok).toBe(true);
      const { subject } = mockResendSend.mock.calls[0][0];
      expect(subject).toContain("EZW-1000");
    }
  );

  it("stays silent for statuses that have their own moment (paid/pending)", async () => {
    expect(await sendShopStatusEmail(fakeShopOrder({ status: "paid" }))).toBe(false);
    expect(await sendShopStatusEmail(fakeShopOrder({ status: "pending" }))).toBe(false);
    expect(mockResendSend).not.toHaveBeenCalled();
  });
});

describe("sendRefundOutcomeEmail (T62 gap 4)", () => {
  it("tells the customer when the refund completed", async () => {
    const ok = await sendRefundOutcomeEmail(
      fakeShopOrder({ refund: { status: "completed", amount: 502000, reason: "Wrong item" } })
    );
    expect(ok).toBe(true);
    const { subject, html } = mockResendSend.mock.calls[0][0];
    expect(subject).toContain("refund is on its way");
    expect(html).toContain("GH₵5,020.00");
    expect(html).toContain("Wrong item");
  });

  it("does not hide a failed refund from the person it happened to", async () => {
    const ok = await sendRefundOutcomeEmail(
      fakeShopOrder({ refund: { status: "failed", amount: 502000 } })
    );
    expect(ok).toBe(true);
    expect(mockResendSend.mock.calls[0][0].subject).toContain("Issue with your refund");
  });

  it("ignores in-flight refunds", async () => {
    expect(
      await sendRefundOutcomeEmail(fakeShopOrder({ refund: { status: "processing", amount: 1 } }))
    ).toBe(false);
    expect(mockResendSend).not.toHaveBeenCalled();
  });
});

describe("sendDomainConfirmationEmail + sendServiceConfirmationEmail (gaps 5–6)", () => {
  it("celebrates a registered domain with its renewal year", async () => {
    await sendDomainConfirmationEmail(
      { _id: "d1", domain: "amaonline.com", customerName: "Ama Owusu", email: "ama@example.com", years: 2, price: 380 },
      { registered: true }
    );
    const { subject, html } = mockResendSend.mock.calls[0][0];
    expect(subject).toContain("amaonline.com");
    expect(html).toContain("2 years");
    expect(html).toContain("GH₵380");
  });

  it("keeps a paying customer informed when registration did not go through", async () => {
    await sendDomainConfirmationEmail(
      { _id: "d1", domain: "amaonline.com", customerName: "Ama Owusu", email: "ama@example.com", years: 1, price: 190 },
      { registered: false }
    );
    expect(mockResendSend.mock.calls[0][0].subject).toContain("We received your domain order");
  });

  it("receipts a service deposit and shows the balance (GHS floats, not pesewas)", async () => {
    await sendServiceConfirmationEmail({
      _id: "s1", package: "Business Website", name: "Kojo Mensah", email: "kojo@example.com",
      depositAmount: 1500, totalAmount: 4500,
    });
    const { html } = mockResendSend.mock.calls[0][0];
    expect(html).toContain("Business Website");
    expect(html).toContain("GH₵1,500.00"); // NOT GH₵150,000.00 — floats stay floats
    expect(html).toContain("GH₵3,000.00");
  });
});

describe("wiring: fulfilShopOrder sends the receipt exactly once", () => {
  async function makePaidableOrder() {
    const product = await Product.create({
      name: "Phone Case", slug: `case-${Date.now()}`, price: 500000, category: "Phones", stock: 10,
    });
    const preorderProduct = await Product.create({
      name: "Imported Charger", slug: `charger-${Date.now()}`, price: 100000, category: "Phones", stock: 0,
      preorder: { enabled: true, availableFrom: new Date("2026-09-12"), note: "Ships from abroad" },
    });
    const zone = await DeliveryZone.create({ name: "Accra Central", fee: 2000, estimatedDays: 2, isActive: true });
    return Order.create({
      orderNumber: `EZW-${Date.now()}`,
      trackingNumber: `EZWTRK-${Date.now()}`,
      paystackReference: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      customer: { name: "Ama Owusu", phone: "0244000000", email: "ama@example.com" },
      items: [
        { name: "Phone Case", price: 500000, qty: 1, product: product._id },
        { name: "Imported Charger", price: 100000, qty: 2, product: preorderProduct._id, isPreorder: true },
      ],
      subtotal: 700000,
      deliveryFee: 2000,
      total: 702000,
      deliveryZone: zone._id,
      status: "pending",
    });
  }

  it("emails the receipt with the product's expected-availability line", async () => {
    const order = await makePaidableOrder();
    const paid = await fulfilShopOrder(order.paystackReference);
    expect(paid).toBeTruthy();

    // The confirmation rides a Promise.all chain — give the microtasks a beat.
    await new Promise((r) => setTimeout(r, 30));

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const { html } = mockResendSend.mock.calls[0][0];
    expect(html).toContain(`/track/order/${order.trackingNumber}`);
    expect(html).toContain("Accra Central");
    expect(html).toContain("Ships from abroad");
  });

  it("never emails twice — a webhook retry is idempotent", async () => {
    const order = await makePaidableOrder();
    await fulfilShopOrder(order.paystackReference);
    const again = await fulfilShopOrder(order.paystackReference);
    expect(again).toBeNull(); // already paid
    await new Promise((r) => setTimeout(r, 30));
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });
});

describe("wiring: status changes and refunds email through their endpoints", () => {
  async function staffAuth(role = "admin") {
    const user = await User.create({
      name: role, email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@t.com`,
      password: "Password123!", role, isVerified: true,
    });
    const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
    return { token, userId: user._id };
  }

  it("PATCH /orders/:id moves to shipped and emails the customer", async () => {
    const { token } = await staffAuth();
    const order = await Order.create({
      orderNumber: `EZW-${Date.now()}`,
      trackingNumber: `EZWTRK-${Date.now()}`,
      paystackReference: `ref_${Date.now()}`,
      customer: { name: "Ama Owusu", phone: "0244000000", email: "ama@example.com" },
      items: [{ name: "Case", price: 5000, qty: 1 }],
      subtotal: 5000, deliveryFee: 0, total: 5000,
      status: "paid",
    });

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "shipped" });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockResendSend.mock.calls[0][0].subject).toContain("on its way");
  });

  it("applyRefundOutcome emails both terminal outcomes (shared by sync/reconcile/webhook)", async () => {
    const { userId } = await staffAuth();
    const order = await Order.create({
      orderNumber: `EZW-${Date.now()}`,
      trackingNumber: `EZWTRK-${Date.now()}`,
      paystackReference: `ref_${Date.now()}`,
      customer: { name: "Ama Owusu", phone: "0244000000", email: "ama@example.com" },
      items: [{ name: "Case", price: 5000, qty: 1 }],
      subtotal: 5000, deliveryFee: 0, total: 5000,
      status: "paid",
      refund: { status: "processing", amount: 5000, requestedBy: userId, requestedAt: new Date() },
    });

    await applyRefundOutcome(order, "completed", null);
    await applyRefundOutcome(order, "failed", null); // settled — no second word

    await new Promise((r) => setTimeout(r, 30));
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockResendSend.mock.calls[0][0].subject).toContain("refund is on its way");

    const logs = await EmailLog.find({ type: "refund_completed" });
    expect(logs).toHaveLength(1);
  });
});

describe("wiring: webhooks receipt domain and service orders", () => {
  const SECRET = process.env.PAYSTACK_SECRET;
  const postWebhook = (payload) =>
    request(app)
      .post("/api/webhooks/paystack")
      .set("x-paystack-signature", crypto.createHmac("sha512", SECRET).update(JSON.stringify(payload)).digest("hex"))
      .send(payload);

  it("domain payment confirms even though Spaceship has no config in tests", async () => {
    const ref = `domref_${Date.now()}`;
    const owner = await User.create({
      name: "Buyer", email: `buyer-${Date.now()}@t.com`, password: "Password123!", role: "user",
    });
    await DomainOrder.create({
      user: owner._id,
      domain: "amaonline.com",
      tld: "com",
      price: 250,
      amountPesewas: 25000,
      email: "ama@example.com",
      customerName: "Ama Owusu",
      years: 1,
      status: "pending",
      paystackReference: ref,
    });

    const res = await postWebhook({
      event: "charge.success",
      data: { reference: ref, amount: 25000, currency: "GHS" },
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 30));
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const { subject } = mockResendSend.mock.calls[0][0];
    // hasConfig() is false under test (setup.js blanks the Spaceship keys), so
    // registration could not run — but the paying customer still hears from us.
    expect(subject).toContain("We received your domain order");
  });

  it("service deposit payment receipts the project", async () => {
    const ref = `svcref_${Date.now()}`;
    await ServiceOrder.create({
      name: "Kojo Mensah",
      package: "Landing Page",
      email: "kojo@example.com",
      phone: "0201234567",
      depositAmount: 1000,
      totalAmount: 3000,
      status: "pending",
      paystackReference: ref,
    });

    const res = await postWebhook({
      event: "charge.success",
      data: { reference: ref, amount: 100000, currency: "GHS" },
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 30));
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const { type, html } = mockResendSend.mock.calls[0][0];
    void type;
    expect(html).toContain("Landing Page");
    expect(html).toContain("GH₵1,000.00");
  });
});
