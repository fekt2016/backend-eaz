const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Product = require("../models/Product");
const User = require("../models/User");

// T39: the product page shows a short summary in the buy column and the full
// description behind a tab. `shortDescription` is the editor-authored summary.
async function makeStaff() {
  const user = await User.create({
    name: "Staff",
    email: `staff-${Date.now()}@t.com`,
    password: "Password123!",
    role: "staff",
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const base = {
  name: "Test Widget",
  slug: "test-widget",
  price: 1500,
  category: "widgets",
  stock: 10,
};

describe("Product.shortDescription (T39)", () => {
  it("persists shortDescription when a product is created", async () => {
    const token = await makeStaff();

    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, description: "The long one.", shortDescription: "The short one." });

    expect(res.status).toBe(201);
    expect(res.body.data.shortDescription).toBe("The short one.");
    expect(res.body.data.description).toBe("The long one.");
  });

  it("defaults to an empty string when omitted, so existing products stay valid", async () => {
    const token = await makeStaff();

    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, description: "Only a long one." });

    expect(res.status).toBe(201);
    expect(res.body.data.shortDescription).toBe("");
  });

  it("updates shortDescription without touching the full description", async () => {
    const token = await makeStaff();
    const product = await Product.create({ ...base, description: "Long.", shortDescription: "Old." });

    const res = await request(app)
      .put(`/api/v1/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ shortDescription: "New." });

    expect(res.status).toBe(200);
    expect(res.body.data.shortDescription).toBe("New.");
    expect(res.body.data.description).toBe("Long.");
  });

  it("rejects a short description longer than 200 characters", async () => {
    const token = await makeStaff();

    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, shortDescription: "x".repeat(201) });

    // Assert the validation status specifically — a bare `>= 400` would also pass
    // on a 401, hiding a broken-auth test rather than proving the maxlength works.
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await Product.countDocuments({})).toBe(0);
  });

  it("returns shortDescription on the public detail endpoint the page reads", async () => {
    await Product.create({
      ...base,
      isActive: true,
      description: "Long.",
      shortDescription: "Summary for the buy column.",
    });

    const res = await request(app).get(`/api/v1/products/${base.slug}`);

    expect(res.status).toBe(200);
    expect(res.body.data.shortDescription).toBe("Summary for the buy column.");
  });
});
