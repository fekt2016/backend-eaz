jest.mock("@paystack/paystack-sdk", () => {
  class Paystack {
    constructor() {}
    get transaction() {
      return {
        initialize: jest.fn(async () => ({
          status: true,
          data: {
            authorization_url: "https://pay.example/checkout",
            access_code: "acc_code",
            reference: "REF_VARIANT",
          },
        })),
      };
    }
  }
  return Paystack;
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const { fulfilShopOrder } = require("../utils/fulfilShopOrder");

const CLD = (n) => `https://res.cloudinary.com/demo/${n}`;

async function makeStaffToken() {
  const user = await User.create({
    name: "Staff",
    email: `staff-${Date.now()}@t.com`,
    password: "Password123!",
    role: "staff",
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function makeVariantProduct(extra = {}) {
  return Product.create({
    name: "Spigen Case",
    slug: `variant-case-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 15999,
    category: "Phone Cases & Covers",
    stock: 150,
    variants: [
      { sku: "SPG-BLK", attributes: { color: "Black" }, stock: 60, images: [CLD("black.jpg")] },
      { sku: "SPG-BLU", attributes: { color: "Blue" }, stock: 50 },
    ],
    gallery: {
      images: [CLD("g1.jpg"), CLD("g2.jpg")],
      videos: [CLD("demo.mp4")],
    },
    ...extra,
  });
}

// ── Product detail exposes structured variants + gallery ──
describe("Variants + gallery (Phase 1 & 2)", () => {
  it("serves structured variants and gallery via the product detail API", async () => {
    const product = await makeVariantProduct();

    const res = await request(app).get(`/api/v1/products/${product.slug}`);
    expect(res.status).toBe(200);

    const variants = res.body.data.variants;
    expect(Array.isArray(variants)).toBe(true);
    expect(variants).toHaveLength(2);
    expect(variants[0]).toEqual(
      expect.objectContaining({ sku: "SPG-BLK", stock: 60 }),
    );
    expect(variants[0].attributes).toEqual({ color: "Black" });
    expect(variants[0].images).toHaveLength(1);

    expect(res.body.data.gallery.images).toEqual([CLD("g1.jpg"), CLD("g2.jpg")]);
    expect(res.body.data.gallery.videos).toEqual([CLD("demo.mp4")]);
  });

  it("products without variants/gallery keep the pre-feature shape", async () => {
    const product = await Product.create({
      name: "Plain", slug: `plain-${Date.now()}`, price: 1000, category: "x", stock: 5,
    });
    const res = await request(app).get(`/api/v1/products/${product.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.variants).toEqual([]);
    // Additive only — no gallery key forces a client fallback, never an error.
    expect(res.body.data.images).toHaveLength(0);
  });
});

// ── createOrder captures the variant; clamps to variant stock ──
describe("Order creation with variants (Phase 3)", () => {
  const orderPayload = (product, qty, variant) => ({
    items: [
      { slug: product.slug, qty, ...(variant && { variant }) },
    ],
    deliveryZoneId: null,
    customer: { name: "Ama", phone: "0244000000", email: "ama@example.com" },
  });

  it("rejects qty above the selected variant's stock", async () => {
    const product = await makeVariantProduct();
    const res = await request(app)
      .post("/api/v1/orders")
      .send(orderPayload(product, 61, { sku: "SPG-BLK", attributes: { color: "Black" } }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only has 60 in stock/i);
  });

  it("stores the purchased variant on the order line", async () => {
    const product = await makeVariantProduct();
    const res = await request(app)
      .post("/api/v1/orders")
      .send(orderPayload(product, 3, { sku: "SPG-BLU", attributes: { color: "Blue" } }));
    expect(res.status).toBe(200);

    const order = await Order.findOne().sort({ _id: -1 });
    const line = order.items[0];
    expect(line.product.toString()).toBe(product._id.toString());
    expect(line.variant.sku).toBe("SPG-BLU");
    expect(Object.fromEntries(line.variant.attributes)).toEqual({ color: "Blue" });
    expect(line.name).toBe("Spigen Case");
    expect(line.qty).toBe(3);
  });

  it("non-variant products work exactly as before — no variant captured", async () => {
    const product = await Product.create({
      name: "Cable", slug: `cable-${Date.now()}`, price: 2000, category: "Chargers & Cables", stock: 10,
    });
    const res = await request(app)
      .post("/api/v1/orders")
      .send(orderPayload(product, 2));
    expect(res.status).toBe(200);

    const order = await Order.findOne().sort({ _id: -1 });
    expect(order.items[0].variant).toBeUndefined();
    expect(order.items[0].name).toBe("Cable");
  });

  it("uses the variant's own price when set, not the base product price", async () => {
    const product = await makeVariantProduct({
      variants: [
        { sku: "SPG-BLK", attributes: { color: "Black" }, stock: 60, price: 17999 },
        { sku: "SPG-BLU", attributes: { color: "Blue" }, stock: 50 },
      ],
    });
    const res = await request(app)
      .post("/api/v1/orders")
      .send(orderPayload(product, 1, { sku: "SPG-BLK", attributes: { color: "Black" } }));
    expect(res.status).toBe(200);

    const order = await Order.findOne().sort({ _id: -1 });
    expect(order.items[0].price).toBe(17999);
  });

  it("falls back to the base product price when the variant price is unset", async () => {
    const product = await makeVariantProduct();
    const res = await request(app)
      .post("/api/v1/orders")
      .send(orderPayload(product, 1, { sku: "SPG-BLU", attributes: { color: "Blue" } }));
    expect(res.status).toBe(200);

    const order = await Order.findOne().sort({ _id: -1 });
    expect(order.items[0].price).toBe(product.price);
  });

  it("respects an explicit 0 variant price as free, not as unset", async () => {
    const product = await makeVariantProduct({
      variants: [
        { sku: "SPG-BLK", attributes: { color: "Black" }, stock: 60, price: 0 },
        { sku: "SPG-BLU", attributes: { color: "Blue" }, stock: 50 },
      ],
    });
    const res = await request(app)
      .post("/api/v1/orders")
      .send(orderPayload(product, 1, { sku: "SPG-BLK", attributes: { color: "Black" } }));
    expect(res.status).toBe(200);

    const order = await Order.findOne().sort({ _id: -1 });
    expect(order.items[0].price).toBe(0);
  });
});

// ── Admin create/update preserve variants + gallery (controller whitelist) ──
describe("Admin product create/update (Phase 1/2 wiring)", () => {
  const body = {
    name: "Admin Case",
    category: "Phone Cases & Covers",
    price: 12000,
    stock: 100,
    sku: "EZW-ADM-001",
    variants: [
      { sku: "EZW-ADM-001-BLK", attributes: { color: "Black" }, stock: 60, images: [CLD("black.jpg")] },
      { sku: "EZW-ADM-001-BLU", attributes: { color: "Blue" }, stock: 40 },
    ],
    gallery: { images: [CLD("g.jpg")], videos: [CLD("demo.mp4")] },
  };

  it("create keeps variants + gallery (not dropped by the controller)", async () => {
    const token = await makeStaffToken();
    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);

    const created = await Product.findById(res.body.data._id);
    expect(created.variants).toHaveLength(2);
    expect(created.variants[0].sku).toBe("EZW-ADM-001-BLK");
    expect(created.gallery.images).toEqual([CLD("g.jpg")]);
    expect(created.gallery.videos).toEqual([CLD("demo.mp4")]);
  });

  it("update (PATCH, as the admin UI sends) preserves variants + gallery", async () => {
    const product = await makeVariantProduct({ slug: `patch-${Date.now()}` });
    const token = await makeStaffToken();

    const res = await request(app)
      .patch(`/api/v1/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        price: 14000,
        variants: [
          { sku: "SPG-BLK", attributes: { color: "Black" }, stock: 55, images: [CLD("black2.jpg")] },
          { sku: "SPG-GRN", attributes: { color: "Green" }, stock: 5 },
        ],
        gallery: { images: [CLD("g3.jpg")], videos: [CLD("v2.mp4")] },
      });
    expect(res.status).toBe(200);

    const fresh = await Product.findById(product._id);
    expect(fresh.price).toBe(14000);
    expect(fresh.variants.map((v) => v.sku)).toEqual(["SPG-BLK", "SPG-GRN"]);
    expect(fresh.variants[0].images).toEqual([CLD("black2.jpg")]);
    expect(fresh.gallery.images).toEqual([CLD("g3.jpg")]);
    expect(fresh.gallery.videos).toEqual([CLD("v2.mp4")]);
  });

  it("clearing variants back to [] works (returns to non-variant behaviour)", async () => {
    const product = await makeVariantProduct({ slug: `cleared-${Date.now()}` });
    const token = await makeStaffToken();

    const res = await request(app)
      .patch(`/api/v1/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ variants: [] });
    expect(res.status).toBe(200);

    const fresh = await Product.findById(product._id);
    expect(fresh.variants).toHaveLength(0);
  });
});

// ── fulfilShopOrder decrements variant stock, not top-level ──
describe("Fulfilment with variants (Phase 3)", () => {
  it("decrements the purchased variant's stock and keeps top-level stock in step", async () => {
    const product = await makeVariantProduct();
    const order = await Order.create({
      orderNumber: `EZW-${Date.now()}`,
      items: [
        { product: product._id, name: "Spigen Case", price: 15999, qty: 2,
          variant: { sku: "SPG-BLK", attributes: { color: "Black" } } },
      ],
      subtotal: 31998,
      total: 31998,
      customer: { name: "Ama", phone: "0244000000" },
      status: "pending",
      paystackReference: `REF_FULFIL_${Date.now()}`,
    });

    await fulfilShopOrder(order.paystackReference, { amountPesewas: order.total, currency: "GHS" });

    const fresh = await Product.findById(product._id);
    expect(fresh.variants.find((v) => v.sku === "SPG-BLK").stock).toBe(58);
    expect(fresh.variants.find((v) => v.sku === "SPG-BLU").stock).toBe(50);
    // Top-level stock follows the variants (58 + 50). It used to be left at its
    // seed value, which drifted further with every sale and reached the admin
    // edit form and the product page as more stock than existed.
    expect(fresh.stock).toBe(108);
  });
});