// Customer self-service purchase entry points: buying hosting (POST /hosting/orders)
// and paying for a domain (POST /domain/payment). Paystack, Namecheap and email are
// mocked — no real network calls.
process.env.PAYSTACK_SECRET = "sk_test_dummy";

jest.mock("@paystack/paystack-sdk", () =>
  jest.fn().mockImplementation(() => ({
    transaction: {
      initialize: jest.fn(async () => ({
        status: true,
        data: { authorization_url: "https://paystack.test/pay/x", access_code: "ac", reference: "ref_x" },
      })),
    },
  }))
);
jest.mock("../services/namecheap", () => ({
  hasConfig: jest.fn(() => true),
  getPricing: jest.fn(async () => ({})),
  registerDomain: jest.fn(async () => ({ success: true })),
  setEazWorldNameservers: jest.fn(async () => ({ success: true })),
}));
jest.mock("../utils/hostingEmail", () => ({
  sendOrderConfirmation: jest.fn(async () => {}),
  sendPaymentReceived: jest.fn(async () => {}),
  sendHostingCredentials: jest.fn(async () => {}),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const namecheap = require("../services/namecheap");
const { extractTLD } = require("../utils/domainHelper");
const HostingOrder = require("../models/HostingOrder");
const DomainOrder = require("../models/DomainOrder");
const User = require("../models/User");

async function makeCustomer() {
  const user = await User.create({
    name: "Kwesi Buyer",
    email: `buyer-${Date.now()}-${Math.random().toString(36).slice(2)}@t.com`,
    password: "Password123!",
    role: "user",
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

describe("Hosting purchase — POST /api/v1/hosting/orders (customer)", () => {
  const base = {
    planType: "shared", tier: "deluxe", billingCycle: "monthly",
    customer: { name: "Kwesi Buyer", email: "kwesi@example.com" },
    domainMode: "skip",
  };

  it("bank transfer: creates a pending order (no Paystack)", async () => {
    const { token } = await makeCustomer();
    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, paymentMethod: "bank_transfer" });

    expect(res.status).toBe(200);
    const order = await HostingOrder.findById(res.body.data.orderId);
    expect(order.status).toBe("pending");
    expect(order.paymentMethod).toBe("bank_transfer");
  });

  it("card: returns a Paystack authorization URL", async () => {
    const { token } = await makeCustomer();
    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, paymentMethod: "paystack_card" });

    expect(res.status).toBe(200);
    expect(res.body.data.authorizationUrl).toContain("paystack");
  });

  it("rejects missing plan fields with 400", async () => {
    const { token } = await makeCustomer();
    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, planType: undefined, tier: undefined, paymentMethod: "bank_transfer" });
    expect(res.status).toBe(400);
  });

  it("requires authentication (401 without a token)", async () => {
    const res = await request(app).post("/api/v1/hosting/orders").send({ ...base, paymentMethod: "bank_transfer" });
    expect(res.status).toBe(401);
  });
});

describe("Domain purchase — POST /api/v1/domain/payment (customer)", () => {
  const tld = extractTLD("example.com");
  const EXPECTED = 100; // GHS for 1 year, via mocked pricing

  const body = (over = {}) => ({
    domain: "example.com",
    amount: EXPECTED,
    years: 1,
    fullName: "Kwesi Buyer",
    phone: "0201234567",
    registrantInfo: { firstName: "Kwesi", lastName: "Buyer", address: "1 St", city: "Accra", country: "GH", postalCode: "00233" },
    ...over,
  });

  beforeEach(() => {
    namecheap.hasConfig.mockReturnValue(true);
    namecheap.getPricing.mockResolvedValue({ [tld]: EXPECTED });
  });

  it("initializes payment for a correct amount and creates the order", async () => {
    const { token } = await makeCustomer();
    const res = await request(app)
      .post("/api/v1/domain/payment")
      .set("Authorization", `Bearer ${token}`)
      .send(body());

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("paystack");
    const order = await DomainOrder.findOne({ domain: "example.com" });
    expect(order).toBeTruthy();
    expect(order.status).toBe("pending");
  });

  it("rejects a tampered (too-low) amount with 400", async () => {
    const { token } = await makeCustomer();
    const res = await request(app)
      .post("/api/v1/domain/payment")
      .set("Authorization", `Bearer ${token}`)
      .send(body({ amount: 1 }));
    expect(res.status).toBe(400);
  });

  it("requires authentication (401 without a token)", async () => {
    const res = await request(app).post("/api/v1/domain/payment").send(body());
    expect(res.status).toBe(401);
  });
});
