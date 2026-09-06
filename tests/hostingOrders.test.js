// controllers/hostingOrderController.js is 1,197 lines and had no test file,
// while carrying the money and the access rules for hosting: what a customer can
// be charged, whose order they may read, and which status transitions are legal.
//
// These tests pin the guarantees a refactor must not lose:
//   · price and totals are computed server-side, never read from the request
//   · only plans the shop can actually deliver may be bought online
//   · one customer cannot read, invoice or renew another customer's order
//   · an active order cannot be walked backwards into re-provisioning
//   · renewal reprices from the plan, and cannot be aimed at someone else's order
jest.mock("@paystack/paystack-sdk", () => {
  class Paystack {
    get transaction() {
      return {
        initialize: jest.fn(async ({ amount, reference, email }) => ({
          status: true,
          data: { authorization_url: "https://pay.example/c", access_code: "acc", reference, amount, email },
        })),
      };
    }
  }
  return Paystack;
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const HostingOrder = require("../models/HostingOrder");
const { getPlanPrice, PLAN_AVAILABILITY } = require("../config/hostingPlans");

const BASE = "/api/v1/hosting";

async function makeUser(role = "user") {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

const customer = { name: "Ama", email: "ama@example.com", phone: "0244000000" };

const order = (token, body) =>
  request(app).post(`${BASE}/orders`).set("Authorization", `Bearer ${token}`).send({
    planType: "shared", tier: "deluxe", billingCycle: "monthly",
    customer, paymentMethod: "bank_transfer", ...body,
  });

async function makeOrder(user, over = {}) {
  const { total } = getPlanPrice("shared", "deluxe", "monthly");
  return HostingOrder.create({
    user: user._id,
    planType: "shared", tier: "deluxe", billingCycle: "monthly",
    customer,
    amount: total, amountPesewas: Math.round(total * 100),
    paymentMethod: "bank_transfer",
    ...over,
  });
}

describe("POST /hosting/orders — what a customer may buy, and for how much", () => {
  it("prices the order from the plan table, not from the request", async () => {
    // The single most valuable guarantee here: a crafted request must not be
    // able to name its own price for a real hosting account.
    const { token } = await makeUser();
    const { total } = getPlanPrice("shared", "deluxe", "monthly");

    const res = await order(token, { amount: 1, amountPesewas: 1, total: 1 });

    expect(res.status).toBe(200);
    // The endpoint answers with an id and nothing else, so the price it charged
    // is read from the stored order.
    const stored = await HostingOrder.findById(res.body.data.orderId);
    expect(stored.amount).toBe(total);
    expect(stored.amount).not.toBe(1);
    expect(stored.amountPesewas).not.toBe(1);
  });

  it("stores the pesewas figure alongside the major-unit amount", async () => {
    // The webhook compares against amountPesewas rather than re-deriving it
    // with float arithmetic at every comparison.
    const { token } = await makeUser();
    const { total } = getPlanPrice("shared", "deluxe", "monthly");

    const res = await order(token);

    const stored = await HostingOrder.findById(res.body.data.orderId);
    expect(stored.amountPesewas).toBe(Math.round(total * 100));
    expect(Number.isInteger(stored.amountPesewas)).toBe(true);
  });

  it("refuses a plan the shop cannot actually deliver", async () => {
    // `cloud` and `email` have no supplier and no API behind them. The
    // storefront never linked to them, but the endpoint accepted them — so a
    // stale client could pay for a server nobody could build.
    const { token } = await makeUser();

    for (const planType of ["cloud", "email"]) {
      expect(PLAN_AVAILABILITY[planType]).toBe("unavailable");
      const res = await order(token, { planType, tier: "deluxe" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not available for online purchase/i);
    }
    expect(await HostingOrder.countDocuments({})).toBe(0);
  });

  it("points a quote-only plan at the enquiry route instead of taking money", async () => {
    const { token } = await makeUser();
    expect(PLAN_AVAILABILITY.vps).toBe("enquiry");

    const res = await order(token, { planType: "vps", tier: "deluxe" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quoted individually/i);
  });

  it("refuses an unknown tier rather than charging nothing", async () => {
    const { token } = await makeUser();
    const res = await order(token, { tier: "no-such-tier" });
    expect(res.status).toBe(400);
    expect(await HostingOrder.countDocuments({})).toBe(0);
  });

  it("requires the fields an invoice cannot be written without", async () => {
    const { token } = await makeUser();

    expect((await order(token, { planType: undefined })).status).toBe(400);
    expect((await order(token, { billingCycle: undefined })).status).toBe(400);
    expect((await order(token, { customer: { email: "a@b.com" } })).status).toBe(400);
    expect((await order(token, { customer: { name: "Ama" } })).status).toBe(400);
  });

  it("needs a logged-in customer", async () => {
    const res = await request(app).post(`${BASE}/orders`).send({
      planType: "shared", tier: "deluxe", billingCycle: "monthly",
      customer, paymentMethod: "bank_transfer",
    });
    expect(res.status).toBe(401);
  });

  it("is closed to technicians", async () => {
    const { token } = await makeUser("technician");
    const res = await order(token);
    expect(res.status).toBe(403);
  });
});

describe("GET /hosting/orders/:id — whose order a customer may read", () => {
  it("lets the owner read their own", async () => {
    const { user, token } = await makeUser();
    const o = await makeOrder(user);

    const res = await request(app).get(`${BASE}/orders/${o._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(String(o._id));
  });

  it("refuses another customer — the order carries their name and address", async () => {
    const { user: owner } = await makeUser();
    const { token: stranger } = await makeUser();
    const o = await makeOrder(owner);

    const res = await request(app).get(`${BASE}/orders/${o._id}`)
      .set("Authorization", `Bearer ${stranger}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/ama@example.com/i);
  });

  it("lets an admin read any order", async () => {
    const { user: owner } = await makeUser();
    const { token: admin } = await makeUser("admin");
    const o = await makeOrder(owner);

    const res = await request(app).get(`${BASE}/orders/${o._id}`)
      .set("Authorization", `Bearer ${admin}`);

    expect(res.status).toBe(200);
  });

  it("applies the same rule to the invoice", async () => {
    // An invoice is the same customer data in a downloadable form.
    const { user: owner } = await makeUser();
    const { token: stranger } = await makeUser();
    const o = await makeOrder(owner);

    const res = await request(app).get(`${BASE}/orders/${o._id}/invoice`)
      .set("Authorization", `Bearer ${stranger}`);

    expect(res.status).toBe(403);
  });

  it("404s for an order that does not exist", async () => {
    const { token } = await makeUser();
    const res = await request(app).get(`${BASE}/orders/6a9d000000000000000000aa`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /hosting/orders/:id — the admin status transition", () => {
  const patch = (id, token, body) =>
    request(app).patch(`${BASE}/orders/${id}`).set("Authorization", `Bearer ${token}`).send(body);

  it("marks an order paid and queues provisioning", async () => {
    const { user } = await makeUser();
    const { token: admin } = await makeUser("admin");
    const o = await makeOrder(user);

    const res = await patch(o._id, admin, { status: "paid" });

    expect(res.status).toBe(200);
    const fresh = await HostingOrder.findById(o._id);
    expect(fresh.status).toBe("paid");
    expect(fresh.paidAt).toBeTruthy();
    expect(fresh.provisioningStatus).toBe("pending");
  });

  it("stamps bank-transfer verification when that is how it was paid", async () => {
    const { user } = await makeUser();
    const { token: admin } = await makeUser("admin");
    const o = await makeOrder(user, { paymentMethod: "bank_transfer" });

    await patch(o._id, admin, { status: "paid" });

    expect((await HostingOrder.findById(o._id)).bankTransferVerifiedAt).toBeTruthy();
  });

  it("will not walk an ACTIVE order back into re-provisioning", async () => {
    // An active order is a live cPanel account. Sending it back to paid would
    // re-queue provisioning against an account that already exists.
    const { user } = await makeUser();
    const { token: admin } = await makeUser("admin");
    const o = await makeOrder(user, { status: "active", provisioningStatus: "provisioned" });

    const res = await patch(o._id, admin, { status: "paid" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only be moved to cancelled or failed/i);
    expect((await HostingOrder.findById(o._id)).status).toBe("active");
  });

  it("still lets an active order be cancelled or failed", async () => {
    const { user } = await makeUser();
    const { token: admin } = await makeUser("admin");
    const o = await makeOrder(user, { status: "active" });

    const res = await patch(o._id, admin, { status: "cancelled" });

    expect(res.status).toBe(200);
    expect((await HostingOrder.findById(o._id)).status).toBe("cancelled");
  });

  it("refuses a status outside the allowed set", async () => {
    const { user } = await makeUser();
    const { token: admin } = await makeUser("admin");
    const o = await makeOrder(user);

    expect((await patch(o._id, admin, { status: "provisioned" })).status).toBe(400);
    expect((await patch(o._id, admin, {})).status).toBe(400);
    expect((await HostingOrder.findById(o._id)).status).toBe("pending");
  });

  it("does not re-stamp paidAt when an order is set paid twice", async () => {
    const { user } = await makeUser();
    const { token: admin } = await makeUser("admin");
    const o = await makeOrder(user);

    await patch(o._id, admin, { status: "paid" });
    const first = (await HostingOrder.findById(o._id)).paidAt;
    await patch(o._id, admin, { status: "paid" });

    expect((await HostingOrder.findById(o._id)).paidAt.getTime()).toBe(first.getTime());
  });

  it("is closed to the customer who owns the order", async () => {
    // Marking your own order paid is marking your own homework.
    const { user, token } = await makeUser();
    const o = await makeOrder(user);

    const res = await patch(o._id, token, { status: "paid" });

    expect(res.status).toBe(403);
    expect((await HostingOrder.findById(o._id)).status).toBe("pending");
  });
});

describe("POST /hosting/orders/:id/renew — repricing a renewal", () => {
  const renew = (id, token, body = { paymentMethod: "bank_transfer" }) =>
    request(app).post(`${BASE}/orders/${id}/renew`).set("Authorization", `Bearer ${token}`).send(body);

  it("prices the renewal from the plan, not from the original order", async () => {
    // The original may have been bought at a price that has since changed, or
    // carried a one-off domain fee. A renewal is the plan alone, at today's price.
    const { user, token } = await makeUser();
    const { total } = getPlanPrice("shared", "deluxe", "monthly");
    const o = await makeOrder(user, { status: "active", amount: 1, amountPesewas: 100 });

    const res = await renew(o._id, token);

    expect(res.status).toBe(200);
    const renewal = await HostingOrder.findOne({ parentOrderId: o._id });
    expect(renewal.amount).toBe(total);
    expect(renewal.amountPesewas).toBe(Math.round(total * 100));
  });

  it("carries no domain fee — the domain is already registered", async () => {
    const { user, token } = await makeUser();
    const o = await makeOrder(user, { status: "active", domain: "example.com", domainMode: "new" });

    await renew(o._id, token);

    const renewal = await HostingOrder.findOne({ parentOrderId: o._id });
    expect(renewal.domainMode).toBe("skip");
    expect(renewal.domain).toBe("example.com");
  });

  it("refuses to renew somebody else's order", async () => {
    const { user: owner } = await makeUser();
    const { token: stranger } = await makeUser();
    const o = await makeOrder(owner, { status: "active" });

    const res = await renew(o._id, stranger);

    expect(res.status).toBe(403);
    expect(await HostingOrder.countDocuments({ parentOrderId: o._id })).toBe(0);
  });

  it("refuses to renew an order that was never live", async () => {
    const { user, token } = await makeUser();
    const o = await makeOrder(user, { status: "pending" });

    const res = await renew(o._id, token);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/active or expired/i);
  });

  it("requires a payment method", async () => {
    const { user, token } = await makeUser();
    const o = await makeOrder(user, { status: "active" });

    const res = await renew(o._id, token, {});

    expect(res.status).toBe(400);
    expect(await HostingOrder.countDocuments({ parentOrderId: o._id })).toBe(0);
  });

  it("starts the renewal unpaid and unprovisioned", async () => {
    const { user, token } = await makeUser();
    const o = await makeOrder(user, { status: "active" });

    await renew(o._id, token);

    const renewal = await HostingOrder.findOne({ parentOrderId: o._id });
    expect(renewal.status).toBe("pending");
    expect(renewal.provisioningStatus).toBe("not_started");
  });
});
