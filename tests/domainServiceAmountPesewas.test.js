// T44 follow-up: DomainOrder.price / ServiceOrder.depositAmount+totalAmount
// stay intentional major-GHS floats (see the model comments). This adds
// amountPesewas / depositAmountPesewas+totalAmountPesewas, computed once at
// creation and used by the webhook instead of re-deriving via
// Math.round(field * 100) at every comparison.
const mockInitialize = jest.fn();
jest.mock("@paystack/paystack-sdk", () => {
  return class Paystack {
    constructor() {}
    get transaction() {
      return { initialize: mockInitialize };
    }
  };
});
jest.mock("../services/spaceship", () => ({
  hasConfig: jest.fn(() => true),
  getPricing: jest.fn(async () => ({ ".com": 85 })),
  registerDomain: jest.fn(async () => ({ success: true })),
  setEazWorldNameservers: jest.fn(async () => ({ success: true })),
}));

const crypto = require("crypto");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const DomainOrder = require("../models/DomainOrder");
const ServiceOrder = require("../models/ServiceOrder");

async function makeUser() {
  const user = await User.create({
    name: "Cust",
    email: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role: "user",
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

function paystackSignature(payload) {
  const secret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
  return crypto.createHmac("sha512", secret).update(JSON.stringify(payload)).digest("hex");
}

function sendWebhook(payload) {
  return request(app)
    .post("/api/webhooks/paystack")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", paystackSignature(payload))
    .send(payload);
}

function ref(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

beforeEach(() => {
  mockInitialize.mockReset();
  mockInitialize.mockResolvedValue({
    status: true,
    data: { authorization_url: "https://pay.example/checkout", access_code: "acc", reference: "REF" },
  });
});

describe("DomainOrder.amountPesewas (T44 follow-up)", () => {
  it("is set to the pesewas equivalent of price on order creation", async () => {
    const { token } = await makeUser();
    const res = await request(app)
      .post("/api/v1/domain/payment")
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybusiness.com", years: 1, amount: 85 });

    expect(res.status).toBe(200);
    const order = await DomainOrder.findOne().sort({ _id: -1 });
    expect(order.price).toBe(85);
    expect(order.amountPesewas).toBe(8500);
  });

  it("webhook decision follows amountPesewas, not a recomputed Math.round(price*100)", async () => {
    const { user } = await makeUser();
    const order = await DomainOrder.create({
      user: user._id,
      domain: "mybusiness.com",
      tld: ".com",
      price: 85, // would derive 8500 pesewas the old way
      amountPesewas: 1234, // the field the fix should actually use
      email: "cust@t.com",
      customerName: "Cust",
      paystackReference: ref("DOM_TEST"),
      status: "pending",
    });

    const res = await sendWebhook({
      event: "charge.success",
      data: { reference: order.paystackReference, amount: 1234, currency: "GHS" },
    });

    expect(res.status).toBe(200);
    const fresh = await DomainOrder.findById(order._id);
    expect(fresh.status).toBe("completed");
  });

  it("falls back to deriving pesewas from `price` for a legacy order with no amountPesewas field", async () => {
    const { user } = await makeUser();
    const order = await DomainOrder.create({
      user: user._id,
      domain: "mybusiness.net",
      tld: ".net",
      price: 75,
      // amountPesewas intentionally omitted — defaults to null.
      email: "cust@t.com",
      customerName: "Cust",
      paystackReference: ref("DOM_TEST"),
      status: "pending",
    });
    expect(order.amountPesewas).toBeNull();

    const res = await sendWebhook({
      event: "charge.success",
      data: { reference: order.paystackReference, amount: 7500, currency: "GHS" },
    });

    expect(res.status).toBe(200);
    const fresh = await DomainOrder.findById(order._id);
    expect(fresh.status).toBe("completed");
  });
});

describe("ServiceOrder.depositAmountPesewas / totalAmountPesewas (T44 follow-up)", () => {
  it("are set to the pesewas equivalents of depositAmount/totalAmount on order creation", async () => {
    const res = await request(app)
      .post("/api/v1/services/payment")
      .send({ name: "Cust", email: "cust@t.com", package: "Landing Page" });

    expect(res.status).toBe(200);
    const order = await ServiceOrder.findOne().sort({ _id: -1 });
    expect(order.depositAmount).toBe(400);
    expect(order.totalAmount).toBe(800);
    expect(order.depositAmountPesewas).toBe(40000);
    expect(order.totalAmountPesewas).toBe(80000);
  });

  it("webhook decision follows depositAmountPesewas, not a recomputed Math.round(depositAmount*100)", async () => {
    const order = await ServiceOrder.create({
      name: "Cust",
      email: "cust@t.com",
      service: "Web Design",
      package: "Landing Page",
      depositAmount: 400, // would derive 40000 pesewas the old way
      totalAmount: 800,
      depositAmountPesewas: 1234, // the field the fix should actually use
      totalAmountPesewas: 80000,
      paystackReference: ref("svc_test"),
      status: "pending",
    });

    const res = await sendWebhook({
      event: "charge.success",
      data: { reference: order.paystackReference, amount: 1234, currency: "GHS" },
    });

    expect(res.status).toBe(200);
    const fresh = await ServiceOrder.findById(order._id);
    expect(fresh.status).toBe("paid");
  });

  it("falls back to deriving pesewas from `depositAmount` for a legacy order with no depositAmountPesewas field", async () => {
    const order = await ServiceOrder.create({
      name: "Cust",
      email: "cust@t.com",
      service: "Web Design",
      package: "Business Website",
      depositAmount: 1250,
      totalAmount: 2500,
      // depositAmountPesewas/totalAmountPesewas intentionally omitted.
      paystackReference: ref("svc_test"),
      status: "pending",
    });
    expect(order.depositAmountPesewas).toBeNull();

    const res = await sendWebhook({
      event: "charge.success",
      data: { reference: order.paystackReference, amount: 125000, currency: "GHS" },
    });

    expect(res.status).toBe(200);
    const fresh = await ServiceOrder.findById(order._id);
    expect(fresh.status).toBe("paid");
  });
});
