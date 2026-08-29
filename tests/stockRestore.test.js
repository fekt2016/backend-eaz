const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");

async function makeAdminToken() {
  const user = await User.create({
    name: "Admin",
    email: `admin-${Date.now()}-${Math.random()}@t.com`,
    password: "Password123!",
    role: "admin",
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

// T2 — cancelling an order/job that already had stock deducted restores it.
describe("Restock on cancellation (T2)", () => {
  it("restores Part quantity when a paid shop order is cancelled", async () => {
    const part = await Product.create({
      name: "iPhone 13 Screen", category: "Screen", partCategory: "Screen",
      stock: 5, costPrice: 10000, price: 20000, useInRepairs: true});
    const order = await Order.create({
      orderNumber: "EZW-T2-1",
      items: [{ part: part._id, name: "iPhone 13 Screen", price: 20000, qty: 2 }],
      subtotal: 40000,
      total: 40000,
      customer: { name: "Kofi", phone: "0240000001" },
      status: "paid",
      stockDeducted: true, // set by fulfilShopOrder when the order was paid
    });

    const token = await makeAdminToken();
    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.data.stockRestored).toBe(true);

    const refreshedPart = await Product.findById(part._id);
    expect(refreshedPart.stock).toBe(7); // 5 + 2 restored

    // Idempotent: cancelling again (no-op transition) does not double-restock.
    const res2 = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });
    expect(res2.status).toBe(200);
    const stillPart = await Product.findById(part._id);
    expect(stillPart.stock).toBe(7);
  });

  it("restores Product stock (and variant stock) when a paid order is cancelled", async () => {
    const product = await Product.create({
      name: "Charger", slug: `charger-${Date.now()}`, price: 5000, category: "Accessory",
      stock: 3,
      variants: [{ sku: "CHG-BLK", attributes: {}, stock: 4 }],
    });
    const order = await Order.create({
      orderNumber: "EZW-T2-2",
      items: [
        { product: product._id, name: "Charger", price: 5000, qty: 1 },
        { product: product._id, variant: { sku: "CHG-BLK" }, name: "Charger (Black)", price: 5000, qty: 2 },
      ],
      subtotal: 15000,
      total: 15000,
      customer: { name: "Ama", phone: "0240000002" },
      status: "paid",
      stockDeducted: true,
    });

    const token = await makeAdminToken();
    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    const refreshed = await Product.findById(product._id);
    expect(refreshed.stock).toBe(4); // 3 + 1
    expect(refreshed.variants.find(v => v.sku === "CHG-BLK").stock).toBe(6); // 4 + 2
  });

  it("does not restock an order that was cancelled before payment (stock never deducted)", async () => {
    const part = await Product.create({
      name: "USB-C Cable", category: "Cable", partCategory: "Cable",
      stock: 5, costPrice: 500, price: 1500, useInRepairs: true});
    const order = await Order.create({
      orderNumber: "EZW-T2-3",
      items: [{ part: part._id, name: "USB-C Cable", price: 1500, qty: 1 }],
      subtotal: 1500,
      total: 1500,
      customer: { name: "Yaw", phone: "0240000003" },
      status: "pending", // never paid — fulfilShopOrder never ran, stockDeducted is false
    });

    const token = await makeAdminToken();
    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.data.stockRestored).toBe(false);
    const refreshedPart = await Product.findById(part._id);
    expect(refreshedPart.stock).toBe(5); // unchanged
  });

  it("restores Part quantity when a repair job with deducted parts is cancelled", async () => {
    const customer = await PosCustomer.create({ name: "Kwame", phone: "0240000004" });
    const part = await Product.create({
      name: "iPhone 12 Battery", category: "Battery", partCategory: "Battery",
      stock: 3, costPrice: 8000, price: 15000, useInRepairs: true});
    const job = await RepairJob.create({
      customer: customer._id,
      faultDescription: "Battery drains fast",
      status: "repairing",
      stockDeducted: true,
      parts: [{ part: part._id, name: "iPhone 12 Battery", quantity: 1, priceAtTime: 15000, costAtTime: 8000, stockDeducted: true }],
    });

    const token = await makeAdminToken();
    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    const refreshedJob = await RepairJob.findById(job._id);
    expect(refreshedJob.stockRestored).toBe(true);
    const refreshedPart = await Product.findById(part._id);
    expect(refreshedPart.stock).toBe(4); // 3 + 1 restored
  });

  it("does not restock a repair job whose parts were never deducted (stockDeducted false)", async () => {
    const customer = await PosCustomer.create({ name: "Abena", phone: "0240000005" });
    const part = await Product.create({
      name: "Charging Port", category: "Charging Port", partCategory: "Charging Port",
      stock: 3, costPrice: 2000, price: 4000, useInRepairs: true});
    const job = await RepairJob.create({
      customer: customer._id,
      faultDescription: "Won't charge",
      status: "diagnosing",
      stockDeducted: false,
      parts: [{ part: part._id, name: "Charging Port", quantity: 1, priceAtTime: 4000, costAtTime: 2000, stockDeducted: false }],
    });

    const token = await makeAdminToken();
    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${job._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    const refreshedJob = await RepairJob.findById(job._id);
    expect(refreshedJob.stockRestored).toBe(false);
    const refreshedPart = await Product.findById(part._id);
    expect(refreshedPart.stock).toBe(3); // unchanged
  });
});
