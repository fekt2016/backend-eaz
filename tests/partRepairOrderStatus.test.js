// PartOrder/RepairOrder status updates (T58): only `pending` may move — to `paid`
// or `cancelled`. Once `paid` or `cancelled` the order is terminal (no un-paying,
// no cancelling a paid order).
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");
const PartOrder = require("../models/PartOrder");
const RepairOrder = require("../models/RepairOrder");

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

async function makeJob() {
  const customer = await PosCustomer.create({ phone: "0244000000", name: "C" });
  return RepairJob.create({ customer: customer._id, faultDescription: "Cracked screen" });
}

function partOrderData(job, over = {}) {
  return {
    job: job._id,
    partName: "Battery",
    quantity: 1,
    unitPricePesewas: 5000,
    subtotalPesewas: 5000,
    amountPesewas: 5000,
    customerPhone: "0244000000",
    status: "pending",
    ...over,
  };
}

function repairOrderData(job, over = {}) {
  return {
    job: job._id,
    items: [{ partName: "Screen", quantity: 1, unitPricePesewas: 35000, subtotalPesewas: 35000 }],
    subtotalPesewas: 35000,
    totalPesewas: 35000,
    customerPhone: "0244000000",
    status: "pending",
    ...over,
  };
}

describe.each([
  ["PartOrder", "part-orders", () => PartOrder, partOrderData],
  ["RepairOrder", "repair-orders", () => RepairOrder, repairOrderData],
])("PATCH /api/v1/pos/%s/:id — status transition guard (T58)", (label, routeSegment, getModel, buildData) => {
  it("rejects a status outside pending/paid/cancelled", async () => {
    const { token } = await makeUser();
    const job = await makeJob();
    const Model = getModel();
    const order = await Model.create(buildData(job));

    const res = await request(app)
      .patch(`/api/v1/pos/${routeSegment}/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "bogus" });

    expect(res.status).toBe(400);
  });

  it("allows pending -> paid", async () => {
    const { token } = await makeUser();
    const job = await makeJob();
    const Model = getModel();
    const order = await Model.create(buildData(job));

    const res = await request(app)
      .patch(`/api/v1/pos/${routeSegment}/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("paid");
  });

  it("allows pending -> cancelled", async () => {
    const { token } = await makeUser();
    const job = await makeJob();
    const Model = getModel();
    const order = await Model.create(buildData(job));

    const res = await request(app)
      .patch(`/api/v1/pos/${routeSegment}/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });

  it("rejects paid -> pending (backward move)", async () => {
    const { token } = await makeUser();
    const job = await makeJob();
    const Model = getModel();
    const order = await Model.create(buildData(job, { status: "paid" }));

    const res = await request(app)
      .patch(`/api/v1/pos/${routeSegment}/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending" });

    expect(res.status).toBe(400);
    const fresh = await Model.findById(order._id);
    expect(fresh.status).toBe("paid");
  });

  it("rejects paid -> cancelled (a paid order needs a refund process, not a status flip)", async () => {
    const { token } = await makeUser();
    const job = await makeJob();
    const Model = getModel();
    const order = await Model.create(buildData(job, { status: "paid" }));

    const res = await request(app)
      .patch(`/api/v1/pos/${routeSegment}/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(400);
  });

  it("rejects cancelled -> anything (terminal)", async () => {
    const { token } = await makeUser();
    const job = await makeJob();
    const Model = getModel();
    const order = await Model.create(buildData(job, { status: "cancelled" }));

    const res = await request(app)
      .patch(`/api/v1/pos/${routeSegment}/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });

    expect(res.status).toBe(400);
  });

  it("allows a same-status no-op", async () => {
    const { token } = await makeUser();
    const job = await makeJob();
    const Model = getModel();
    const order = await Model.create(buildData(job, { status: "paid" }));

    const res = await request(app)
      .patch(`/api/v1/pos/${routeSegment}/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });

    expect(res.status).toBe(200);
  });
});
