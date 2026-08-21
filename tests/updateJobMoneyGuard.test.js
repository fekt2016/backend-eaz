// PATCH /api/v1/pos/jobs/:id (T57): money-bearing fields — laborCost, diagnosisFee,
// depositPaid, and custom (non-inventory) part pricing — must be ignored when the
// requester is a technician, so a technician can't understate or fabricate a bill.
// Non-money fields (diagnosis, status, part quantity, etc.) must still work for them.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");
const Part = require("../models/Part");

async function makeUser(role) {
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

async function makeJob(over = {}) {
  const phone = `024${Math.floor(1000000 + Math.random() * 8999999)}`;
  const customer = await PosCustomer.create({ phone, name: "C" });
  return RepairJob.create({
    customer: customer._id,
    faultDescription: "Cracked screen",
    laborCost: 5000,
    depositPaid: 0,
    requiresDiagnosis: true,
    diagnosisFee: 2000,
    ...over,
  });
}

describe("PATCH /api/v1/pos/jobs/:id — money-field guard (T57)", () => {
  it("ignores a technician's laborCost/depositPaid/diagnosisFee changes", async () => {
    const { token } = await makeUser("technician");
    const job = await makeJob();

    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ laborCost: 0, depositPaid: 99999, diagnosisFee: 0 });

    expect(res.status).toBe(200);
    const fresh = await RepairJob.findById(job._id);
    expect(fresh.laborCost).toBe(5000);      // unchanged, not zeroed
    expect(fresh.depositPaid).toBe(0);       // unchanged, not fabricated
    expect(fresh.diagnosisFee).toBe(2000);   // unchanged
  });

  it("ignores a technician toggling requiresDiagnosis off to wipe the fee", async () => {
    const { token } = await makeUser("technician");
    const job = await makeJob();

    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ requiresDiagnosis: false });

    expect(res.status).toBe(200);
    const fresh = await RepairJob.findById(job._id);
    expect(fresh.diagnosisFee).toBe(2000); // fee preserved even though requiresDiagnosis flipped
    expect(fresh.requiresDiagnosis).toBe(false);
  });

  it("gives a technician's brand-new custom part a price of 0, not the client-supplied price", async () => {
    const { token } = await makeUser("technician");
    const job = await makeJob();

    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ parts: [{ name: "Custom Cable", quantity: 1, cost: 50000, priceAtTime: 50000 }] });

    expect(res.status).toBe(200);
    const fresh = await RepairJob.findById(job._id);
    const line = fresh.parts.find((p) => p.name === "Custom Cable");
    expect(line.priceAtTime).toBe(0);
    expect(line.costAtTime).toBe(0);
  });

  it("keeps an existing custom part's staff-set price when a technician resubmits it with a different price", async () => {
    const { token: staffToken } = await makeUser("staff");
    const job = await makeJob();

    // Staff prices a custom part first.
    const priced = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ parts: [{ name: "Custom Cable", quantity: 1, cost: 4000, priceAtTime: 4000, costAtTime: 4000 }] });
    expect(priced.status).toBe(200);
    expect(priced.body.data.parts.find((p) => p.name === "Custom Cable").priceAtTime).toBe(4000);

    // Technician resubmits the same job (e.g. bumping quantity) with a bogus price.
    const { token: techToken } = await makeUser("technician");
    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ parts: [{ name: "Custom Cable", quantity: 2, cost: 1, priceAtTime: 1 }] });

    expect(res.status).toBe(200);
    const fresh = await RepairJob.findById(job._id);
    const line = fresh.parts.find((p) => p.name === "Custom Cable");
    expect(line.quantity).toBe(2);       // quantity edit went through
    expect(line.priceAtTime).toBe(4000); // price untouched by the technician
    expect(line.costAtTime).toBe(4000);
  });

  it("still lets a technician update non-money fields", async () => {
    const { token } = await makeUser("technician");
    const job = await makeJob();

    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ diagnosis: "Screen and digitizer both cracked.", status: "repairing" });

    expect(res.status).toBe(200);
    const fresh = await RepairJob.findById(job._id);
    expect(fresh.diagnosis).toBe("Screen and digitizer both cracked.");
    expect(fresh.status).toBe("repairing");
  });

  it("allows staff/admin/superadmin to set money fields normally", async () => {
    for (const role of ["staff", "admin", "superadmin"]) {
      const { token } = await makeUser(role);
      const job = await makeJob();

      const res = await request(app)
        .patch(`/api/v1/pos/jobs/${job._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ laborCost: 8000, depositPaid: 2000 });

      expect(res.status).toBe(200);
      expect(res.body.data.laborCost).toBe(8000);
      expect(res.body.data.depositPaid).toBe(2000);
    }
  });

  it("lets an inventory-linked part's price stay anchored to Part.sellingPrice even for a technician (unaffected by this guard)", async () => {
    const { token } = await makeUser("technician");
    const part = await Part.create({
      name: "iPhone 13 Screen", category: "Screen",
      quantity: 5, costPrice: 10000, sellingPrice: 20000,
    });
    const job = await makeJob();

    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ parts: [{ partId: part._id.toString(), name: part.name, quantity: 1, priceAtTime: 1 }] });

    expect(res.status).toBe(200);
    const fresh = await RepairJob.findById(job._id);
    const line = fresh.parts.find((p) => p.part?.toString() === part._id.toString());
    expect(line.priceAtTime).toBe(20000); // anchored to Part.sellingPrice, client value ignored
  });
});
