// PATCH /api/v1/pos/jobs/:id (T53): status transitions must be forward-only.
// `collected`/`cancelled` are terminal (no moves out); `ready -> cancelled` is
// blocked (T18); one deliberate exception, `waiting_for_parts -> diagnosing`, is
// the manual-reset fallback T58 relies on when a paid part/repair order tied to
// the job is cancelled.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");

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

async function makeJob(status) {
  const phone = `024${Math.floor(1000000 + Math.random() * 8999999)}`;
  const customer = await PosCustomer.create({ phone, name: "C" });
  return RepairJob.create({ customer: customer._id, faultDescription: "Cracked screen", status });
}

async function patchStatus(token, job, status) {
  return request(app)
    .patch(`/api/v1/pos/jobs/${job._id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status });
}

describe("PATCH /api/v1/pos/jobs/:id — status transition guard (T53)", () => {
  it("allows a forward move, including a skip (received -> ready)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("received");

    const res = await patchStatus(token, job, "ready");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ready");
  });

  it("allows a same-status no-op", async () => {
    const { token } = await makeUser();
    const job = await makeJob("repairing");

    const res = await patchStatus(token, job, "repairing");

    expect(res.status).toBe(200);
  });

  it("rejects a backward move (ready -> diagnosing)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("ready");

    const res = await patchStatus(token, job, "diagnosing");

    expect(res.status).toBe(400);
    const fresh = await RepairJob.findById(job._id);
    expect(fresh.status).toBe("ready");
  });

  it("rejects collected -> received (backward, terminal)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("collected");

    const res = await patchStatus(token, job, "received");

    expect(res.status).toBe(400);
  });

  it("rejects collected -> anything else (terminal)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("collected");

    const res = await patchStatus(token, job, "repairing");

    expect(res.status).toBe(400);
  });

  it("rejects cancelled -> anything (terminal)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("cancelled");

    const res = await patchStatus(token, job, "repairing");

    expect(res.status).toBe(400);
  });

  it("rejects ready -> cancelled (T18)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("ready");

    const res = await patchStatus(token, job, "cancelled");

    expect(res.status).toBe(400);
    const fresh = await RepairJob.findById(job._id);
    expect(fresh.status).toBe("ready");
  });

  it("rejects collected -> cancelled (T18)", async () => {
    // The ready guard has its own rule; `collected` is blocked by the terminal
    // rule instead, and T18 names both — so pin the transition itself rather
    // than trusting that the two rules together happen to cover it.
    const { token } = await makeUser();
    const job = await makeJob("collected");

    const res = await patchStatus(token, job, "cancelled");

    expect(res.status).toBe(400);
    const fresh = await RepairJob.findById(job._id);
    expect(fresh.status).toBe("collected");
  });

  it("allows cancelling a live job that is not yet ready (e.g. repairing -> cancelled)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("repairing");

    const res = await patchStatus(token, job, "cancelled");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });

  it("allows the waiting_for_parts -> diagnosing manual-reset fallback (T58)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("waiting_for_parts");

    const res = await patchStatus(token, job, "diagnosing");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("diagnosing");
  });

  it("still rejects other backward moves out of waiting_for_parts (e.g. -> received)", async () => {
    const { token } = await makeUser();
    const job = await makeJob("waiting_for_parts");

    const res = await patchStatus(token, job, "received");

    expect(res.status).toBe(400);
  });

  it("sets completedAt when reaching collected", async () => {
    const { token } = await makeUser();
    const job = await makeJob("ready");

    const res = await patchStatus(token, job, "collected");

    expect(res.status).toBe(200);
    const fresh = await RepairJob.findById(job._id);
    expect(fresh.completedAt).toBeTruthy();
  });
});
