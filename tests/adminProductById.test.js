// T109 — GET /products/id/:id, the admin get-by-id the edit form was missing.
//
// The edit page used to call GET /products/all and hunt for its record inside
// the array. T107 bounded that route at 200, so editing anything past the 200th
// newest silently found nothing and the form came up empty — no error, just a
// blank form over a product that exists. The merged collection carries bench
// parts AND shop stock, so 200 is reachable in practice.
//
// Two properties matter beyond "it returns a product":
//   1. it must serve ARCHIVED products, because archiving is exactly when an
//      admin still needs to open the record;
//   2. mounting it must not have changed what the PUBLIC /:slug route will
//      serve — that route must remain unable to return an archived item.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");

async function tokenFor(role) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await User.create({
    name: role,
    email: `${role}-${suffix}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

function productData(over = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    name: "Test Item",
    slug: `test-item-${suffix}`,
    price: 1500,
    category: "Phones",
    stock: 5,
    sellOnline: true,
    ...over,
  };
}

describe("GET /products/id/:id (T109)", () => {
  it("returns a single product by id", async () => {
    const token = await tokenFor("admin");
    const product = await Product.create(productData({ name: "Findable" }));

    const res = await request(app)
      .get(`/api/v1/products/id/${product._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Findable");
    // A single document, not a list — the whole point of the task.
    expect(Array.isArray(res.body.data)).toBe(false);
  });

  it("finds a product beyond the 200-item page cap that broke the edit form", async () => {
    const token = await tokenFor("admin");
    await Product.insertMany(
      Array.from({ length: 205 }, (_, i) => productData({ name: `Bulk ${i}`, slug: `bulk-${i}` })),
    );
    // Oldest by createdAt tie-break, i.e. last on the /all ordering — the record
    // the paginated list could never reach.
    const oldest = await Product.findOne({}).sort({ createdAt: 1, _id: 1 });

    const res = await request(app)
      .get(`/api/v1/products/id/${oldest._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(String(res.body.data._id)).toBe(String(oldest._id));
  });

  it("serves an archived product — archiving is when an admin most needs the record", async () => {
    const token = await tokenFor("admin");
    const archived = await Product.create(
      productData({ name: "Archived", isActive: false, sellOnline: false }),
    );

    const res = await request(app)
      .get(`/api/v1/products/id/${archived._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Archived");
  });

  it("404s on a malformed id rather than throwing a cast error", async () => {
    const token = await tokenFor("admin");
    const res = await request(app)
      .get("/api/v1/products/id/not-an-object-id")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("404s on an id that does not exist", async () => {
    const token = await tokenFor("admin");
    const res = await request(app)
      .get("/api/v1/products/id/64b7f1a2c3d4e5f6a7b8c9d0")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe("GET /products/id/:id is role-gated", () => {
  it("refuses an anonymous caller", async () => {
    const product = await Product.create(productData());
    const res = await request(app).get(`/api/v1/products/id/${product._id}`);
    expect(res.status).toBe(401);
  });

  it("refuses a signed-in ordinary user — this route exposes archived stock", async () => {
    const token = await tokenFor("user");
    const product = await Product.create(productData());
    const res = await request(app)
      .get(`/api/v1/products/id/${product._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("allows staff, who edit the catalogue too", async () => {
    const token = await tokenFor("staff");
    const product = await Product.create(productData());
    const res = await request(app)
      .get(`/api/v1/products/id/${product._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe("the new route does not shadow the public /:slug route", () => {
  it("a product whose slug is literally 'id' still resolves publicly", async () => {
    // `/products/id` (no trailing segment) must still hit getProductBySlug.
    await Product.create(productData({ name: "Edge", slug: "id" }));
    const res = await request(app).get("/api/v1/products/id");
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Edge");
  });

  it("the public slug route still refuses an archived product", async () => {
    // The regression that would matter most: widening admin access must not
    // have widened the public door.
    const archived = await Product.create(
      productData({ name: "Hidden", slug: "hidden-item", sellOnline: false }),
    );
    const res = await request(app).get(`/api/v1/products/${archived.slug}`);
    expect(res.status).toBe(404);
  });
});
