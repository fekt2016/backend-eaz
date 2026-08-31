// Staff-created hosting accounts (in-store): cash provisions immediately via WHM;
// Paystack returns a payment link and the webhook provisions later.
// WHM, email, Namecheap and the Paystack SDK are all mocked — no real calls.
process.env.PAYSTACK_SECRET = "sk_test_dummy";

jest.mock("@paystack/paystack-sdk", () =>
  jest.fn().mockImplementation(() => ({
    transaction: {
      initialize: jest.fn(async () => ({
        status: true,
        data: {
          authorization_url: "https://paystack.test/pay/abc",
          access_code: "ac_1",
          reference: "ref_1",
        },
      })),
    },
  }))
);
jest.mock("../services/whm", () => ({
  hasConfig: jest.fn(() => true),
  generateUsername: jest.fn(() => "cust123"),
  generatePassword: jest.fn(() => "Str0ng!passwd12"),
  createAccount: jest.fn(async () => ({ success: true, username: "cust123", password: "Str0ng!passwd12" })),
  runAutoSSL: jest.fn(async () => ({ success: true })),
}));
jest.mock("../utils/hostingEmail", () => ({
  sendHostingCredentials: jest.fn(async () => {}),
  sendOrderConfirmation: jest.fn(async () => {}),
  sendPaymentReceived: jest.fn(async () => {}),
}));
jest.mock("../services/namecheap", () => ({
  registerDomain: jest.fn(async () => ({ success: true })),
  setEazWorldNameservers: jest.fn(async () => ({ success: true })),
  hasConfig: jest.fn(() => false),
  getPricing: jest.fn(async () => ({})),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const HostingOrder = require("../models/HostingOrder");
const User = require("../models/User");

async function makeUser(role = "staff") {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@t.com`,
    password: "Password123!",
    role,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

const URL = "/api/v1/hosting/orders/staff-create";
const body = (over = {}) => ({
  planType: "shared",
  tier: "deluxe",
  billingCycle: "monthly",
  customer: { name: "Ama Owusu", email: "ama@example.com", phone: "0201234567" },
  paymentMethod: "cash",
  domainMode: "skip",
  ...over,
});

describe("POST /api/v1/hosting/orders/staff-create", () => {
  it("cash: creates + provisions the cPanel account immediately and creates the customer user", async () => {
    const { token } = await makeUser("staff");
    const res = await request(app).post(URL).set("Authorization", `Bearer ${token}`).send(body());

    expect(res.status).toBe(201);
    expect(res.body.data.provisioningStatus).toBe("provisioned");
    expect(res.body.data.cpanelUsername).toBe("cust123");

    const order = await HostingOrder.findById(res.body.data.orderId);
    expect(order.status).toBe("active");
    expect(order.paymentMethod).toBe("cash");
    expect(order.createdByStaff).toBeTruthy();

    const customer = await User.findOne({ email: "ama@example.com" });
    expect(customer).toBeTruthy();
    expect(order.user.toString()).toBe(customer._id.toString());
  });

  it("paystack: returns an authorization URL and leaves the order pending", async () => {
    const { token } = await makeUser("admin");
    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${token}`)
      .send(body({ paymentMethod: "paystack_card" }));

    expect(res.status).toBe(200);
    expect(res.body.data.authorizationUrl).toContain("paystack");
    const order = await HostingOrder.findById(res.body.data.orderId);
    expect(order.status).toBe("pending");
    expect(order.provisioningStatus).toBe("not_started");
  });

  it("rejects a non-staff (role 'user') with 403", async () => {
    const { token } = await makeUser("user");
    const res = await request(app).post(URL).set("Authorization", `Bearer ${token}`).send(body());
    expect(res.status).toBe(403);
  });

  it("400 when required fields are missing", async () => {
    const { token } = await makeUser("staff");
    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${token}`)
      .send(body({ planType: undefined, tier: undefined }));
    expect(res.status).toBe(400);
  });
});
