// GET /api/v1/track/mine — the customer's "My Repairs" list.
//
// This used to return a hard `.limit(50)` with no total, so a customer with
// more than 50 repairs could not reach the rest and the page had no way to know
// more existed. It now pages at 10 like the rest of the app.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");

async function makeUser(role, extra = {}) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    ...extra,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

async function seedJobs(customerId, creatorId, n) {
  for (let i = 0; i < n; i += 1) {
    // Distinct createdAt so the sort is deterministic and pages cannot overlap.
    await RepairJob.create({
      customer: customerId,
      faultDescription: `Fault ${i}`,
      createdBy: creatorId,
      createdAt: new Date(Date.now() - i * 60_000),
    });
  }
}

describe("GET /track/mine — pagination", () => {
  it("returns 10 per page with a total, for a customer", async () => {
    const phone = "0244111222";
    const { user, token } = await makeUser("user", { phone });
    const customer = await PosCustomer.create({ name: "Kwame", phone });
    await seedJobs(customer._id, user._id, 23);

    const p1 = await request(app)
      .get("/api/v1/track/mine")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(p1.body.data).toHaveLength(10);
    expect(p1.body.total).toBe(23);
    expect(p1.body.page).toBe(1);

    const p3 = await request(app)
      .get("/api/v1/track/mine?page=3")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(p3.body.data).toHaveLength(3); // 23 = 10 + 10 + 3
    expect(p3.body.total).toBe(23);

    // No row may appear on two pages.
    const ids1 = p1.body.data.map(j => j._id);
    const ids3 = p3.body.data.map(j => j._id);
    expect(ids1.filter(id => ids3.includes(id))).toHaveLength(0);
  });

  it("pages the staff-side view too, and no longer caps it at 50", async () => {
    const { user, token } = await makeUser("admin");
    const customer = await PosCustomer.create({ name: "Ama", phone: "0244333444" });
    await seedJobs(customer._id, user._id, 55);

    const res = await request(app)
      .get("/api/v1/track/mine?page=6")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.total).toBe(55);
    // Page 6 is rows 51-55 — unreachable under the old hard limit of 50.
    expect(res.body.data).toHaveLength(5);
  });

  it("clamps a junk or oversized limit rather than pulling the collection", async () => {
    const phone = "0244555666";
    const { user, token } = await makeUser("user", { phone });
    const customer = await PosCustomer.create({ name: "Kofi", phone });
    await seedJobs(customer._id, user._id, 12);

    const junk = await request(app)
      .get("/api/v1/track/mine?limit=abc&page=-4")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(junk.body.data).toHaveLength(10); // falls back to the default
    expect(junk.body.page).toBe(1);

    const huge = await request(app)
      .get("/api/v1/track/mine?limit=99999")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(huge.body.data.length).toBeLessThanOrEqual(100); // maxLimit
  });

  it("returns an empty page, not an error, when the user matches no customer", async () => {
    const { token } = await makeUser("user", { phone: "0209999999" });

    const res = await request(app)
      .get("/api/v1/track/mine")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
