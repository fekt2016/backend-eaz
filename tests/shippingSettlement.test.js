// T78 Phase 5 — courier payout settlement tests.
//
// Uses the global MongoMemoryServer from tests/setup.js.
// afterEach in setup.js wipes ALL collections after every test,
// so every describe block uses `beforeEach` to recreate auth tokens and seed data.
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
            reference: `REF_SHIP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          },
        })),
      };
    }
    get refund() {
      return {
        create: jest.fn(async () => ({
          status: true,
          data: { id: 99999, status: "pending" },
        })),
        fetch: jest.fn(async () => ({
          status: true,
          data: { id: 99999, status: "pending" },
        })),
      };
    }
  }
  return Paystack;
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const CourierRate = require("../models/CourierRate");
const DeliveryCharge = require("../models/DeliveryCharge");
const ShippingZone = require("../models/ShippingZone");
const ShippingTier = require("../models/ShippingTier");
const ShippingSettings = require("../models/ShippingSettings");
const ShippingQuote = require("../models/ShippingQuote");
const { buildCartHash } = require("../models/ShippingQuote");
const { settleDeliveryCharge } = require("../services/shipping/settleDeliveryCharge");
const { shippingCache } = require("../services/shipping/shippingCache");

const BASE = "/api/v1";

/** Wait for an async DB write (best-effort settle) to land. */
async function waitForSettle(orderId, { maxMs = 2000, interval = 100 } = {}) {
  const DeliveryCharge = require("../models/DeliveryCharge");
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const doc = await DeliveryCharge.findOne({ orderId });
    if (doc) return doc;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeAdmin() {
  const user = await User.create({
    name: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role: "admin",
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function seedShippingConfig() {
  shippingCache.invalidateAll();
  await ShippingZone.create({
    name: "Accra Main", code: "ACC-MAIN", city: "Accra",
    baseRate: 1500, perKgRate: 100, distanceMinKm: 0, distanceMaxKm: 15,
    estimatedDays: 1,
    isActive: true, isDefault: true,
  });
  await ShippingTier.create({
    name: "Standard", level: 1, multiplier: 1.0,
    category: "standard", isActive: true,
  });
  await ShippingSettings.create({
    inHouseDeliveryAvailable: true, courierDispatchAvailable: true,
    expressAvailable: true, freeDeliveryThreshold: 50000,
    sameCityFee: 1500, crossCityFee: 3500,
    heavyItemFee: 2000, heavyItemThresholdKg: 5.0,
    expressSurcharge: 1500,
  });
}

async function seedProduct() {
  return Product.create({
    name: `Test Cable-${Date.now()}`, slug: `test-cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 5000, stock: 100, isActive: true, category: "Accessories",
    weight: 0.2, weightUnit: "kg",
  });
}

async function getQuote(productId) {
  const res = await request(app)
    .post(`${BASE}/shipping/quote`)
    .send({
      items: [{ productId: String(productId), quantity: 1 }],
      city: "Accra",
      neighborhood: "east legon",
      method: "courier_dispatch",
      deliverySpeed: "standard",
    });
  return res.body.data;
}

async function createOrderWithQuote(product, token) {
  const quote = await getQuote(product._id);
  const res = await request(app)
    .post(`${BASE}/orders`)
    .send({
      items: [{ slug: product.slug, qty: 1 }],
      customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
      shippingQuoteId: quote.quoteId,
      city: "Accra",
      neighborhood: "east legon",
      method: "courier_dispatch",
    });
  return { orderId: res.body.data.orderId, orderNumber: res.body.data.orderNumber };
}

// ── CourierRate.resolvePayout ─────────────────────────────────────────────

describe("CourierRate.resolvePayout", () => {
  it("percentage mode: 30% of 10000 = 3000", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: true,
    });
    expect(rate.resolvePayout(10000)).toBe(3000);
  });

  it("percentage mode: rounds to nearest integer", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: true,
    });
    // 30% of 1001 = 300.3 → rounds to 300
    expect(rate.resolvePayout(1001)).toBe(300);
  });

  it("flat mode: returns the flat amount", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "flat",
      flatAmount: 2500, isActive: true,
    });
    expect(rate.resolvePayout(10000)).toBe(2500);
  });

  it("per_zone mode: returns zone-specific amount", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "per_zone",
      zoneRates: [
        { zoneCode: "ACC-MAIN", amount: 1800 },
        { zoneCode: "ACC-EAST", amount: 2200 },
      ],
      isActive: true,
    });
    expect(rate.resolvePayout(10000, "ACC-MAIN")).toBe(1800);
    expect(rate.resolvePayout(10000, "ACC-EAST")).toBe(2200);
  });

  it("per_zone mode: falls back to default for unknown zone", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "per_zone",
      zoneRates: [{ zoneCode: "ACC-MAIN", amount: 1800 }],
      isActive: true,
    });
    // Unknown zone → fallback to HARDCOURT_DEFAULT_PERCENTAGE (30%)
    expect(rate.resolvePayout(10000, "ACC-UNKNOWN")).toBe(3000);
  });

  it("inactive config: falls back to default percentage", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: false,
    });
    expect(rate.resolvePayout(10000)).toBe(3000);
  });

  it("returns 0 when shipping fee is 0", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: true,
    });
    expect(rate.resolvePayout(0)).toBe(0);
  });

  it("fallback: returns non-zero for positive fee even with broken config", async () => {
    const rate = await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 0, isActive: true,
    });
    // percentage=0 → fallback to default 30%
    expect(rate.resolvePayout(10000)).toBe(3000);
  });

  it("CourierRate.getOrCreate creates if missing", async () => {
    const rate = await CourierRate.getOrCreate();
    expect(rate).toBeTruthy();
    expect(rate.code).toBe("COURIER_PAYOUT");
    // Second call returns the same doc
    const rate2 = await CourierRate.getOrCreate();
    expect(rate2._id.toString()).toBe(rate._id.toString());
  });
});

// ── DeliveryCharge model ──────────────────────────────────────────────────

describe("DeliveryCharge model", () => {
  it("invariant: courierPayout + retainedMargin === shippingFeeCollected", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const doc = await DeliveryCharge.create({
      orderId,
      shippingFeeCollected: 5000,
      courierPayout: 1500,
      retainedMargin: 3500,
      mode: "percentage",
    });
    expect(doc.courierPayout + doc.retainedMargin).toBe(doc.shippingFeeCollected);
  });

  it("rejects when invariant is violated", async () => {
    const orderId = new mongoose.Types.ObjectId();
    await expect(
      DeliveryCharge.create({
        orderId,
        shippingFeeCollected: 5000,
        courierPayout: 1500,
        retainedMargin: 2000, // 1500 + 2000 ≠ 5000
        mode: "percentage",
      }),
    ).rejects.toThrow();
  });

  it("allows negative margin (surfaced, not clamped)", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const doc = await DeliveryCharge.create({
      orderId,
      shippingFeeCollected: 1000,
      courierPayout: 1500,
      retainedMargin: -500,
      mode: "flat",
    });
    expect(doc.retainedMargin).toBe(-500);
    expect(doc.courierPayout + doc.retainedMargin).toBe(doc.shippingFeeCollected);
  });

  it("settle() is idempotent — second call returns existing", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const first = await DeliveryCharge.settle(orderId, {
      shippingFeeCollected: 3000,
      courierPayout: 900,
      retainedMargin: 2100,
      mode: "percentage",
    });
    const second = await DeliveryCharge.settle(orderId, {
      shippingFeeCollected: 3000,
      courierPayout: 900,
      retainedMargin: 2100,
      mode: "percentage",
    });
    expect(second._id.toString()).toBe(first._id.toString());
  });

  it("unique orderId prevents duplicate settlements", async () => {
    const orderId = new mongoose.Types.ObjectId();
    await DeliveryCharge.create({
      orderId,
      shippingFeeCollected: 2000,
      courierPayout: 600,
      retainedMargin: 1400,
      mode: "percentage",
    });
    await expect(
      DeliveryCharge.create({
        orderId,
        shippingFeeCollected: 2000,
        courierPayout: 600,
        retainedMargin: 1400,
        mode: "percentage",
      }),
    ).rejects.toThrow();
  });
});

// ── settleDeliveryCharge service ───────────────────────────────────────────

describe("settleDeliveryCharge service", () => {
  let product;
  let adminToken;

  beforeEach(async () => {
    adminToken = await makeAdmin();
    await seedShippingConfig();
    await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: true,
    });
    product = await seedProduct();
  });

  it("computes payout from CourierRate and creates DeliveryCharge", async () => {
    const order = await Order.create({
      orderNumber: "SETTLE-001",
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price + 3000,
      status: "delivered",
      shippingFee: 3000,
      shippingZoneCode: "ACC-MAIN",
      shippingMethod: "in_house_delivery",
      customer: { name: "Test", phone: "0244000000" },
    });

    const charge = await settleDeliveryCharge(order);
    expect(charge).toBeTruthy();
    expect(charge.shippingFeeCollected).toBe(3000);
    expect(charge.courierPayout).toBe(900);
    expect(charge.retainedMargin).toBe(2100);
    expect(charge.method).toBe("in_house_delivery");
    expect(charge.zoneCode).toBe("ACC-MAIN");
  });

  it("returns null when shipping fee is 0", async () => {
    const order = await Order.create({
      orderNumber: "SETTLE-002",
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price,
      status: "delivered",
      shippingFee: 0,
      customer: { name: "Test", phone: "0244000000" },
    });

    const charge = await settleDeliveryCharge(order);
    expect(charge).toBeNull();
  });

  it("is idempotent — calling twice returns same record", async () => {
    const order = await Order.create({
      orderNumber: "SETTLE-003",
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price + 2000,
      status: "delivered",
      shippingFee: 2000,
      customer: { name: "Test", phone: "0244000000" },
    });

    const first = await settleDeliveryCharge(order);
    const second = await settleDeliveryCharge(order);
    expect(second._id.toString()).toBe(first._id.toString());
  });
});

// ── Settlement triggered on order status → delivered ──────────────────────

describe("Settlement on delivered status", () => {
  let adminToken;
  let product;

  beforeEach(async () => {
    adminToken = await makeAdmin();
    await seedShippingConfig();
    await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: true,
    });
    product = await seedProduct();
  });

  it("creates a DeliveryCharge when updateOrderStatus → delivered", async () => {
    const { orderId } = await createOrderWithQuote(product, adminToken);
    const order = await Order.findById(orderId);

    // Ship first (can't jump to delivered from processing)
    await request(app)
      .patch(`${BASE}/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "shipped" });

    // Deliver
    await request(app)
      .patch(`${BASE}/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "delivered" });

    // Allow best-effort async settle to complete (retries up to 2s)
    const charge = await waitForSettle(order._id);
    expect(charge).toBeTruthy();
    expect(charge.shippingFeeCollected).toBeGreaterThan(0);
    expect(charge.courierPayout + charge.retainedMargin).toBe(charge.shippingFeeCollected);
  });

  it("creates a DeliveryCharge via addTrackingEvent → delivered", async () => {
    const { orderId } = await createOrderWithQuote(product, adminToken);
    const order = await Order.findById(orderId);

    // Ship first
    await request(app)
      .patch(`${BASE}/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "shipped" });

    // Deliver via tracking event
    await request(app)
      .post(`${BASE}/orders/${orderId}/tracking`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "delivered", note: "Left at door" });

    const charge = await waitForSettle(order._id);
    expect(charge).toBeTruthy();
    expect(charge.courierPayout + charge.retainedMargin).toBe(charge.shippingFeeCollected);
  });
});

// ── DeliveryCharge refund on order refund ─────────────────────────────────

describe("DeliveryCharge refund on order refund", () => {
  let adminToken;
  let product;

  beforeEach(async () => {
    adminToken = await makeAdmin();
    await seedShippingConfig();
    await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: true,
    });
    product = await seedProduct();
  });

  it("marks DeliveryCharge as refunded when order is refunded", async () => {
    const { orderId } = await createOrderWithQuote(product, adminToken);
    const order = await Order.findById(orderId);

    // Create a mock Paystack reference
    order.paystackReference = "ref_test_" + Date.now();
    await order.save();

    // Ship → deliver
    await request(app)
      .patch(`${BASE}/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "shipped" });
    await request(app)
      .patch(`${BASE}/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "delivered" });

    // Verify charge exists
    const charge = await waitForSettle(order._id);
    expect(charge).toBeTruthy();
    expect(charge.refunded).toBe(false);

    // Refund the order
    await request(app)
      .post(`${BASE}/orders/${orderId}/refund`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Test refund" });
    await new Promise((r) => setTimeout(r, 300));

    const updatedCharge = await DeliveryCharge.findOne({ orderId: order._id });
    expect(updatedCharge.refunded).toBe(true);
    expect(updatedCharge.refundedAt).toBeTruthy();
  });
});

// ── Admin endpoints ──────────────────────────────────────────────────────

describe("Admin delivery-charge endpoints", () => {
  let adminToken;
  let product;

  beforeEach(async () => {
    adminToken = await makeAdmin();
    await seedShippingConfig();
    await CourierRate.create({
      code: "COURIER_PAYOUT", mode: "percentage",
      percentage: 30, isActive: true,
    });
    product = await seedProduct();
  });

  it("GET /admin/shipping/delivery-charges returns summary", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/delivery-charges`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toBeDefined();
    expect(res.body.data.byZone).toBeDefined();
    expect(res.body.data.byMethod).toBeDefined();
  });

  it("GET /admin/shipping/delivery-charges filters by method", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/delivery-charges?method=in_house_delivery`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.byMethod)).toBe(true);
  });

  it("PATCH /admin/shipping/delivery-charges/:id/refund marks as refunded", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const charge = await DeliveryCharge.create({
      orderId,
      shippingFeeCollected: 5000,
      courierPayout: 1500,
      retainedMargin: 3500,
      mode: "percentage",
    });

    const res = await request(app)
      .patch(`${BASE}/admin/shipping/delivery-charges/${charge._id}/refund`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.refunded).toBe(true);
  });

  it("PATCH /admin/shipping/delivery-charges/:id/refund rejects if already refunded", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const charge = await DeliveryCharge.create({
      orderId,
      shippingFeeCollected: 5000,
      courierPayout: 1500,
      retainedMargin: 3500,
      mode: "percentage",
      refunded: true,
      refundedAt: new Date(),
    });

    const res = await request(app)
      .patch(`${BASE}/admin/shipping/delivery-charges/${charge._id}/refund`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it("summary rejects unauthenticated access", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/delivery-charges`);
    expect(res.status).toBe(401);
  });

  it("GET /admin/shipping/courier-rate returns or creates config", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/courier-rate`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe("COURIER_PAYOUT");
  });
});
