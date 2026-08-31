// Consolidated Reports & Analytics endpoint (/api/v1/pos/reports/analytics).
// Verifies server-side aggregation across repair payments, POS sales, online
// shop orders and inventory — and that internal costs (expenses / net profit)
// only reach admin+superadmin.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");
const PosPayment = require("../models/PosPayment");
const Sale = require("../models/Sale");
const Order = require("../models/Order");

async function makeUser(role) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function seedShopData() {
  const user = await User.create({
    name: "Staff", email: `staff-${Date.now()}@t.com`, password: "Password123!", role: "superadmin",
  });

  // Repair payment (GH₵50 = 5000 pesewas)
  const customer = await PosCustomer.create({ name: "Kofi", phone: "0244000000" });
  const job = await RepairJob.create({ customer: customer._id, faultDescription: "Broken screen" });
  await PosPayment.create({ job: job._id, amount: 5000, method: "cash", receivedBy: user._id });

  // Over-the-counter POS sale (GH₵30 = 3000 pesewas)
  await Sale.create({
    items: [{ name: "iPhone 14 Screen", quantity: 1, unitPrice: 3000, subtotal: 3000 }],
    subtotal: 3000, total: 3000, paymentMethod: "momo", amountPaid: 3000, cashier: user._id,
  });

  // Online shop order, delivered (GH₵120 = 12000 pesewas)
  await Order.create({
    orderNumber: `EZW-${Date.now()}`,
    items: [{ name: "Case", price: 12000, qty: 1 }],
    subtotal: 12000, total: 12000,
    customer: { name: "Ama", phone: "0245000000" },
    status: "delivered",
  });

  // Inventory: one part below its threshold
  await Product.create({
    name: "Battery", category: "Battery", partCategory: "Battery", stock: 2, lowStockThreshold: 5,
    costPrice: 1000, price: 2000, useInRepairs: true});
}

describe("GET /api/v1/pos/reports/analytics", () => {
  it("aggregates revenue, orders and inventory server-side for admin", async () => {
    await seedShopData();
    const { token } = await makeUser("superadmin");
    const today = todayStr();

    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.data;

    // repair 5000 + pos 3000 + shop 12000
    expect(d.kpi.revenue.total).toBe(20000);
    expect(d.kpi.revenue.repair).toBe(5000);
    expect(d.kpi.revenue.posSales).toBe(3000);
    expect(d.kpi.revenue.shopOrders).toBe(12000);

    expect(d.kpi.orders.total).toBe(1);
    expect(d.kpi.orders.aov).toBe(12000); // one paid order

    expect(d.kpi.inventory.lowStock).toBeGreaterThanOrEqual(1);
    expect(d.kpi.expenses.canSeeExpenses).toBe(true);

    // Today's series carries the combined revenue
    const todayPoint = d.revenueSeries.find((s) => s.date === today);
    expect(todayPoint).toBeTruthy();
    expect(todayPoint.total).toBe(20000);
  });

  // T83 (owner, 2026-08-29): staff no longer read reports at all, so the question
  // of which figures to hide from them no longer arises — the endpoint refuses.
  it("refuses staff outright", async () => {
    await seedShopData();
    const { token } = await makeUser("staff");
    const today = todayStr();

    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("forbids technicians", async () => {
    const { token } = await makeUser("technician");
    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?from=${todayStr()}&to=${todayStr()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("respects the date range", async () => {
    await seedShopData();
    // A stale order from 2020 must not leak into today's report.
    await Order.create({
      orderNumber: `EZW-OLD-${Date.now()}`,
      items: [{ name: "Old", price: 100, qty: 1 }],
      subtotal: 100, total: 100,
      customer: { name: "Old", phone: "0246000000" },
      status: "delivered",
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const { token } = await makeUser("admin");
    const today = todayStr();
    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpi.orders.total).toBe(1);
    expect(res.body.data.kpi.revenue.shopOrders).toBe(12000);
  });
});

// T32: staff see only their own activity; admin can scope to any staff
// member or stay shop-wide. Server-side scoping — a client-supplied staffId
// is never trusted for the staff role itself.
describe("GET /api/v1/pos/reports/analytics — staff scope (T32)", () => {
  async function seedTwoStaffActivity() {
    const staffA = await makeUser("staff");
    const staffB = await makeUser("staff");
    const customer = await PosCustomer.create({ name: "Kofi", phone: "0244000000" });

    // Staff A: one repair payment (GH₵50), one POS sale (GH₵30), one job they created.
    const jobA = await RepairJob.create({
      customer: customer._id, faultDescription: "Cracked screen", createdBy: staffA.user._id,
    });
    await PosPayment.create({ job: jobA._id, amount: 5000, method: "cash", receivedBy: staffA.user._id });
    await Sale.create({
      items: [{ name: "Case", quantity: 1, unitPrice: 3000, subtotal: 3000 }],
      subtotal: 3000, total: 3000, paymentMethod: "cash", amountPaid: 3000, cashier: staffA.user._id,
    });

    // Staff B: one repair payment (GH₵70), one POS sale (GH₵40), one job they created.
    const jobB = await RepairJob.create({
      customer: customer._id, faultDescription: "Battery swap", createdBy: staffB.user._id,
    });
    await PosPayment.create({ job: jobB._id, amount: 7000, method: "momo", receivedBy: staffB.user._id });
    await Sale.create({
      items: [{ name: "Charger", quantity: 1, unitPrice: 4000, subtotal: 4000 }],
      subtotal: 4000, total: 4000, paymentMethod: "momo", amountPaid: 4000, cashier: staffB.user._id,
    });

    // A shop order — never staff-attributable, must never leak into either scope.
    await Order.create({
      orderNumber: `EZW-${Date.now()}`,
      items: [{ name: "Case", price: 12000, qty: 1 }],
      subtotal: 12000, total: 12000,
      customer: { name: "Ama", phone: "0245000000" },
      status: "delivered",
    });

    return { staffA, staffB };
  }

  // Was: a staff caller is pinned to their own activity and never trusted with a
  // client-supplied staffId. T83 removed staff from this endpoint, so the scoping
  // branch is unreachable — the guarantee is now the stronger one. The controller
  // still carries that T32 logic; see T111.
  it("refuses a staff caller rather than scoping them", async () => {
    const { staffA, staffB } = await seedTwoStaffActivity();

    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?staffId=${staffB.user._id}`)
      .set("Authorization", `Bearer ${staffA.token}`);

    expect(res.status).toBe(403);
  });

  it("lets admin scope to a specific staff member's activity via staffId", async () => {
    const { staffB } = await seedTwoStaffActivity();
    const { token: adminToken } = await makeUser("admin");

    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?staffId=${staffB.user._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.scope.staffId).toBe(String(staffB.user._id));
    expect(d.scope.staffName).toBe("staff");
    // T111 — `isOwnReport` was removed. It was `req.user.role === 'staff'` on a
    // route restricted to superadmin+admin, so it always shipped `false`. This
    // asserted that constant rather than any behaviour.
    expect(d.scope.isOwnReport).toBeUndefined();

    // Only staff B's numbers.
    expect(d.kpi.revenue.repair).toBe(7000);
    expect(d.kpi.revenue.posSales).toBe(4000);
    expect(d.kpi.revenue.shopOrders).toBe(0);
    expect(d.kpi.revenue.total).toBe(11000);
    expect(d.kpi.repairs.total).toBe(1);
  });

  it("admin without staffId stays shop-wide, unchanged, and gets the staff picker list", async () => {
    await seedTwoStaffActivity();
    const { token: adminToken } = await makeUser("admin");

    const res = await request(app)
      .get("/api/v1/pos/reports/analytics")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.scope.staffId).toBeNull();

    // Combined staff A + staff B + the shop order — nothing double-counted,
    // nothing missing (proves the per-staff filters union back to the
    // original shop-wide totals with no overlap).
    expect(d.kpi.revenue.repair).toBe(12000); // 5000 + 7000
    expect(d.kpi.revenue.posSales).toBe(7000); // 3000 + 4000
    expect(d.kpi.revenue.shopOrders).toBe(12000);
    expect(d.kpi.revenue.total).toBe(31000);
    expect(d.kpi.repairs.total).toBe(2);

    expect(d.scope.staffList.length).toBeGreaterThanOrEqual(3); // staffA, staffB, admin caller
  });

  // Aggregation regression, unrelated to who may call it: re-pointed to an admin
  // caller scoped via staffId after T83 removed staff from this endpoint.
  it("does not double-count a staff member who both created the job and received its payment", async () => {
    const { user } = await makeUser("staff");
    const { token } = await makeUser("admin");
    const customer = await PosCustomer.create({ name: "Ama", phone: "0245000000" });
    // Same person is both createdBy AND (via PosPayment) receivedBy for the same job.
    const job = await RepairJob.create({
      customer: customer._id, faultDescription: "Water damage", createdBy: user._id,
    });
    await PosPayment.create({ job: job._id, amount: 5000, method: "cash", receivedBy: user._id });

    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?staffId=${user._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    // One job counted once (not twice), one payment summed once (not twice).
    expect(d.kpi.repairs.total).toBe(1);
    expect(d.kpi.revenue.repair).toBe(5000);
  });

  it("ignores an invalid staffId from admin and falls back to shop-wide", async () => {
    await seedShopData();
    const { token: adminToken } = await makeUser("admin");

    const res = await request(app)
      .get("/api/v1/pos/reports/analytics?staffId=not-a-valid-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.scope.staffId).toBeNull();
    expect(res.body.data.kpi.revenue.total).toBe(20000); // unfiltered, matches the admin shop-wide test
  });
});
