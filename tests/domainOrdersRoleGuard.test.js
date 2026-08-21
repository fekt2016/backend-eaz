// GET /api/v1/domain/orders and /orders/:id (T51): these controller-level
// `req.user.role === 'admin'` checks excluded superadmin, so a superadmin passed
// `protect` but was then treated as a regular customer — filtered to only their
// own orders, and 403'd on anyone else's.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
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

function orderData(user, over = {}) {
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

describe("domain orders — superadmin ownership-or-admin parity (T51)", () => {
  it("returns every user's orders, not just its own, from GET /orders", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    await DomainOrder.create(orderData(user));

    const res = await request(app)
      .get("/api/v1/domain/orders")
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it("a regular user's list is still filtered to their own orders", async () => {
    const { user, token } = await makeUser();
    const { user: otherUser } = await makeUser();
    await DomainOrder.create(orderData(user));
    await DomainOrder.create(orderData(otherUser));

    const res = await request(app)
      .get("/api/v1/domain/orders")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((o) => o.user === user._id.toString())).toBe(true);
  });

  it("lets a superadmin read another customer's domain order by id", async () => {
    const { user } = await makeUser();
    const { token: superadminToken } = await makeUser("superadmin");
    const order = await DomainOrder.create(orderData(user));

    const res = await request(app)
      .get(`/api/v1/domain/orders/${order._id}`)
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(res.status).toBe(200);
  });

  it("still blocks a non-owner, non-admin user from reading another customer's order", async () => {
    const { user } = await makeUser();
    const { token: otherToken } = await makeUser();
    const order = await DomainOrder.create(orderData(user));

    const res = await request(app)
      .get(`/api/v1/domain/orders/${order._id}`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });
});
