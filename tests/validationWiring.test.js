// T126 — wiring validation schemas to routes, covering both the existing
// auth/shipping schemas (Part 1) and the customer-write cart/order/review
// schemas (Part 2). Each case hits the route and asserts that a malformed
// body is rejected at the edge with a 400 and field detail, BEFORE any real
// work is done by the controller.
//
// Part 1 note: `.partial()` does NOT remove `.default()`, so wiring a PATCH
// schema naively would reset untouched fields. Each shipping PATCH asserts
// untouched fields to guard against that.
//
// Part 2 note: `createOrderSchema` uses `.passthrough()` so the schema
// never strips fields the controller needs downstream.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const ShippingZone = require("../models/ShippingZone");
const Order = require("../models/Order");

const BASE = "/api/v1";

async function makeAdmin() {
  const user = await User.create({
    name: "admin",
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role: "admin",
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function makeToken(role = "user") {
  const user = await User.create({
    name: "Schema Tester",
    email: `schema-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

// ── Part 1 — auth + shipping schemas (originally wired by T109) ────────────

describe("auth routes — schemas are actually applied", () => {
  it("rejects a login with no password", async () => {
    const res = await request(app).post(`${BASE}/auth/login`).send({ email: "a@b.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.errors.map((e) => e.message).join(" ")).toMatch(/password/i);
  });

  it("still accepts a phone number typed into the email field", async () => {
    const res = await request(app)
      .post(`${BASE}/auth/login`)
      .send({ email: "0241234567", password: "Password123!" });

    expect(res.body.error).not.toBe("Validation failed");
  });

  it("rejects a malformed email on forgot-password", async () => {
    const res = await request(app)
      .post(`${BASE}/auth/forgot-password`)
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("accepts a padded email on forgot-password, which the controller sanitizes", async () => {
    const res = await request(app)
      .post(`${BASE}/auth/forgot-password`)
      .send({ email: "  nobody@eaz.test  " });

    expect(res.body.error).not.toBe("Validation failed");
  });

  it("rejects a reset password under 8 characters", async () => {
    const res = await request(app)
      .patch(`${BASE}/auth/reset-password/sometoken`)
      .send({ password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("admin shipping PATCH — an update must not reset untouched fields", () => {
  let token;
  beforeEach(async () => {
    token = await makeAdmin();
  });

  it("renames a zone without resetting its pricing", async () => {
    const zone = await ShippingZone.create({
      name: "Original",
      code: "ZONE-A",
      city: "Accra",
      baseRate: 1500,
      perKgRate: 250,
      sameDayMultiplier: 1.9,
      estimatedDays: 2,
      isActive: true,
    });

    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/zones/${zone._id}`),
      token,
    ).send({ name: "Renamed" });

    expect(res.status).toBe(200);

    const after = await ShippingZone.findById(zone._id).lean();
    expect(after.name).toBe("Renamed");
    expect(after.baseRate).toBe(1500);
    expect(after.perKgRate).toBe(250);
    expect(after.sameDayMultiplier).toBe(1.9);
    expect(after.isActive).toBe(true);
  });

  it("rejects a non-numeric rate", async () => {
    const zone = await ShippingZone.create({
      name: "Z", code: "ZONE-B", city: "Accra", baseRate: 100, estimatedDays: 1,
    });

    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/zones/${zone._id}`),
      token,
    ).send({ baseRate: "not-a-number" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");

    const after = await ShippingZone.findById(zone._id).lean();
    expect(after.baseRate).toBe(100);
  });

  it("rejects an unknown courier-rate mode", async () => {
    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/courier-rate`),
      token,
    ).send({ mode: "nonsense" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("accepts a courier-rate edit that omits the otherwise-required mode", async () => {
    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/courier-rate`),
      token,
    ).send({ isActive: false });

    expect(res.status).toBe(200);
  });
});

// ── Part 2 — customer-write cart, order, and review schemas (T126) ──────────

describe("T126 — Zod validation wiring on customer write endpoints", () => {
  describe("cart (PUT /, PATCH /items, PATCH /merge)", () => {
    it("rejects a PUT /cart with no items array", async () => {
      const token = await makeToken();
      const res = await request(app)
        .put(`${BASE}/cart`)
        .set("Cookie", [`token=${token}`])
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe("items");
    });

    it("rejects a PATCH /cart/items line missing required fields", async () => {
      const token = await makeToken();
      const res = await request(app)
        .patch(`${BASE}/cart/items`)
        .set("Cookie", [`token=${token}`])
        .send({ slug: "x" });
      expect(res.status).toBe(400);
    });

    it("accepts a well-formed PATCH /cart/items line", async () => {
      const token = await makeToken();
      const res = await request(app)
        .patch(`${BASE}/cart/items`)
        .set("Cookie", [`token=${token}`])
        .send({ lineId: "cable", slug: "cable", name: "USB Cable", price: 2000, qty: 2 });
      expect(res.status).toBe(200);
    });

    it("rejects a PATCH /cart/merge without an items array", async () => {
      const token = await makeToken();
      const res = await request(app)
        .patch(`${BASE}/cart/merge`)
        .set("Cookie", [`token=${token}`])
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe("items");
    });
  });

  describe("orders (POST / and POST /track)", () => {
    it("rejects POST /orders with no items", async () => {
      const res = await request(app)
        .post(`${BASE}/orders`)
        .send({ customer: { name: "Ama", phone: "0241234567" } });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe("items");
    });

    it("rejects POST /orders with no customer at all", async () => {
      const res = await request(app)
        .post(`${BASE}/orders`)
        .send({ items: [{ slug: "cable", qty: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe("customer");
    });

    it("rejects POST /orders with an empty item list (not persisted)", async () => {
      const res = await request(app)
        .post(`${BASE}/orders`)
        .send({ items: [], customer: { name: "Ama", phone: "0241234567" } });
      expect(res.status).toBe(400);
      const count = await Order.countDocuments();
      expect(count).toBe(0);
    });

    it("rejects POST /track missing a phone", async () => {
      const res = await request(app)
        .post(`${BASE}/orders/track`)
        .send({ orderNumber: "EZW-1" });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe("phone");
    });
  });

  describe("product reviews (submit + update)", () => {
    it("rejects an out-of-range rating on submit", async () => {
      const token = await makeToken();
      const res = await request(app)
        .post(`${BASE}/products/6a9377b3e842391fcae57fb7/reviews`)
        .set("Cookie", [`token=${token}`])
        .send({ rating: 7, comment: "This is a fine product" });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe("rating");
    });

    it("rejects a too-short comment on submit", async () => {
      const token = await makeToken();
      const res = await request(app)
        .post(`${BASE}/products/6a9377b3e842391fcae57fb7/reviews`)
        .set("Cookie", [`token=${token}`])
        .send({ rating: 5, comment: "short" });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe("comment");
    });

    it("rejects an empty update body", async () => {
      const token = await makeToken();
      const res = await request(app)
        .patch(`${BASE}/products/6a9377b3e842391fcae57fb7/reviews/mine`)
        .set("Cookie", [`token=${token}`])
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
