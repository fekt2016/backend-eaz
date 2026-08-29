// T83: POS routes sat behind one blanket gate —
// restrictTo('superadmin','admin','staff','technician') — and several added no
// further check. `createSale` performs no role check of its own, so a technician
// could ring up a sale, moving stock and money. roles.md marks sales, customers,
// stock lookup and scanning ❌ for technicians; hiding the button in the sidebar
// is not authorization.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");

async function makeUser(role) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const BASE = "/api/v1/pos";

// Routes roles.md marks ❌ for technicians.
const FORBIDDEN = [
  ["get",  "/sales"],
  ["post", "/sales"],
  ["get",  "/sales/summary"],
  ["get",  "/customers"],
  ["post", "/customers"],
  ["get",  "/inventory"],
  ["get",  "/scan/ABC123"],
];

// Routes roles.md marks ✅ for technicians — these must keep working.
const ALLOWED = [
  ["get", "/jobs"],
  ["get", "/my-overview"],
  ["get", "/technicians"],
];

describe("POS role enforcement — technician (T83)", () => {
  it("403s a technician on every route roles.md marks ❌", async () => {
    const token = await makeUser("technician");

    for (const [method, path] of FORBIDDEN) {
      const res = await request(app)[method](`${BASE}${path}`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  it("does not create a sale for a technician", async () => {
    const token = await makeUser("technician");
    const Sale = require("../models/Sale");
    const before = await Sale.countDocuments();

    const res = await request(app)
      .post(`${BASE}/sales`)
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ name: "Screen", price: 15000, quantity: 1 }], paymentMethod: "cash" });

    expect(res.status).toBe(403);
    expect(await Sale.countDocuments()).toBe(before); // nothing persisted
  });

  it("still allows a technician the routes roles.md marks ✅", async () => {
    const token = await makeUser("technician");

    for (const [method, path] of ALLOWED) {
      const res = await request(app)[method](`${BASE}${path}`)
        .set("Authorization", `Bearer ${token}`);
      expect({ path, forbidden: res.status === 403 }).toEqual({ path, forbidden: false });
    }
  });
});

describe("POS role enforcement — staff/admin/superadmin keep their access (T83)", () => {
  // The fix uses denyRoles('technician'), so no other role's access may narrow.
  for (const role of ["staff", "admin", "superadmin"]) {
    it(`does not 403 a ${role} on the routes technicians lost`, async () => {
      const token = await makeUser(role);

      // Admin keeps the sales *reads* but not the write — see the ringing-up block.
      const expected = FORBIDDEN.filter(
        ([m, p]) => !(role === "admin" && m === "post" && p === "/sales"),
      );

      for (const [method, path] of expected) {
        const res = await request(app)[method](`${BASE}${path}`)
          .set("Authorization", `Bearer ${token}`)
          .send({});
        expect({ role, path, forbidden: res.status === 403 })
          .toEqual({ role, path, forbidden: false });
      }
    });
  }
});

// Ringing up a sale is superadmin + staff. Admin runs the shop but does not take
// money at the counter — the same separation already applied to job payments and
// expenses. Confirmed with the product owner 2026-08-29.
describe("POS role enforcement — only the till rings up sales (T83)", () => {
  const sale = {
    items: [{ name: "Screen", price: 15000, quantity: 1 }],
    paymentMethod: "cash",
    amountPaid: 15000,
  };

  for (const role of ["admin", "technician"]) {
    it(`403s a ${role} on POST /sales and persists nothing`, async () => {
      const token = await makeUser(role);
      const Sale = require("../models/Sale");
      const before = await Sale.countDocuments();

      const res = await request(app)
        .post(`${BASE}/sales`)
        .set("Authorization", `Bearer ${token}`)
        .send(sale);

      expect(res.status).toBe(403);
      expect(await Sale.countDocuments()).toBe(before);
    });
  }

  for (const role of ["staff", "superadmin"]) {
    it(`lets a ${role} past the role gate on POST /sales`, async () => {
      const token = await makeUser(role);
      const res = await request(app)
        .post(`${BASE}/sales`)
        .set("Authorization", `Bearer ${token}`)
        .send(sale);

      expect(res.status).not.toBe(403);
    });
  }

  it("still lets an admin read sales", async () => {
    const token = await makeUser("admin");
    for (const path of ["/sales", "/sales/summary"]) {
      const res = await request(app).get(`${BASE}${path}`)
        .set("Authorization", `Bearer ${token}`);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  });
});
