// T68 — the manual provisioning queue. VPS / Cloud / Email orders are paid but
// auto-provisioning skips them (Starlight VMs have no API), so staff build them
// by hand: a queue to work from, and the moment they mark one done.
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
const whm = require("../services/whm");
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
const { sendHostingCredentials } = require("../utils/hostingEmail");

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

// A paid VPS order that auto-provisioning skipped — the exact stuck state T68 chases.
async function makeSkippedOrder(over = {}) {
  const owner = await User.create({
    name: "Buyer",
    email: `buyer-${Date.now()}-${Math.random().toString(36).slice(2)}@t.com`,
    password: "Password123!",
    role: "user",
  });
  return HostingOrder.create({
    user: owner._id,
    planType: "vps",
    tier: "pro",
    billingCycle: "monthly",
    amount: 950,
    customer: { name: "Kofi Mensah", email: "kofi@example.com", phone: "0201234567" },
    status: "paid",
    paidAt: new Date(),
    paymentMethod: "paystack_card",
    provisioningStatus: "skipped",
    ...over,
  });
}

const QUEUE_URL = "/api/v1/hosting/orders/awaiting-provisioning";
const markBody = (over = {}) => ({ username: "kofivps", password: "Built-By-Hand-1", ...over });

describe("GET /api/v1/hosting/orders/awaiting-provisioning", () => {
  it("lists paid skipped orders oldest-first with their customer and plan", async () => {
    const { token } = await makeUser("staff");
    const older = await makeSkippedOrder({ createdAt: new Date(Date.now() - 86400000) });
    const newer = await makeSkippedOrder({});

    const res = await request(app).get(QUEUE_URL).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.data.map((o) => o._id)).toEqual([older._id.toString(), newer._id.toString()]);
    expect(res.body.data[0].planType).toBe("vps");
    expect(res.body.data[0].customer.email).toBe("kofi@example.com");
  });

  // A paid order whose automatic WHM build errored used to be counted by
  // getAdminOverview and listed nowhere — an admin saw a number with no row to
  // act on, so the customer waited unseen. Operationally 'failed' and 'skipped'
  // mean the same thing: money landed, no server exists.
  it("lists paid orders whose automatic build FAILED, with the reason", async () => {
    const { token } = await makeUser("admin");
    await makeSkippedOrder({
      planType: "shared",
      tier: "deluxe",
      provisioningStatus: "failed",
      provisioningError: "WHM package root_eazworld_shared_deluxe does not exist",
    });

    const res = await request(app).get(QUEUE_URL).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].provisioningStatus).toBe("failed");
    // The reason has to survive to the client — it is what tells staff whether
    // this is a one-off or a misconfiguration that will hit the next order too.
    expect(res.body.data[0].provisioningError).toMatch(/does not exist/);
  });

  it("interleaves failed and skipped orders oldest-first, not grouped by status", async () => {
    const { token } = await makeUser("admin");
    const oldestFailed = await makeSkippedOrder({
      provisioningStatus: "failed",
      provisioningError: "WHM unreachable",
      createdAt: new Date(Date.now() - 172800000),
    });
    const middleSkipped = await makeSkippedOrder({ createdAt: new Date(Date.now() - 86400000) });
    const newestFailed = await makeSkippedOrder({
      provisioningStatus: "failed",
      provisioningError: "WHM unreachable",
    });

    const res = await request(app).get(QUEUE_URL).set("Authorization", `Bearer ${token}`);

    expect(res.body.data.map((o) => o._id)).toEqual([
      oldestFailed._id.toString(),
      middleSkipped._id.toString(),
      newestFailed._id.toString(),
    ]);
  });

  it("excludes unpaid, already-active and auto-provisioned orders", async () => {
    const { token } = await makeUser("admin");
    await makeSkippedOrder({ status: "pending" }); // not paid yet
    await makeSkippedOrder({ status: "active", provisioningStatus: "provisioned" }); // done
    await makeSkippedOrder({ planType: "shared", provisioningStatus: "pending" }); // auto path

    const res = await request(app).get(QUEUE_URL).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it("with no WHM configured, a paid shared order lands in the queue (T64 deferral)", async () => {
    // The cPanel licence is deferred, so shared/wordpress must become manual
    // builds too — visible in the queue, not lost in 'failed'.
    whm.hasConfig.mockReturnValue(false);
    const owner = await User.create({
      name: "Buyer",
      email: `buyer-${Date.now()}-${Math.random().toString(36).slice(2)}@t.com`,
      password: "Password123!",
      role: "user",
    });
    const order = await HostingOrder.create({
      user: owner._id,
      planType: "shared",
      tier: "deluxe",
      billingCycle: "monthly",
      amount: 62,
      customer: { name: "Ama Owusu", email: "ama@example.com" },
      status: "pending",
      paymentMethod: "bank_transfer",
    });
    const { token } = await makeUser("admin");

    await request(app)
      .patch(`/api/v1/hosting/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });
    await new Promise((r) => setTimeout(r, 30)); // provisioning runs fire-and-forget

    const res = await request(app).get(QUEUE_URL).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0]._id).toBe(order._id.toString());
    expect(res.body.data[0].provisioningStatus).toBe("skipped");
  });

  it("refuses a customer with 403", async () => {
    const { token } = await makeUser("user");
    const res = await request(app).get(QUEUE_URL).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/hosting/orders/:id/mark-provisioned", () => {
  it("activates the order, stamps expiry by billing cycle and emails credentials", async () => {
    const { token } = await makeUser("staff");
    const order = await makeSkippedOrder({ billingCycle: "annual" });

    const res = await request(app)
      .patch(`/api/v1/hosting/orders/${order._id}/mark-provisioned`)
      .set("Authorization", `Bearer ${token}`)
      .send(markBody());

    expect(res.status).toBe(200);
    expect(res.body.meta.alreadyProvisioned).toBe(false);

    const saved = await HostingOrder.findById(order._id);
    expect(saved.status).toBe("active");
    expect(saved.provisioningStatus).toBe("provisioned");
    expect(saved.cpanelUsername).toBe("kofivps");
    expect(saved.expiresAt).toBeTruthy();
    const months =
      (saved.expiresAt.getFullYear() - new Date().getFullYear()) * 12 +
      (saved.expiresAt.getMonth() - new Date().getMonth());
    expect(months).toBe(12); // annual

    expect(sendHostingCredentials).toHaveBeenCalledTimes(1);
    expect(sendHostingCredentials.mock.calls[0][1].username).toBe("kofivps");
    expect(sendHostingCredentials.mock.calls[0][1].password).toBe("Built-By-Hand-1");
  });

  it("falls back to a temp domain when none is given", async () => {
    const { token } = await makeUser("staff");
    const order = await makeSkippedOrder();

    await request(app)
      .patch(`/api/v1/hosting/orders/${order._id}/mark-provisioned`)
      .set("Authorization", `Bearer ${token}`)
      .send(markBody());

    expect(sendHostingCredentials.mock.calls[0][1].domain).toBe("kofivps.eazworld.com");
  });

  it("uses the customer's domain when provided", async () => {
    const { token } = await makeUser("staff");
    const order = await makeSkippedOrder();

    await request(app)
      .patch(`/api/v1/hosting/orders/${order._id}/mark-provisioned`)
      .set("Authorization", `Bearer ${token}`)
      .send(markBody({ domain: "KofiSite.COM" }));

    expect(sendHostingCredentials.mock.calls[0][1].domain).toBe("kofisite.com");
  });

  it("is idempotent: marking twice does not re-email", async () => {
    const { token } = await makeUser("staff");
    const order = await makeSkippedOrder();
    const url = `/api/v1/hosting/orders/${order._id}/mark-provisioned`;
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).patch(url).set(auth).send(markBody());
    const res = await request(app).patch(url).set(auth).send(markBody());

    expect(res.status).toBe(200);
    expect(res.body.meta.alreadyProvisioned).toBe(true);
    expect(sendHostingCredentials).toHaveBeenCalledTimes(1);
  });

  it("refuses an unpaid order — nothing is built before the money lands", async () => {
    const { token } = await makeUser("staff");
    const order = await makeSkippedOrder({ status: "pending" });

    const res = await request(app)
      .patch(`/api/v1/hosting/orders/${order._id}/mark-provisioned`)
      .set("Authorization", `Bearer ${token}`)
      .send(markBody());

    expect(res.status).toBe(400);
    const saved = await HostingOrder.findById(order._id);
    expect(saved.status).toBe("pending");
  });

  it.each([
    ["no username", { password: "Built-By-Hand-1" }],
    ["short username", { username: "ab", password: "Built-By-Hand-1" }],
    ["no password", { username: "kofivps" }],
    ["short password", { username: "kofivps", password: "short" }],
  ])("validates credentials: %s", async (_name, body) => {
    const { token } = await makeUser("staff");
    const order = await makeSkippedOrder();

    const res = await request(app)
      .patch(`/api/v1/hosting/orders/${order._id}/mark-provisioned`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(sendHostingCredentials).not.toHaveBeenCalled();
  });

  it("404s for an unknown order", async () => {
    const { token } = await makeUser("staff");
    const res = await request(app)
      .patch("/api/v1/hosting/orders/000000000000000000000000/mark-provisioned")
      .set("Authorization", `Bearer ${token}`)
      .send(markBody());
    expect(res.status).toBe(404);
  });

  it("refuses a customer with 403", async () => {
    const { token } = await makeUser("user");
    const order = await makeSkippedOrder();
    const res = await request(app)
      .patch(`/api/v1/hosting/orders/${order._id}/mark-provisioned`)
      .set("Authorization", `Bearer ${token}`)
      .send(markBody());
    expect(res.status).toBe(403);
  });
});
