const request = require("supertest");
const app = require("../app");
const Product = require("../models/Product");

// Prices are integer pesewas (GH₵1.00 = 100).
function makeProduct(overrides = {}) {
  return {
    name: "Test Widget",
    slug: "test-widget",
    price: 1500, // GH₵15.00
    category: "widgets",
    stock: 10,
    isActive: true,
    ...overrides,
  };
}

describe("GET /api/v1/products", () => {
  it("returns only active products with the list envelope", async () => {
    await Product.create([
      makeProduct({ name: "Active A", slug: "active-a" }),
      makeProduct({ name: "Inactive B", slug: "inactive-b", isActive: false }),
    ]);

    const res = await request(app).get("/api/v1/products");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe("active-a");
    expect(res.body).toHaveProperty("total", 1);
    expect(res.body).toHaveProperty("page", 1);
  });

  it("clamps the page size via the limit query param", async () => {
    await Product.create(
      Array.from({ length: 5 }, (_, i) =>
        makeProduct({ name: `P${i}`, slug: `p-${i}` }),
      ),
    );

    const res = await request(app).get("/api/v1/products?limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.pages).toBe(3);
  });

  it("treats regex metacharacters in ?q= literally (ReDoS-safe)", async () => {
    await Product.create([
      makeProduct({ name: "Alpha", slug: "alpha" }),
      makeProduct({ name: "Beta", slug: "beta" }),
    ]);

    // Unescaped, ".*" would match every product; escaped, it matches none.
    const res = await request(app).get("/api/v1/products?q=.*");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("GET /api/v1/products/:slug", () => {
  it("404s for an unknown slug", async () => {
    const res = await request(app).get("/api/v1/products/nope");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
