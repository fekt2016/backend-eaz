// Service orders (T59): status must be validated against ServiceOrder's enum and
// only move forward (no backward moves, no changes out of a terminal state), and
// list pagination must be clamped like every other admin list endpoint.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const ServiceOrder = require("../models/ServiceOrder");

async function makeUser(role = "admin") {
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

function orderData(over = {}) {
  return {
    name: "Cust",
    email: "cust@t.com",
    service: "Web Design",
    package: "Landing Page",
    depositAmount: 400,
    totalAmount: 800,
    status: "pending",
    ...over,
  };
}

describe("PATCH /api/v1/services/orders/:id — status validation (T59)", () => {
  it("rejects a status not in the ServiceOrder enum", async () => {
    const { token } = await makeUser();
    const order = await ServiceOrder.create(orderData());

    const res = await request(app)
      .patch(`/api/v1/services/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "bogus" });

    expect(res.status).toBe(400);
    const fresh = await ServiceOrder.findById(order._id);
    expect(fresh.status).toBe("pending"); // unchanged
  });

  it("rejects a backward move (paid -> pending)", async () => {
    const { token } = await makeUser();
    const order = await ServiceOrder.create(orderData({ status: "paid" }));

    const res = await request(app)
      .patch(`/api/v1/services/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending" });

    expect(res.status).toBe(400);
    const fresh = await ServiceOrder.findById(order._id);
    expect(fresh.status).toBe("paid");
  });

  it("rejects moving out of a terminal state (completed -> in_progress)", async () => {
    const { token } = await makeUser();
    const order = await ServiceOrder.create(orderData({ status: "completed" }));

    const res = await request(app)
      .patch(`/api/v1/services/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress" });

    expect(res.status).toBe(400);
  });

  it("rejects reviving a cancelled order", async () => {
    const { token } = await makeUser();
    const order = await ServiceOrder.create(orderData({ status: "cancelled" }));

    const res = await request(app)
      .patch(`/api/v1/services/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });

    expect(res.status).toBe(400);
  });

  it("allows a forward move (pending -> paid -> in_progress -> completed)", async () => {
    const { token } = await makeUser();
    const order = await ServiceOrder.create(orderData({ status: "pending" }));

    for (const next of ["paid", "in_progress", "completed"]) {
      const res = await request(app)
        .patch(`/api/v1/services/orders/${order._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: next });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(next);
    }
  });

  it("allows cancelling a live order", async () => {
    const { token } = await makeUser();
    const order = await ServiceOrder.create(orderData({ status: "paid" }));

    const res = await request(app)
      .patch(`/api/v1/services/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });

  it("still allows updating adminNote without touching status", async () => {
    const { token } = await makeUser();
    const order = await ServiceOrder.create(orderData({ status: "paid" }));

    const res = await request(app)
      .patch(`/api/v1/services/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ adminNote: "Called customer to confirm scope." });

    expect(res.status).toBe(200);
    expect(res.body.data.adminNote).toBe("Called customer to confirm scope.");
    expect(res.body.data.status).toBe("paid");
  });
});

describe("GET /api/v1/services/orders — pagination clamping (T59)", () => {
  it("clamps an oversized limit and ignores an invalid status filter", async () => {
    const { token } = await makeUser();
    await ServiceOrder.create(orderData({ email: "a@t.com" }));
    await ServiceOrder.create(orderData({ email: "b@t.com" }));

    const res = await request(app)
      .get("/api/v1/services/orders?limit=100000&page=-5&status=not-a-real-status")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // invalid status filter ignored, not errored
    expect(res.body.data.length).toBe(2); // limit clamped well under 100000
  });
});
