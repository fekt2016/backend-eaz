// Hosting provisioning + lifecycle tests. The WHM (cPanel) service and all
// outbound integrations are mocked — no real WHM/Spaceship/email calls.
jest.mock("../services/whm", () => ({
  hasConfig: jest.fn(() => true),
  generateUsername: jest.fn(() => "testusr"),
  generatePassword: jest.fn(() => "Test!pass123"),
  createAccount: jest.fn(async () => ({ success: true, username: "testusr", password: "Test!pass123" })),
  runAutoSSL: jest.fn(async () => ({ success: true })),
  createSession: jest.fn(async () => ({ success: true, url: "https://cpanel.example/session" })),
  suspendAccount: jest.fn(async () => ({ success: true })),
  unsuspendAccount: jest.fn(async () => ({ success: true })),
  terminateAccount: jest.fn(async () => ({ success: true })),
  changePassword: jest.fn(async () => ({ success: true })),
  getAccountStatus: jest.fn(async () => ({ success: true, suspended: false, domain: "site.com", ip: "1.2.3.4" })),
}));
jest.mock("../utils/hostingEmail", () => ({
  sendHostingCredentials: jest.fn(async () => {}),
  sendOrderConfirmation: jest.fn(async () => {}),
  sendPaymentReceived: jest.fn(async () => {}),
}));
jest.mock("../services/spaceship", () => ({
  registerDomain: jest.fn(async () => ({ success: true })),
  setEazWorldNameservers: jest.fn(async () => ({ success: true })),
  hasConfig: jest.fn(() => false),
  // Pre-marked-up GHS prices, dot-prefixed keys — matches the real getPricing() shape.
  getPricing: jest.fn(async () => ({ ".com": 85, ".net": 75 })),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const app = require("../app");
const whm = require("../services/whm");
const spaceship = require("../services/spaceship");
const HostingOrder = require("../models/HostingOrder");
const User = require("../models/User");
const { provisionHostingAccount } = require("../utils/provisionHosting");
const { getPlanPrice } = require("../config/hostingPlans");

async function makeUser(role = "user") {
  const user = await User.create({
    name: role === "admin" ? "Admin" : "Cust",
    email: `${role}-${Date.now()}@t.com`,
    password: "Password123!",
    role,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

function orderData(user, over = {}) {
  return {
    user: user._id,
    planType: "shared",
    tier: "deluxe",
    billingCycle: "monthly",
    customer: { name: "Cust", email: "cust@t.com" },
    amount: 900,
    paymentMethod: "paystack_card",
    status: "paid",
    ...over,
  };
}

describe("provisionHostingAccount", () => {
  it("provisions a shared plan and activates the order", async () => {
    const { user } = await makeUser();
    const order = await HostingOrder.create(orderData(user));

    await provisionHostingAccount(order);

    const fresh = await HostingOrder.findById(order._id);
    expect(whm.createAccount).toHaveBeenCalledTimes(1);
    expect(fresh.status).toBe("active");
    expect(fresh.provisioningStatus).toBe("provisioned");
    expect(fresh.cpanelUsername).toBe("testusr");
    expect(fresh.expiresAt).toBeTruthy();
  });

  it("is idempotent — a second call does not create a second account", async () => {
    const { user } = await makeUser();
    const order = await HostingOrder.create(orderData(user));

    await provisionHostingAccount(order);
    await provisionHostingAccount(order); // duplicate webhook / retry

    expect(whm.createAccount).toHaveBeenCalledTimes(1);
  });

  it("marks provisioning failed when WHM rejects, without activating", async () => {
    whm.createAccount.mockResolvedValueOnce({ success: false, error: "package does not exist" });
    const { user } = await makeUser();
    const order = await HostingOrder.create(orderData(user));

    await provisionHostingAccount(order);

    const fresh = await HostingOrder.findById(order._id);
    expect(fresh.status).not.toBe("active");
    expect(fresh.provisioningStatus).toBe("failed");
    expect(fresh.provisioningError).toMatch(/package/i);
  });

  it("skips provisioning for non-auto plan types (e.g. vps)", async () => {
    const { user } = await makeUser();
    const order = await HostingOrder.create(orderData(user, { planType: "vps", tier: "starter" }));

    await provisionHostingAccount(order);

    const fresh = await HostingOrder.findById(order._id);
    expect(fresh.provisioningStatus).toBe("skipped");
    expect(whm.createAccount).not.toHaveBeenCalled();
  });
});

describe("hosting lifecycle endpoints", () => {
  it("lets an admin suspend an active service", async () => {
    const { user } = await makeUser();
    const { token: adminToken } = await makeUser("admin");
    const order = await HostingOrder.create(
      orderData(user, { status: "active", cpanelUsername: "testusr" })
    );

    const res = await request(app)
      .post(`/api/v1/hosting/orders/${order._id}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(whm.suspendAccount).toHaveBeenCalledWith("testusr", expect.any(String));
    const fresh = await HostingOrder.findById(order._id);
    expect(fresh.status).toBe("suspended");
    expect(fresh.suspendedAt).toBeTruthy();
  });

  it("forbids a non-admin from suspending", async () => {
    const { user, token } = await makeUser();
    const order = await HostingOrder.create(
      orderData(user, { status: "active", cpanelUsername: "testusr" })
    );

    const res = await request(app)
      .post(`/api/v1/hosting/orders/${order._id}/suspend`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it("requires explicit confirm to terminate", async () => {
    const { user } = await makeUser();
    const { token: adminToken } = await makeUser("admin");
    const order = await HostingOrder.create(
      orderData(user, { status: "active", cpanelUsername: "testusr" })
    );

    const res = await request(app)
      .post(`/api/v1/hosting/orders/${order._id}/terminate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({}); // no confirm

    expect(res.status).toBe(400);
    expect(whm.terminateAccount).not.toHaveBeenCalled();
  });

  it("blocks a non-owner from reading another customer's service status", async () => {
    const { user } = await makeUser();
    const { token: otherToken } = await makeUser(); // different user
    const order = await HostingOrder.create(
      orderData(user, { status: "active", cpanelUsername: "testusr" })
    );

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });
});

describe("superadmin ownership-or-admin parity (T51)", () => {
  it("returns every user's orders, not just its own, from GET /orders", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    await HostingOrder.create(orderData(user));

    const res = await request(app)
      .get("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("lets a superadmin read another customer's order by id", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    const order = await HostingOrder.create(orderData(user));

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}`)
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(res.status).toBe(200);
  });

  it("lets a superadmin read another customer's invoice", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    const order = await HostingOrder.create(orderData(user));

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}/invoice`)
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);
  });

  it("lets a superadmin read another customer's service status", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    const order = await HostingOrder.create(
      orderData(user, { status: "active", cpanelUsername: "testusr" })
    );

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(res.status).toBe(200);
  });

  it("lets a superadmin open another customer's cPanel SSO session", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    const order = await HostingOrder.create(
      orderData(user, { status: "active", cpanelUsername: "testusr" })
    );

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}/cpanel-login`)
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(res.status).toBe(200);
    expect(whm.createSession).toHaveBeenCalledWith("testusr");
  });

  it("lets a superadmin reset another customer's cPanel password", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    const order = await HostingOrder.create(
      orderData(user, { status: "active", cpanelUsername: "testusr" })
    );

    const res = await request(app)
      .post(`/api/v1/hosting/orders/${order._id}/password`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(whm.changePassword).toHaveBeenCalled();
  });
});

describe("POST /api/v1/hosting/orders — invalid plan/tier (T60)", () => {
  it("returns 400, not 500, for an unknown planType", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planType: "bogus",
        tier: "deluxe",
        billingCycle: "monthly",
        customer: { name: "Cust", email: "cust@t.com" },
        paymentMethod: "cash",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400, not 500, for an unknown tier on a known planType", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planType: "shared",
        tier: "bogus-tier",
        billingCycle: "monthly",
        customer: { name: "Cust", email: "cust@t.com" },
        paymentMethod: "cash",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe("POST /api/v1/hosting/orders — domain fee is server-computed, not client-trusted (T54)", () => {
  it("uses the Spaceship price for a known TLD and ignores a client-supplied domainRegistrationFee", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planType: "shared",
        tier: "deluxe",
        billingCycle: "monthly",
        customer: { name: "Cust", email: "cust@t.com" },
        paymentMethod: "cash",
        domainMode: "new",
        domain: "mybusiness.com",
        domainRegistrationFee: 0, // client tries to get the domain for free
        domainRegistrationYears: 1,
      });

    expect(res.status).toBe(200);
    const order = await HostingOrder.findById(res.body.data.orderId);
    expect(order.domainRegistrationFee).toBe(85); // server price for ".com", not the client's 0
  });

  it("multiplies the server price by domainRegistrationYears", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planType: "shared",
        tier: "deluxe",
        billingCycle: "monthly",
        customer: { name: "Cust", email: "cust@t.com" },
        paymentMethod: "cash",
        domainMode: "new",
        domain: "mybusiness.net",
        domainRegistrationYears: 2,
      });

    expect(res.status).toBe(200);
    const order = await HostingOrder.findById(res.body.data.orderId);
    expect(order.domainRegistrationFee).toBe(150); // 75 * 2 years, not USD-rate-multiplied again
  });

  it("falls back to the capped client value for an unknown TLD", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planType: "shared",
        tier: "deluxe",
        billingCycle: "monthly",
        customer: { name: "Cust", email: "cust@t.com" },
        paymentMethod: "cash",
        domainMode: "new",
        domain: "mybusiness.zzz", // not in the mocked pricing map
        domainRegistrationFee: 9999, // above the 500 cap
        domainRegistrationYears: 1,
      });

    expect(res.status).toBe(200);
    const order = await HostingOrder.findById(res.body.data.orderId);
    expect(order.domainRegistrationFee).toBe(500); // capped, not the raw 9999
  });

  it("falls back to the capped client value when Spaceship is unavailable", async () => {
    spaceship.getPricing.mockRejectedValueOnce(new Error("Spaceship down"));
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planType: "shared",
        tier: "deluxe",
        billingCycle: "monthly",
        customer: { name: "Cust", email: "cust@t.com" },
        paymentMethod: "cash",
        domainMode: "new",
        domain: "mybusiness.com",
        domainRegistrationFee: 42,
        domainRegistrationYears: 1,
      });

    expect(res.status).toBe(200);
    const order = await HostingOrder.findById(res.body.data.orderId);
    expect(order.domainRegistrationFee).toBe(42);
  });
});

// T44 follow-up: amount/domainRegistrationFee/addons[].price stay
// intentional major-GHS floats (see the model comment); amountPesewas is a
// new field storing the same value in pesewas, computed once at creation
// instead of re-derived via Math.round(amount * 100) at every webhook
// comparison.
describe("HostingOrder.amountPesewas (T44 follow-up)", () => {
  it("is set to the pesewas equivalent of amount on order creation", async () => {
    const { token } = await makeUser();
    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planType: "shared",
        tier: "deluxe",
        billingCycle: "monthly",
        customer: { name: "Cust", email: "cust@t.com" },
        paymentMethod: "cash",
      });

    expect(res.status).toBe(200);
    const order = await HostingOrder.findById(res.body.data.orderId);
    // Derived from the plan rather than hardcoded: prices are now USD-sourced and
    // converted at read time (T66), so a literal here would rot on any rate change.
    // What this test actually guards is that pesewas === amount × 100.
    const { basePrice } = getPlanPrice("shared", "deluxe", "monthly");
    expect(order.amount).toBe(basePrice);
    expect(order.amountPesewas).toBe(basePrice * 100);
  });

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

  it("webhook decision follows amountPesewas, not a recomputed Math.round(amount*100)", async () => {
    // amount/amountPesewas are deliberately inconsistent here — this is the
    // regression guard: pre-fix code always recomputed 900 from `amount`
    // and would reject this exact payment; post-fix it reads amountPesewas
    // (1234) directly and accepts it.
    const { user } = await makeUser();
    const order = await HostingOrder.create({
      user: user._id,
      planType: "shared",
      tier: "deluxe",
      billingCycle: "monthly",
      customer: { name: "Cust", email: "cust@t.com" },
      amount: 9, // would derive 900 pesewas the old way
      amountPesewas: 1234, // the field the fix should actually use
      paymentMethod: "cash",
      status: "pending",
      paystackReference: `HOST_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });

    const res = await sendWebhook({
      event: "charge.success",
      data: { reference: order.paystackReference, amount: 1234, currency: "GHS" },
    });

    expect(res.status).toBe(200);
    const fresh = await HostingOrder.findById(order._id);
    // The webhook marks the order paid and then provisioning moves it on to
    // "active", so either is a pass. What this asserts is that the payment was
    // ACCEPTED — a mismatch would have left the order sitting at "pending".
    expect(["paid", "active"]).toContain(fresh.status);
  });

  it("webhook rejects a payment that doesn't match amountPesewas", async () => {
    const { user } = await makeUser();
    const order = await HostingOrder.create({
      user: user._id,
      planType: "shared",
      tier: "deluxe",
      billingCycle: "monthly",
      customer: { name: "Cust", email: "cust@t.com" },
      amount: 9,
      amountPesewas: 900,
      paymentMethod: "cash",
      status: "pending",
      paystackReference: `HOST_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });

    const res = await sendWebhook({
      event: "charge.success",
      data: { reference: order.paystackReference, amount: 100, currency: "GHS" },
    });

    expect(res.status).toBe(400);
    const fresh = await HostingOrder.findById(order._id);
    expect(fresh.status).toBe("pending");
  });

  it("falls back to deriving pesewas from `amount` for a legacy order with no amountPesewas field", async () => {
    const { user } = await makeUser();
    // Simulates a document created before this follow-up shipped.
    const order = await HostingOrder.create({
      user: user._id,
      planType: "shared",
      tier: "deluxe",
      billingCycle: "monthly",
      customer: { name: "Cust", email: "cust@t.com" },
      amount: 9,
      // amountPesewas intentionally omitted — defaults to null.
      paymentMethod: "cash",
      status: "pending",
      paystackReference: `HOST_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
    expect(order.amountPesewas).toBeNull();

    const res = await sendWebhook({
      event: "charge.success",
      data: { reference: order.paystackReference, amount: 900, currency: "GHS" },
    });

    expect(res.status).toBe(200);
    const fresh = await HostingOrder.findById(order._id);
    // The webhook marks the order paid and then provisioning moves it on to
    // "active", so either is a pass. What this asserts is that the payment was
    // ACCEPTED — a mismatch would have left the order sitting at "pending".
    expect(["paid", "active"]).toContain(fresh.status);
  });
});
