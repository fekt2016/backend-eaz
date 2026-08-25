const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Sale = require("../models/Sale");
const User = require("../models/User");

// Staff sales tracking: the Sell page needs a per-staff view of sales. Staff see only
// what they rang up; admin and superadmin see everything, plus a per-cashier
// breakdown. Before this, GET /pos/sales returned every cashier's sales to any
// authenticated POS user, so this is an access-control fix as much as a feature.

async function makeUser(role, name) {
  const user = await User.create({
    name,
    email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

// Money is integer pesewas, same as the rest of POS.
async function makeSale(cashierId, total, over = {}) {
  return Sale.create({
    items: [{ name: "Screen", quantity: 1, unitPrice: total, subtotal: total }],
    subtotal: total,
    total,
    paymentMethod: "cash",
    amountPaid: total,
    cashier: cashierId,
    ...over,
  });
}

const auth = (req, token) => req.set("Authorization", `Bearer ${token}`);

describe("GET /api/v1/pos/sales — per-staff scoping", () => {
  it("returns only the caller's own sales for staff", async () => {
    const ama = await makeUser("staff", "Ama");
    const kofi = await makeUser("staff", "Kofi");
    await makeSale(ama.user._id, 12000);
    await makeSale(ama.user._id, 8000);
    await makeSale(kofi.user._id, 5000);

    const res = await auth(request(app).get("/api/v1/pos/sales"), ama.token);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
    for (const s of res.body.data) {
      expect(String(s.cashier._id)).toBe(String(ama.user._id));
    }
  });

  it("does not let staff widen the scope with ?cashierId", async () => {
    const ama = await makeUser("staff", "Ama");
    const kofi = await makeUser("staff", "Kofi");
    await makeSale(ama.user._id, 12000);
    await makeSale(kofi.user._id, 5000);

    // Asking for someone else's sales must still return only your own.
    const res = await auth(
      request(app).get(`/api/v1/pos/sales?cashierId=${kofi.user._id}`),
      ama.token,
    );

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(String(res.body.data[0].cashier._id)).toBe(String(ama.user._id));
  });

  it("shows every cashier's sales to an admin", async () => {
    const ama = await makeUser("staff", "Ama");
    const kofi = await makeUser("staff", "Kofi");
    const admin = await makeUser("admin", "Boss");
    await makeSale(ama.user._id, 12000);
    await makeSale(kofi.user._id, 5000);

    const res = await auth(request(app).get("/api/v1/pos/sales"), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it("lets an admin filter down to one cashier", async () => {
    const ama = await makeUser("staff", "Ama");
    const kofi = await makeUser("staff", "Kofi");
    const admin = await makeUser("admin", "Boss");
    await makeSale(ama.user._id, 12000);
    await makeSale(kofi.user._id, 5000);

    const res = await auth(
      request(app).get(`/api/v1/pos/sales?cashierId=${kofi.user._id}`),
      admin.token,
    );

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].total).toBe(5000);
  });

  it("rejects a malformed cashierId from an admin", async () => {
    const admin = await makeUser("admin", "Boss");
    const res = await auth(request(app).get("/api/v1/pos/sales?cashierId=nope"), admin.token);
    expect(res.status).toBe(400);
  });

  it("excludes voided sales", async () => {
    const ama = await makeUser("staff", "Ama");
    await makeSale(ama.user._id, 12000);
    await makeSale(ama.user._id, 9000, { voided: true });

    const res = await auth(request(app).get("/api/v1/pos/sales"), ama.token);
    expect(res.body.total).toBe(1);
  });

  it("clamps limit so one request cannot pull the whole history", async () => {
    const ama = await makeUser("staff", "Ama");
    // Sequential on purpose: Sale's saleNumber pre-save hook counts documents, so
    // concurrent creates collide on the unique index (a real bug, filed separately).
    for (let i = 0; i < 5; i++) await makeSale(ama.user._id, 1000 + i);

    const res = await auth(request(app).get("/api/v1/pos/sales?limit=99999"), ama.token);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(100);
  });
});

describe("GET /api/v1/pos/sales/:id — per-staff scoping", () => {
  it("404s when staff open another cashier's sale", async () => {
    const ama = await makeUser("staff", "Ama");
    const kofi = await makeUser("staff", "Kofi");
    const sale = await makeSale(kofi.user._id, 5000);

    const res = await auth(request(app).get(`/api/v1/pos/sales/${sale._id}`), ama.token);

    // 404, not 403 — don't confirm that someone else's sale id exists.
    expect(res.status).toBe(404);
  });

  it("lets staff open their own sale", async () => {
    const ama = await makeUser("staff", "Ama");
    const sale = await makeSale(ama.user._id, 5000);

    const res = await auth(request(app).get(`/api/v1/pos/sales/${sale._id}`), ama.token);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(5000);
  });

  it("lets an admin open anyone's sale", async () => {
    const kofi = await makeUser("staff", "Kofi");
    const admin = await makeUser("admin", "Boss");
    const sale = await makeSale(kofi.user._id, 5000);

    const res = await auth(request(app).get(`/api/v1/pos/sales/${sale._id}`), admin.token);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/pos/sales/summary", () => {
  it("gives staff their own totals and no per-staff breakdown", async () => {
    const ama = await makeUser("staff", "Ama");
    const kofi = await makeUser("staff", "Kofi");
    await makeSale(ama.user._id, 12000);
    await makeSale(ama.user._id, 8000);
    await makeSale(kofi.user._id, 5000);

    const res = await auth(request(app).get("/api/v1/pos/sales/summary"), ama.token);

    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe("own");
    expect(res.body.data.mine).toMatchObject({ count: 2, revenue: 20000 });
    expect(res.body.data.byStaff).toBeUndefined();
  });

  it("counts today's sales separately", async () => {
    const ama = await makeUser("staff", "Ama");
    await makeSale(ama.user._id, 12000);
    const old = await makeSale(ama.user._id, 8000);
    // `timestamps: true` makes createdAt immutable through Mongoose — go via the
    // raw driver to backdate it.
    await Sale.collection.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date("2020-01-01") } },
    );

    const res = await auth(request(app).get("/api/v1/pos/sales/summary"), ama.token);

    expect(res.body.data.mine.count).toBe(2);
    expect(res.body.data.mine.todayCount).toBe(1);
    expect(res.body.data.mine.todayRevenue).toBe(12000);
  });

  it("gives an admin a per-cashier breakdown, highest revenue first", async () => {
    const ama = await makeUser("staff", "Ama");
    const kofi = await makeUser("staff", "Kofi");
    const admin = await makeUser("admin", "Boss");
    await makeSale(ama.user._id, 12000);
    await makeSale(ama.user._id, 8000);
    await makeSale(kofi.user._id, 5000);

    const res = await auth(request(app).get("/api/v1/pos/sales/summary"), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe("all");
    const rows = res.body.data.byStaff;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Ama", count: 2, revenue: 20000 });
    expect(rows[1]).toMatchObject({ name: "Kofi", count: 1, revenue: 5000 });
  });

  it("keeps a sale whose cashier account is gone, labelled Unknown", async () => {
    const ghost = await makeUser("staff", "Ghost");
    const admin = await makeUser("admin", "Boss");
    await makeSale(ghost.user._id, 4000);
    await User.deleteOne({ _id: ghost.user._id });

    const res = await auth(request(app).get("/api/v1/pos/sales/summary"), admin.token);

    const row = res.body.data.byStaff.find((r) => r.revenue === 4000);
    expect(row).toBeDefined();
    expect(row.name).toBe("Unknown");
  });

  it("excludes voided sales from both the totals and the breakdown", async () => {
    const ama = await makeUser("staff", "Ama");
    const admin = await makeUser("admin", "Boss");
    await makeSale(ama.user._id, 12000);
    await makeSale(ama.user._id, 9000, { voided: true });

    const staffRes = await auth(request(app).get("/api/v1/pos/sales/summary"), ama.token);
    expect(staffRes.body.data.mine).toMatchObject({ count: 1, revenue: 12000 });

    const adminRes = await auth(request(app).get("/api/v1/pos/sales/summary"), admin.token);
    expect(adminRes.body.data.byStaff[0]).toMatchObject({ count: 1, revenue: 12000 });
  });

  it("returns zeros for a cashier with no sales", async () => {
    const fresh = await makeUser("staff", "Fresh");
    const res = await auth(request(app).get("/api/v1/pos/sales/summary"), fresh.token);

    expect(res.status).toBe(200);
    expect(res.body.data.mine).toMatchObject({ count: 0, revenue: 0, todayCount: 0, todayRevenue: 0 });
  });
});
