// Hosting provisioning + lifecycle tests. The WHM (cPanel) service and all
// outbound integrations are mocked — no real WHM/Namecheap/email calls.
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
jest.mock("../services/namecheap", () => ({
  registerDomain: jest.fn(async () => ({ success: true })),
  setEazWorldNameservers: jest.fn(async () => ({ success: true })),
  hasConfig: jest.fn(() => false),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const whm = require("../services/whm");
const HostingOrder = require("../models/HostingOrder");
const User = require("../models/User");
const { provisionHostingAccount } = require("../utils/provisionHosting");

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
