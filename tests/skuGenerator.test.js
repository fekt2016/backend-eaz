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

const BASE = "/api/v1/products/generate-sku";

describe("POST /generate-sku", () => {
  it("returns the next free numbered SKU for a product prefix", async () => {
    const token = await adminToken();
    await Product.create({ name: "iPhone", slug: "iphone", price: 100, category: "x", sku: "EZW-IPH-004" });

    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "product", prefix: "EZW-IPH" });

    expect(res.status).toBe(200);
    expect(res.body.data.sku).toBe("EZW-IPH-005");
  });

  it("ignores variant SKUs when numbering a product SKU (one namespace)", async () => {
    const token = await adminToken();
    await Product.create({
      name: "iPhone", slug: "iphone", price: 100, category: "x", sku: "EZW-IPH-003",
      variants: [{ sku: "EZW-IPH-099-WHT128", stock: 0 }],
    });

    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "product", prefix: "EZW-IPH" });

    expect(res.status).toBe(200);
    expect(res.body.data.sku).toBe("EZW-IPH-004");
  });

  it("returns a unique variant SKU, appending -2 when the base is taken", async () => {
    const token = await adminToken();
    await Product.create({
      name: "iPhone", slug: "iphone", price: 100, category: "x", sku: "EZW-IPH-003",
      variants: [{ sku: "EZW-IPH-003-NAT128", stock: 0 }],
    });

    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "variant", parentSku: "EZW-IPH-003", suffix: "NAT128" });

    expect(res.status).toBe(200);
    expect(res.body.data.sku).toBe("EZW-IPH-003-NAT128-2");
  });

  it("rejects a request with no prefix", async () => {
    const token = await adminToken();
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "product" });
    expect(res.status).toBe(400);
  });
});
