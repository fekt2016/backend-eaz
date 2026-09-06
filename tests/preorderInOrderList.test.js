// The release queue is now a view of the one order list rather than a second
// page that lists orders its own way — the separate page had drifted, shipping
// without pagination or search against an endpoint capped at 10.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");

async function staffToken(role = "admin") {
  const user = await User.create({
    name: role, email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!", role, isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const base = (over = {}) => ({
  customer: { name: "Ama", email: "ama@t.com", phone: "0244000000" },
  items: [{ name: "Thing", price: 1000, qty: 1 }],
  subtotal: 1000, total: 1000, status: "paid",
  ...over,
});

async function seed() {
  const day = (n) => new Date(Date.now() - n * 86400000);
  // Oldest waiting pre-order first in real time, seeded out of order on purpose.
  await Order.create(base({ orderNumber: "N-1", createdAt: day(1), items: [{ name: "Plain", price: 1000, qty: 1 }] }));
  await Order.create(base({ orderNumber: "P-NEW", createdAt: day(2), items: [{ name: "Pre new", price: 1000, qty: 1, isPreorder: true }] }));
  await Order.create(base({ orderNumber: "P-OLD", createdAt: day(9), items: [{ name: "Pre old", price: 1000, qty: 1, isPreorder: true }] }));
  // Already released — has a pre-order line, but nothing to do.
  await Order.create(base({ orderNumber: "P-DONE", createdAt: day(5), items: [{ name: "Pre done", price: 1000, qty: 1, isPreorder: true, preorderReleasedAt: new Date() }] }));
  // Unpaid — must never appear in the queue; nothing is owed yet.
  await Order.create(base({ orderNumber: "P-UNPAID", status: "pending", createdAt: day(3), items: [{ name: "Pre unpaid", price: 1000, qty: 1, isPreorder: true }] }));
}

const nums = (res) => res.body.data.map((o) => o.orderNumber);

describe("GET /orders?preorder=", () => {
  it("pending returns only paid orders still waiting on stock", async () => {
    await seed();
    const token = await staffToken();
    const res = await request(app).get("/api/v1/orders?preorder=pending").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(nums(res)).toEqual(["P-OLD", "P-NEW"]);   // oldest first
    expect(nums(res)).not.toContain("P-DONE");      // already released
    expect(nums(res)).not.toContain("P-UNPAID");    // not paid
    expect(nums(res)).not.toContain("N-1");         // no pre-order line
  });

  it("puts the longest-waiting customer at the top, unlike the default list", async () => {
    await seed();
    const token = await staffToken();
    const queue = await request(app).get("/api/v1/orders?preorder=pending").set("Authorization", `Bearer ${token}`);
    const all = await request(app).get("/api/v1/orders").set("Authorization", `Bearer ${token}`);

    expect(nums(queue)[0]).toBe("P-OLD");
    // The plain list is newest-first, which is right for browsing and wrong for a queue.
    expect(nums(all)[0]).toBe("N-1");
  });

  it("any returns every order that has carried a pre-order line", async () => {
    await seed();
    const token = await staffToken();
    const res = await request(app).get("/api/v1/orders?preorder=any").set("Authorization", `Bearer ${token}`);
    expect(nums(res).sort()).toEqual(["P-DONE", "P-NEW", "P-OLD", "P-UNPAID"]);
  });

  it("matches what the old dedicated queue endpoint returns", async () => {
    await seed();
    const token = await staffToken();
    const viaFilter = await request(app).get("/api/v1/orders?preorder=pending").set("Authorization", `Bearer ${token}`);
    const viaPage = await request(app).get("/api/v1/orders/preorders").set("Authorization", `Bearer ${token}`);
    expect(nums(viaFilter)).toEqual(nums(viaPage));
  });

  it("leaves the unfiltered list alone", async () => {
    await seed();
    const token = await staffToken();
    const res = await request(app).get("/api/v1/orders?limit=100").set("Authorization", `Bearer ${token}`);
    expect(res.body.data).toHaveLength(5);
  });
});

describe("GET /orders/preorders/count", () => {
  it("counts the orders waiting, for the nav badge", async () => {
    await seed();
    const token = await staffToken();
    const res = await request(app).get("/api/v1/orders/preorders/count").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);  // P-OLD and P-NEW
  });

  it("is staff-only", async () => {
    const user = await User.create({ name: "c", email: `c-${Date.now()}@t.com`, password: "Password123!", role: "user", isVerified: true });
    const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
    const res = await request(app).get("/api/v1/orders/preorders/count").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
