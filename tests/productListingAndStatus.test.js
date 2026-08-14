const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Product = require("../models/Product");
const Part = require("../models/Part");
const Order = require("../models/Order");
const User = require("../models/User");

async function makeStaff() {
  const user = await User.create({
    name: "Staff",
    email: `staff-${Date.now()}@t.com`,
    password: "Password123!",
    role: "staff",
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

// ── #12: merged product + retail-part listing, sorted/paginated in the DB ──
describe("GET /api/v1/products (merged listing)", () => {
  it("includes sellable retail parts shaped like products, priced in pesewas", async () => {
    await Product.create({
      name: "Cable", slug: "cable", price: 2000, category: "Accessory", stock: 5, isActive: true,
    });
    const part = await Part.create({
      name: "iPhone 12 Battery", category: "Battery", isRetail: true, quantity: 4,
      costPrice: 8000, sellingPrice: 15000,
    });

    const res = await request(app).get("/api/v1/products?limit=50");
    expect(res.status).toBe(200);

    const partRow = res.body.data.find((d) => d.kind === "part");
    expect(partRow).toBeTruthy();
    expect(partRow.slug).toBe(`part-${part._id}`);
    expect(partRow.price).toBe(15000); // sellingPrice pesewas, not ×100
    expect(partRow.stock).toBe(4);
    expect(res.body.total).toBe(2); // product + part
  });

  it("excludes retail parts with no stock", async () => {
    await Part.create({
      name: "Dead Stock Screen", category: "Screen", isRetail: true, quantity: 0,
      costPrice: 100, sellingPrice: 200,
    });
    const res = await request(app).get("/api/v1/products");
    expect(res.body.data.find((d) => d.kind === "part")).toBeFalsy();
  });

  it("sorts by price ascending across products and parts", async () => {
    await Product.create({ name: "Pricey", slug: "pricey", price: 90000, category: "x", stock: 1 });
    await Part.create({ name: "Cheap Part", category: "Other", isRetail: true, quantity: 2, costPrice: 100, sellingPrice: 500 });

    const res = await request(app).get("/api/v1/products?sort=price-asc&limit=50");
    const prices = res.body.data.map((d) => d.price);
    const sorted = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });
});

// ── #14: forward-only order status transitions ──
describe("PATCH /api/v1/orders/:id (status flow)", () => {
  async function makeOrder(status = "pending") {
    return Order.create({
      orderNumber: `EZW-${Date.now()}`,
      items: [{ name: "Item", price: 1000, qty: 1 }],
      subtotal: 1000, total: 1000,
      customer: { name: "A", phone: "0244000000" },
      status,
    });
  }

  it("rejects a backward transition (delivered → pending)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("delivered");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("allows a valid forward transition (pending → paid)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("pending");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("paid");
  });

  it("allows a forward skip (paid → delivered)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("paid");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "delivered" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("delivered");
  });

  it("allows cancelling a live order but not changing a cancelled one", async () => {
    const token = await makeStaff();
    const order = await makeOrder("processing");

    const cancel = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });
    expect(cancel.status).toBe(200);

    const revive = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });
    expect(revive.status).toBe(400); // cancelled is terminal
  });

  it("rejects a backward skip (shipped → paid)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("shipped");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });
    expect(res.status).toBe(400);
  });
});
