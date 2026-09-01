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

// Owner decisions, 2026-08-29: staff are the counter — sales, jobs, payments.
// Shop-wide management surfaces move to superadmin + admin. Reports and warranty
// were granted to staff by the routes; suppliers was already ❌ for staff in
// roles.md and the route was the thing out of step.
describe("POS role enforcement — management surfaces are superadmin + admin (T83)", () => {
  const MANAGEMENT = ["/reports/analytics", "/suppliers", "/warranty"];

  it("403s staff on every management surface", async () => {
    const token = await makeUser("staff");

    for (const path of MANAGEMENT) {
      const res = await request(app).get(`${BASE}${path}`)
        .set("Authorization", `Bearer ${token}`);
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  it("403s a technician on them too", async () => {
    const token = await makeUser("technician");

    for (const path of MANAGEMENT) {
      const res = await request(app).get(`${BASE}${path}`)
        .set("Authorization", `Bearer ${token}`);
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  for (const role of ["admin", "superadmin"]) {
    it(`lets ${role} through`, async () => {
      const token = await makeUser(role);

      for (const path of MANAGEMENT) {
        const res = await request(app).get(`${BASE}${path}`)
          .set("Authorization", `Bearer ${token}`);
        expect({ path, forbidden: res.status === 403 }).toEqual({ path, forbidden: false });
      }
    });
  }

  // Owner decision 2026-08-29: stock is managed by admin. Staff keep the read so
  // they can look an item up mid-sale, but cannot create, change or remove one.
  it("403s staff on stock writes while leaving the read", async () => {
    const token = await makeUser("staff");

    const create = await request(app).post(`${BASE}/inventory`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Screen", sellingPrice: 15000, costPrice: 9000 });
    expect(create.status).toBe(403);

    const update = await request(app).patch(`${BASE}/inventory/6a92b23768140217f2cde966`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sellingPrice: 1 });
    expect(update.status).toBe(403);

    const remove = await request(app).delete(`${BASE}/inventory/6a92b23768140217f2cde966`)
      .set("Authorization", `Bearer ${token}`);
    expect(remove.status).toBe(403);

    const read = await request(app).get(`${BASE}/inventory`)
      .set("Authorization", `Bearer ${token}`);
    expect(read.status).toBe(200);
  });

  it("still lets admin write stock", async () => {
    const token = await makeUser("admin");
    const res = await request(app).post(`${BASE}/inventory`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Battery", sellingPrice: 8000, costPrice: 5000, category: "Battery" });
    expect(res.status).not.toBe(403);
  });

  it("leaves staff their own scoped dashboard", async () => {
    const token = await makeUser("staff");
    const res = await request(app).get(`${BASE}/my-overview`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });
});

// T105 (owner, 2026-09-01): roles.md and routes divergence resolved row by row.
//  - customers: staff SEARCH + CREATE (job intake creates a walk-in), admin EDITS
//  - reminders trigger: staff may send collection reminders
//  - staff accounts: admin may create, not just superadmin
//  - admin keeps job payments / MoMo / card charges
describe("POS role enforcement — T105 divergence resolutions", () => {
  it("lets a staff member create a customer (walk-in intake)", async () => {
    const token = await makeUser("staff");
    const res = await request(app)
      .post(`${BASE}/customers`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Walk-in", phone: "0555555555" });
    expect(res.status).not.toBe(403);
  });

  it("403s a staff member editing an existing customer (admin-only)", async () => {
    const token = await makeUser("staff");
    const res = await request(app)
      .patch(`${BASE}/customers/6a92b23768140217f2cde966`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nope" });
    expect(res.status).toBe(403);
  });

  for (const role of ["admin", "superadmin"]) {
    it(`lets a ${role} edit an existing customer`, async () => {
      const token = await makeUser(role);
      const res = await request(app)
        .patch(`${BASE}/customers/6a92b23768140217f2cde966`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Rename" });
      expect({ role, status: res.status }).toEqual({ role, status: 404 });
    });
  }

  for (const role of ["staff", "admin", "superadmin"]) {
    it(`lets a ${role} trigger collection reminders`, async () => {
      const token = await makeUser(role);
      const res = await request(app)
        .post(`${BASE}/reminders/trigger`)
        .set("Authorization", `Bearer ${token}`);
      expect({ role, forbidden: res.status === 403 }).toEqual({ role, forbidden: false });
    });
  }

  it("lets admin and superadmin create staff accounts", async () => {
    for (const role of ["admin", "superadmin"]) {
      const token = await makeUser(role);
      const res = await request(app)
        .post(`${BASE}/staff`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Hired", email: `t105-${role}-${Date.now()}@t.com`, password: "Password123!", role: "technician" });
      expect({ role, status: res.status }).toEqual({ role, status: 201 });
    }
  });

  it("403s a staff member from creating staff accounts", async () => {
    const token = await makeUser("staff");
    const res = await request(app)
      .post(`${BASE}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Hired", email: "nope@t.com", password: "Password123!", role: "technician" });
    expect(res.status).toBe(403);
  });

  for (const role of ["admin", "superadmin"]) {
    it(`still lets a ${role} take a job payment`, async () => {
      const token = await makeUser(role);
      const res = await request(app)
        .post(`${BASE}/jobs/6a92b23768140217f2cde966/payments`)
        .set("Authorization", `Bearer ${token}`)
        .send({ paymentMethod: "cash", amountPaid: 500 });
      expect({ role, status: res.status }).toEqual({ role, status: 404 });
    });
  }
});
