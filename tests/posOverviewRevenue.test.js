// GET /api/v1/pos/overview — "Total Revenue" on the admin dashboard.
//
// This tile used to sum PosPayment alone, so it counted repair payments and
// nothing else. On a shop with no repair payments recorded it read GH₵0.00 no
// matter how much had actually been taken. It must be every transaction in the
// app: repairs + counter sales + shop orders + domains + hosting.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");
const PosPayment = require("../models/PosPayment");
const Sale = require("../models/Sale");
const Order = require("../models/Order");
const DomainOrder = require("../models/DomainOrder");
const HostingOrder = require("../models/HostingOrder");

async function adminToken() {
  const user = await User.create({
    name: "admin",
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role: "admin",
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

describe("GET /pos/overview — total revenue spans every source", () => {
  it("sums repairs, counter sales, shop orders, domains and hosting", async () => {
    const token = await adminToken();
    const owner = await User.create({
      name: "owner", email: `o-${Date.now()}@t.com`, password: "Password123!", role: "admin",
    });
    const customer = await PosCustomer.create({ name: "Kwame", phone: "0244000000" });
    const job = await RepairJob.create({
      customer: customer._id, faultDescription: "Screen", createdBy: owner._id,
    });

    await PosPayment.create({ job: job._id, amount: 5000, method: "cash", receivedBy: owner._id });
    await Sale.create({
      items: [{ name: "Screen", quantity: 1, unitPrice: 3000, subtotal: 3000 }],
      subtotal: 3000, total: 3000, paymentMethod: "momo", amountPaid: 3000, cashier: owner._id,
    });
    await Order.create({
      orderNumber: `EZW-${Date.now()}`,
      items: [{ name: "Case", price: 12000, qty: 1 }],
      subtotal: 12000, total: 12000,
      customer: { name: "Ama", phone: "0245000000" },
      status: "delivered",
    });
    await DomainOrder.create({
      user: owner._id, domain: "example", tld: "com", price: 90,
      email: "ama@t.com", customerName: "Ama",
      status: "completed", amountPesewas: 9000,
    });
    await HostingOrder.create({
      user: owner._id, planType: "shared", tier: "starter", billingCycle: "monthly",
      customer: { name: "Ama", email: "ama@t.com" },
      amount: 250, paymentMethod: "mobile_money",
      status: "active", amountPesewas: 25000,
    });

    const res = await request(app)
      .get("/api/v1/pos/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { stats } = res.body.data;

    // 5000 + 3000 + 12000 + 9000 + 25000
    expect(stats.totalRevenue).toBe(54000);
    expect(stats.repairRevenue).toBe(5000);
    expect(stats.posSalesRevenue).toBe(3000);
    expect(stats.shopOrderRevenue).toBe(12000);
    expect(stats.domainRevenue).toBe(9000);
    expect(stats.hostingRevenue).toBe(25000);
    expect(stats.domainCount).toBe(1);
    expect(stats.hostingCount).toBe(1);
  });

  it("excludes unpaid and cancelled rows from revenue", async () => {
    const token = await adminToken();
    const owner = await User.create({
      name: "owner2", email: `o2-${Date.now()}@t.com`, password: "Password123!", role: "admin",
    });

    // None of these were ever paid for.
    await Order.create({
      orderNumber: `EZW-P-${Date.now()}`,
      items: [{ name: "Case", price: 4000, qty: 1 }],
      subtotal: 4000, total: 4000,
      customer: { name: "Yaw", phone: "0247000000" },
      status: "pending",
    });
    await DomainOrder.create({
      user: owner._id, domain: "unpaid", tld: "com", price: 90,
      email: "yaw@t.com", customerName: "Yaw",
      status: "pending", amountPesewas: 9000,
    });
    await HostingOrder.create({
      user: owner._id, planType: "shared", tier: "starter", billingCycle: "monthly",
      customer: { name: "Yaw", email: "yaw@t.com" },
      amount: 250, paymentMethod: "mobile_money",
      status: "cancelled", amountPesewas: 25000,
    });

    const res = await request(app)
      .get("/api/v1/pos/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.stats.totalRevenue).toBe(0);
    expect(res.body.data.stats.domainCount).toBe(0);
    expect(res.body.data.stats.hostingCount).toBe(0);
  });

  it("treats a null amountPesewas as zero rather than corrupting the total", async () => {
    // T44 left hosting/domain money mid-migration: rows can still carry the
    // legacy `price`/`amount` with amountPesewas unset. Those must not be
    // summed as if they were pesewas.
    const token = await adminToken();
    const owner = await User.create({
      name: "owner3", email: `o3-${Date.now()}@t.com`, password: "Password123!", role: "admin",
    });
    await HostingOrder.create({
      user: owner._id, planType: "shared", tier: "starter", billingCycle: "monthly",
      customer: { name: "Kofi", email: "kofi@t.com" },
      amount: 250, paymentMethod: "mobile_money",
      status: "active", amountPesewas: null,
    });

    const res = await request(app)
      .get("/api/v1/pos/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.stats.hostingRevenue).toBe(0);
    expect(res.body.data.stats.totalRevenue).toBe(0);
    // The order still exists and is counted, it just contributes no money yet.
    expect(res.body.data.stats.hostingCount).toBe(1);
  });
});
