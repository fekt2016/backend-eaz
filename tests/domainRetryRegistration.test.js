// Admin "retry domain registration" — re-attempt Spaceship registration for a
// PAID order whose registration failed. Spaceship is mocked (no real calls).
jest.mock("../services/spaceship", () => ({
  registerDomain: jest.fn(async () => ({ success: true })),
  setEazWorldNameservers: jest.fn(async () => ({ success: true })),
  hasConfig: jest.fn(() => true),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const spaceship = require("../services/spaceship");
const DomainOrder = require("../models/DomainOrder");
const User = require("../models/User");

async function makeUser(role = "user") {
  const user = await User.create({
    name: role === "admin" ? "Admin" : "Cust",
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@t.com`,
    password: "Password123!",
    role,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

async function makeFailedOrder(user, over = {}) {
  return DomainOrder.create({
    user: user._id,
    domain: "example-gh.com",
    tld: ".com",
    customerName: "Kofi Mensah",
    email: "cust@t.com",
    price: 120,
    years: 1,
    status: "completed",
    registrationError: "Spaceship timeout",
    registrantInfo: { firstName: "Kofi", lastName: "Mensah", country: "GH" },
    paystackReference: `ref_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    paidAt: new Date(),
    ...over,
  });
}

const url = (id) => `/api/v1/domain/orders/${id}/retry-registration`;

describe("POST /api/v1/domain/orders/:id/retry-registration", () => {
  it("registers a paid failed order, clears the error, and links it to the buyer", async () => {
    spaceship.registerDomain.mockResolvedValueOnce({ success: true });
    const { token: adminToken } = await makeUser("admin");
    const { user } = await makeUser();
    const order = await makeFailedOrder(user);

    const res = await request(app)
      .post(url(order._id))
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(spaceship.registerDomain).toHaveBeenCalledTimes(1);

    const updated = await DomainOrder.findById(order._id);
    expect(updated.registrationError).toBeNull();

    const owner = await User.findById(user._id);
    expect(owner.domains.some((d) => d.domain === "example-gh.com")).toBe(true);
  });

  it("returns 502 and keeps the error when Spaceship still fails", async () => {
    spaceship.registerDomain.mockResolvedValueOnce({ success: false, error: "Domain taken" });
    const { token: adminToken } = await makeUser("admin");
    const { user } = await makeUser();
    const order = await makeFailedOrder(user);

    const res = await request(app)
      .post(url(order._id))
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(502);
    const updated = await DomainOrder.findById(order._id);
    expect(updated.registrationError).toBe("Domain taken");
  });

  it("rejects a non-admin with 403", async () => {
    const { token } = await makeUser();
    const { user } = await makeUser();
    const order = await makeFailedOrder(user);

    const res = await request(app)
      .post(url(order._id))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("rejects an unpaid (pending) order with 400 and never calls Spaceship", async () => {
    const { token: adminToken } = await makeUser("admin");
    const { user } = await makeUser();
    const order = await makeFailedOrder(user, { status: "pending", registrationError: null });

    const res = await request(app)
      .post(url(order._id))
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(spaceship.registerDomain).not.toHaveBeenCalled();
  });
});
