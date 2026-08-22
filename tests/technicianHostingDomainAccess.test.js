// T21: technicians must have ZERO access to hosting/domain endpoints. These
// routes are only gated by `protect` (any logged-in role) plus ownership
// checks in the controller — a technician has no orders of their own, but
// nothing stopped them from hitting the route itself. `denyRoles('technician')`
// (middleware/auth.js) now short-circuits before the controller runs.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const HostingOrder = require("../models/HostingOrder");
const DomainOrder = require("../models/DomainOrder");

async function makeUser(role = "user") {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

function hostingOrderData(user, over = {}) {
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

function domainOrderData(user, over = {}) {
  return {
    user: user._id,
    domain: "example.com",
    tld: ".com",
    price: 8500,
    email: "cust@t.com",
    customerName: "Cust",
    ...over,
  };
}

describe("T21 — technician has zero access to hosting endpoints", () => {
  it("403s POST /hosting/orders", async () => {
    const { token } = await makeUser("technician");
    const res = await request(app)
      .post("/api/v1/hosting/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ planType: "shared", tier: "deluxe", billingCycle: "monthly", customer: { name: "x", email: "x@t.com" }, paymentMethod: "cash" });
    expect(res.status).toBe(403);
  });

  it("403s GET /hosting/orders", async () => {
    const { token } = await makeUser("technician");
    const res = await request(app).get("/api/v1/hosting/orders").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s GET /hosting/orders/by-reference/:reference", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    await HostingOrder.create(hostingOrderData(user, { paystackReference: "HOST_REF_1" }));

    const res = await request(app)
      .get("/api/v1/hosting/orders/by-reference/HOST_REF_1")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s GET /hosting/orders/:id/invoice", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await HostingOrder.create(hostingOrderData(user));

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}/invoice`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s GET /hosting/orders/:id/cpanel-login", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await HostingOrder.create(hostingOrderData(user, { status: "active", cpanelUsername: "testusr" }));

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}/cpanel-login`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s GET /hosting/orders/:id/status", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await HostingOrder.create(hostingOrderData(user, { status: "active", cpanelUsername: "testusr" }));

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s GET /hosting/orders/:id", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await HostingOrder.create(hostingOrderData(user));

    const res = await request(app)
      .get(`/api/v1/hosting/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s POST /hosting/orders/:id/proof", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await HostingOrder.create(hostingOrderData(user));

    const res = await request(app)
      .post(`/api/v1/hosting/orders/${order._id}/proof`)
      .set("Authorization", `Bearer ${token}`)
      .attach("proof", Buffer.from("fake"), "proof.png");
    expect(res.status).toBe(403);
  });

  it("403s POST /hosting/orders/:id/renew", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await HostingOrder.create(hostingOrderData(user, { status: "active" }));

    const res = await request(app)
      .post(`/api/v1/hosting/orders/${order._id}/renew`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("403s POST /hosting/orders/:id/password", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await HostingOrder.create(hostingOrderData(user, { status: "active", cpanelUsername: "testusr" }));

    const res = await request(app)
      .post(`/api/v1/hosting/orders/${order._id}/password`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe("T21 — technician has zero access to domain endpoints", () => {
  it("403s POST /domain/payment", async () => {
    const { token } = await makeUser("technician");
    const res = await request(app)
      .post("/api/v1/domain/payment")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("403s GET /domain/my", async () => {
    const { token } = await makeUser("technician");
    const res = await request(app).get("/api/v1/domain/my").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s GET /domain/orders", async () => {
    const { token } = await makeUser("technician");
    const res = await request(app).get("/api/v1/domain/orders").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403s GET /domain/orders/:id", async () => {
    const { user } = await makeUser();
    const { token } = await makeUser("technician");
    const order = await DomainOrder.create(domainOrderData(user));

    const res = await request(app)
      .get(`/api/v1/domain/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("T21 — regression: a regular customer still has normal access", () => {
  it("a plain 'user' still gets 200 from GET /hosting/orders (not caught by the technician-only guard)", async () => {
    const { token } = await makeUser("user");
    const res = await request(app).get("/api/v1/hosting/orders").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("a plain 'user' still gets 200 from GET /domain/my (not caught by the technician-only guard)", async () => {
    const { token } = await makeUser("user");
    const res = await request(app).get("/api/v1/domain/my").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
