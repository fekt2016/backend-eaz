// T107: GET /products/all was `Product.find({})` — unbounded, un-`lean`, full
// hydrated documents — and the Marketplace calls it on every open. Since the
// parts/products merge that collection holds bench stock and shop stock, so it
// only grows, and the API runs on a 512MB heap.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");

async function adminToken() {
  const user = await User.create({
    name: "admin",
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role: "admin",
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function seed(n) {
  await Product.insertMany(
    Array.from({ length: n }, (_, i) => ({
      name: `Item ${String(i).padStart(3, "0")}`,
      slug: `item-${i}`,
      price: 1000 + i,
      category: "Phones",
      stock: 5,
    })),
  );
}

describe("GET /products/all — pagination (T107)", () => {
  // Owner decision (2026-08-30): every paginated list is 10 per page. This
  // endpoint defaulted to 50. What T107 protects is unchanged and is the point
  // of the test — the route is BOUNDED and reports the full total rather than
  // hydrating the collection; only the size of the bound moved.
  it("defaults to 10 per page and reports the full total", async () => {
    const token = await adminToken();
    await seed(60);

    const res = await request(app)
      .get("/api/v1/products/all")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.total).toBe(60);
    expect(res.body.pages).toBe(6);
    expect(res.body.count).toBe(10); // count stays this page's length
  });

  it("serves the remainder on page 2 without overlap", async () => {
    const token = await adminToken();
    await seed(60);

    const [p1, p2] = await Promise.all([
      request(app).get("/api/v1/products/all?page=1&limit=25").set("Authorization", `Bearer ${token}`),
      request(app).get("/api/v1/products/all?page=2&limit=25").set("Authorization", `Bearer ${token}`),
    ]);

    expect(p1.body.data).toHaveLength(25);
    expect(p2.body.data).toHaveLength(25);
    const ids = new Set([...p1.body.data, ...p2.body.data].map((d) => String(d._id)));
    expect(ids.size).toBe(50); // no document served twice
  });

  it("clamps a hostile limit rather than loading the collection", async () => {
    const token = await adminToken();
    await seed(60);

    for (const limit of ["100000", "0", "-5", "abc"]) {
      const res = await request(app)
        .get(`/api/v1/products/all?limit=${limit}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(200);
    }
  });

  it("clamps a page below 1", async () => {
    const token = await adminToken();
    await seed(5);

    const res = await request(app)
      .get("/api/v1/products/all?page=-3&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.data).toHaveLength(2);
  });
});
