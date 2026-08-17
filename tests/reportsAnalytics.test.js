// Consolidated Reports & Analytics endpoint (/api/v1/pos/reports/analytics).
// Verifies server-side aggregation across repair payments, POS sales, online
// shop orders and inventory — and that internal costs (expenses / net profit)
// only reach admin+superadmin.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");
const PosPayment = require("../models/PosPayment");
const Sale = require("../models/Sale");
const Order = require("../models/Order");
const Part = require("../models/Part");

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
  await Part.create({
    name: "Battery", category: "Battery", quantity: 2, lowStockThreshold: 5,
    costPrice: 1000, sellingPrice: 2000,
  });
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

  it("hides internal costs (expenses / net profit) from staff", async () => {
    await seedShopData();
    const { token } = await makeUser("staff");
    const today = todayStr();

    const res = await request(app)
      .get(`/api/v1/pos/reports/analytics?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpi.expenses.canSeeExpenses).toBe(false);
    expect(res.body.data.kpi.expenses.netProfit).toBeNull();
    expect(res.body.data.expenseByCategory).toEqual([]);
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
