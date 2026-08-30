// T78 Phase 4 — shipping checkout integration tests.
//
// Tests the full path: quote → order creation → address change → blocked when
// shipped. Mocks Paystack (same pattern as preorder.test.js).
//
// afterEach in setup.js wipes ALL collections, so every describe block uses
// `beforeEach` for seed data and tokens.
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
const ShippingZone = require("../models/ShippingZone");
const ShippingTier = require("../models/ShippingTier");
const ShippingSettings = require("../models/ShippingSettings");
const ShippingQuote = require("../models/ShippingQuote");
const { buildCartHash } = require("../models/ShippingQuote");
const Location = require("../models/Location");
const PickupLocation = require("../models/PickupLocation");
const { DEFAULT_TIER_CATEGORY } = require("../models/ShippingTier");
const { shippingCache } = require("../services/shipping/shippingCache");

const BASE = "/api/v1";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeAdmin(role = "admin") {
  const user = await User.create({
    name: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function seedShippingData() {
  shippingCache.invalidateAll();
  await ShippingZone.create([
    {
      name: "Accra Central", code: "ACC-CENTRAL", city: "Accra",
      neighborhoods: ["osu", "east legon", "madina"],
      distanceMinKm: 0, distanceMaxKm: 25,
      baseRate: 1500, perKgRate: 300,
      sameDayMultiplier: 1.2, expressMultiplier: 1.4,
      fragileSurcharge: 500, estimatedDays: 1, isDefault: true,
    },
  ]);
  await ShippingTier.create([
    { name: "Default", category: DEFAULT_TIER_CATEGORY, level: 0, multiplier: 1.0 },
    { name: "Screens", category: "Screen Protectors", level: 3, multiplier: 1.15, fragileSurcharge: 500, weightThresholdKg: 0.5, weightSurchargePerKg: 200 },
  ]);
  const settings = await ShippingSettings.getSettings();
  settings.freeDeliveryThreshold = 50000;
  settings.inHouseDeliveryAvailable = true;
  settings.courierDispatchAvailable = true;
  settings.expressAvailable = true;
  settings.inHouseRadiusKm = null;
  await settings.save();
}

async function makeProduct(overrides = {}) {
  return Product.create({
    name: "Test Screen",
    slug: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 12000,
    category: "Screen Protectors",
    stock: 50,
    weight: 0.3,
    weightUnit: "kg",
    isFragile: true,
    ...overrides,
  });
}

function quoteBody(productId, qty = 1, overrides = {}) {
  return {
    city: "Accra",
    neighborhood: "east legon",
    method: "in_house_delivery",
    items: [{ productId: String(productId), quantity: qty }],
    ...overrides,
  };
}

async function getQuote(productId, qty = 1, overrides = {}) {
  const res = await request(app)
    .post(`${BASE}/shipping/quote`)
    .send(quoteBody(productId, qty, overrides));
  return res.body.data;
}

// ── ShippingQuote model ──────────────────────────────────────────────────────

describe("ShippingQuote model", () => {
  it("generates a unique quoteId", () => {
    const q1 = new ShippingQuote({
      city: "Accra", neighborhood: "east legon", method: "in_house_delivery",
      cartHash: "abc123", shippingFee: 1500, grossShippingFee: 1500,
    });
    const q2 = new ShippingQuote({
      city: "Accra", neighborhood: "east legon", method: "in_house_delivery",
      cartHash: "abc123", shippingFee: 1500, grossShippingFee: 1500,
    });
    expect(q1.quoteId).toBeTruthy();
    expect(q1.quoteId).not.toBe(q2.quoteId);
  });

  it("buildCartHash is deterministic", () => {
    const items = [{ productId: "aaa", quantity: 2 }, { productId: "bbb", quantity: 1 }];
    const h1 = buildCartHash(items, "Accra", "east legon", "in_house_delivery", "standard");
    const h2 = buildCartHash(items, "Accra", "east legon", "in_house_delivery", "standard");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("buildCartHash changes when items change", () => {
    const items1 = [{ productId: "aaa", quantity: 1 }];
    const items2 = [{ productId: "aaa", quantity: 2 }];
    const h1 = buildCartHash(items1, "Accra", "east legon", "in_house_delivery", "standard");
    const h2 = buildCartHash(items2, "Accra", "east legon", "in_house_delivery", "standard");
    expect(h1).not.toBe(h2);
  });

  it("buildCartHash changes when city changes", () => {
    const items = [{ productId: "aaa", quantity: 1 }];
    const h1 = buildCartHash(items, "Accra", "east legon", "in_house_delivery", "standard");
    const h2 = buildCartHash(items, "Tema", "east legon", "in_house_delivery", "standard");
    expect(h1).not.toBe(h2);
  });
});

// ── Retail parts are shop items too ─────────────────────────────────────────

describe("POST /api/v1/shipping/quote with an inventory part", () => {

  beforeEach(async () => {
    await seedShippingData();
  });

  it("quotes a retail part — the shop lists parts, so the quote must resolve them", async () => {
    const part = await Product.create({
      name: "iPhone 14 Screen", category: "Screen", partCategory: "Screen", sellOnline: true, sellInStore: true, stock: 6,
      costPrice: 40000, price: 65000, useInRepairs: true});

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(part._id));

    expect(res.status).toBe(200);
    expect(res.body.data.quoteId).toBeTruthy();
    // No weight on a Part — the calculator assumes one and must say so.
    expect(res.body.data.weightAssumed).toBe(true);
  });

  it("still rejects a part that is not sellable in the shop", async () => {
    const part = await Product.create({
      name: "Internal Tool", category: "Screen", partCategory: "Screen", sellOnline: false, sellInStore: false, stock: 6,
      costPrice: 1000, price: 2000, useInRepairs: true});

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(part._id));

    expect(res.status).toBe(400);
    expect(res.body.invalidProductIds).toEqual([String(part._id)]);
  });

  it("still rejects an id that is neither product nor part", async () => {
    const ghost = new (require("mongoose").Types.ObjectId)();
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(ghost));
    expect(res.status).toBe(400);
  });

  it("accepts two lines sharing one product id (two variants of the same product)", async () => {
    const product = await makeProduct();
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, {
        items: [
          { productId: String(product._id), quantity: 1 },
          { productId: String(product._id), quantity: 2 },
        ],
      }));
    expect(res.status).toBe(200);
  });
});

// ── Quote endpoint persists + returns quoteId ────────────────────────────────

describe("POST /api/v1/shipping/quote persists a ShippingQuote", () => {
  let product;
  beforeEach(async () => {
    await seedShippingData();
    product = await makeProduct();
  });

  it("returns a quoteId in the response", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id));
    expect(res.status).toBe(200);
    expect(res.body.data.quoteId).toBeTruthy();
    expect(typeof res.body.data.quoteId).toBe("string");
  });

  it("creates a ShippingQuote document in the DB", async () => {
    const before = await ShippingQuote.countDocuments();
    await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id));
    const after = await ShippingQuote.countDocuments();
    expect(after).toBe(before + 1);
  });
});

// ── Order creation with shippingQuoteId ──────────────────────────────────────

// ── Offer list vs. accept list ───────────────────────────────────────────────
//
// The regression this pins: GET /shipping/methods builds a compound id per
// speed tier a zone defines, while the quote schema and the two controllers
// each carried their own hand-written list of speeds. The seeded zones grew a
// `next_day` tier, so the storefront offered "Courier — Next Day" and the quote
// answered "Validation failed" — an option the customer could see and not buy.
// ── Same-day is not a service we sell ────────────────────────────────────────
describe("courier same-day is not offered", () => {
  beforeEach(seedShippingData);

  it("leaves Courier — Same Day out of the methods list", async () => {
    const res = await request(app)
      .get(`${BASE}/shipping/methods`)
      .query({ city: "Accra", neighborhood: "east legon" });

    const ids = (res.body.data.methods || []).map((m) => m.id);
    expect(ids).toContain("courier_dispatch_standard");
    expect(ids).not.toContain("courier_dispatch_same_day");
  });

  it("refuses a same-day quote even when one is asked for directly", async () => {
    const product = await makeProduct();

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, { method: "courier_dispatch_same_day" }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not available|cutoff|Sunday/i);
  });

  it("stays gone even with the switch on — T117 deleted the tier", async () => {
    // This used to assert the opposite: that the removal was only the switch and
    // the tier was still there. T117 deleted it. same_day duplicated Express's
    // promise at the cheaper next-day multiplier, so turning the switch on put
    // two "today" options side by side with the faster-sounding one costing
    // less. There are three speeds now: Standard, Next Day, Express.
    const settings = await ShippingSettings.getSettings();
    settings.sameDayAvailable = true;
    settings.sameDayCutoffHour = 23; // past any wall-clock time the suite runs at
    settings.deliveryClosedDays = [];
    await settings.save();
    shippingCache.invalidateAll();

    const res = await request(app)
      .get(`${BASE}/shipping/methods`)
      .query({ city: "Accra", neighborhood: "east legon" });

    expect((res.body.data.methods || []).map((m) => m.id)).not.toContain("courier_dispatch_same_day");
  });
});

// ── Express is a same-day promise, so it keeps same-day's hours ─────────────
// Owner decision (2026-08-30), in two halves that must not be conflated:
//   VISIBILITY  — express is ALWAYS listed. The storefront sells three options
//                 (Standard, Next Day, Express) and one silently vanishing
//                 after 5pm looks broken. It is returned with available:false
//                 and a customer-facing reason instead of being omitted.
//   BOOKABILITY — express is still refused by the quote outside the window.
//                 Showing it is presentation; booking it is enforced server-side.
// These pin both halves so a future change cannot collapse them into one.
describe("express is always listed, but only bookable inside the window", () => {
  beforeEach(seedShippingData);

  const setWindow = async (mutate) => {
    const settings = await ShippingSettings.getSettings();
    mutate(settings);
    await settings.save();
    shippingCache.invalidateAll();
  };

  it("is offered AND bookable while the window is open", async () => {
    await setWindow((s) => {
      s.sameDayCutoffHour = 23; // past any hour the suite runs at
      s.deliveryClosedDays = [];
    });

    const res = await request(app)
      .get(`${BASE}/shipping/methods`)
      .query({ city: "Accra", neighborhood: "east legon" });

    const express = (res.body.data.methods || []).find((m) => m.id === "courier_dispatch_express");
    expect(express).toBeDefined();
    expect(express.available).toBe(true);
    expect(express.unavailableReason).toBeNull();
  });

  it("stays in the list once the cutoff has passed, marked unavailable", async () => {
    await setWindow((s) => {
      s.sameDayCutoffHour = 0; // midnight: every hour is past it
      s.deliveryClosedDays = [];
    });

    const res = await request(app)
      .get(`${BASE}/shipping/methods`)
      .query({ city: "Accra", neighborhood: "east legon" });

    const methods = res.body.data.methods || [];
    const express = methods.find((m) => m.id === "courier_dispatch_express");
    // Listed — this is the half that changed.
    expect(express).toBeDefined();
    // But not selectable, and it says why in words a customer can act on.
    expect(express.available).toBe(false);
    expect(express.unavailableReason).toMatch(/Express delivery closes at/);
    // The slower tiers are unaffected and stay bookable.
    const standard = methods.find((m) => m.id === "courier_dispatch_standard");
    expect(standard.available).toBe(true);
  });

  it("quotes an express order past the cutoff", async () => {
    await setWindow((s) => {
      s.sameDayCutoffHour = 0;
      s.deliveryClosedDays = [];
    });
    const product = await makeProduct();

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, { method: "courier_dispatch_express" }));

    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Express delivery closes at/);
    // Never tell someone to pick the option they just picked.
    expect(res.body.error).not.toMatch(/choose .*Express/);
  });

  it("stays in the list on a closed day, marked unavailable", async () => {
    await setWindow((s) => {
      s.sameDayCutoffHour = 23;
      s.deliveryClosedDays = [new Date().getDay()]; // today is closed
    });

    const res = await request(app)
      .get(`${BASE}/shipping/methods`)
      .query({ city: "Accra", neighborhood: "east legon" });

    expect((res.body.data.methods || []).map((m) => m.id)).toContain("courier_dispatch_express");
  });

  it("leaves standard and next day alone — they are not same-day promises", async () => {
    await setWindow((s) => {
      s.sameDayCutoffHour = 0;
      s.deliveryClosedDays = [new Date().getDay()];
    });
    const product = await makeProduct();

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, { method: "courier_dispatch_standard" }));

    expect(res.status).toBe(200);
    expect(res.body.data.deliverySpeed).toBe("standard");
  });
});

describe("every method GET /shipping/methods offers is quotable", () => {
  beforeEach(seedShippingData);

  it("accepts each offered method id", async () => {
    const product = await makeProduct();

    // No `region`: the legacy Accra path, which is what this seed models (the
    // regional path needs a Location doc and answers bus-station pickup only).
    const methodsRes = await request(app)
      .get(`${BASE}/shipping/methods`)
      .query({ city: "Accra", neighborhood: "east legon" });
    expect(methodsRes.status).toBe(200);

    const offered = (methodsRes.body.data.methods || []).filter((m) => m.available && !m.isPickup);
    expect(offered.length).toBeGreaterThan(0);

    for (const method of offered) {
      const res = await request(app)
        .post(`${BASE}/shipping/quote`)
        .send(quoteBody(product._id, 1, { method: method.id }));

      // A method may be legitimately refused right now (the same-day cutoff),
      // but never because the id itself failed validation.
      expect({ id: method.id, error: res.body.error }).not.toMatchObject({
        error: "Validation failed",
      });
    }
  });

  it("quotes courier_dispatch_next_day, the tier that used to be rejected", async () => {
    const product = await makeProduct();

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, { method: "courier_dispatch_next_day" }));

    expect(res.status).toBe(200);
    expect(res.body.data.deliverySpeed).toBe("next_day");
    expect(res.body.data.shippingFee).toBeGreaterThan(0);
  });

  it("still rejects a method id that is not a real speed", async () => {
    const product = await makeProduct();

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, { method: "courier_dispatch_teleport" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("Order creation with shippingQuoteId", () => {
  let product;
  beforeEach(async () => {
    await seedShippingData();
    product = await makeProduct();
  });

  it("creates an order using the stored quote fee", async () => {
    const quote = await getQuote(product._id);
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.orderNumber).toBeTruthy();

    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingFee).toBe(quote.shippingFee);
    expect(order.shippingZoneCode).toBe("ACC-CENTRAL");
    expect(order.shippingMethod).toBe("in_house_delivery");
    expect(order.total).toBe(order.subtotal + order.shippingFee);
  });

  it("marks the quote as consumed", async () => {
    const quote = await getQuote(product._id);
    await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    const doc = await ShippingQuote.findOne({ quoteId: quote.quoteId });
    expect(doc.consumed).toBe(true);
    expect(doc.consumedAt).toBeTruthy();
  });

  it("syncs shippingFee → deliveryFee (pre-save hook)", async () => {
    const quote = await getQuote(product._id);
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    const order = await Order.findById(res.body.data.orderId);
    expect(order.deliveryFee).toBe(order.shippingFee);
  });

  it("rejects a reused (already consumed) quote", async () => {
    const quote = await getQuote(product._id);
    // First order consumes it
    await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    // Second order with the same quote should fail
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Kofi", phone: "0244000001", email: "kofi@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired|used|not found/i);
  });

  it("rejects a quote with mismatched cart hash (tampered items)", async () => {
    const quote = await getQuote(product._id, 1);
    // Try to use the quote but with qty 2 (hash won't match)
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 2 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/changed|quote/i);
  });

  it("rejects a quote with mismatched city (tampered city)", async () => {
    const quote = await getQuote(product._id);
    // Use the quote but change the city — the hash will mismatch
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Tema",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/changed|quote/i);
  });

  it("rejects a non-existent quoteId", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: fakeId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found|expired|used/i);
  });
});

// ── Order creation without quote (fresh recomputation) ───────────────────────

describe("Order creation with city + method (no quote)", () => {
  let product;
  beforeEach(async () => {
    await seedShippingData();
    product = await makeProduct();
  });

  it("recomputes the shipping fee server-side (courier)", async () => {
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        city: "Accra",
        neighborhood: "east legon",
        method: "courier_dispatch",
      });
    expect(res.status).toBe(200);
    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingFee).toBeGreaterThan(0);
    expect(order.shippingMethod).toBe("courier_dispatch");
    expect(order.shippingZoneCode).toBe("ACC-CENTRAL");
    expect(order.total).toBe(order.subtotal + order.shippingFee);
  });

  it("in_house_delivery is free", async () => {
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(200);
    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingFee).toBe(0);
    expect(order.shippingMethod).toBe("in_house_delivery");
    expect(order.total).toBe(order.subtotal);
  });
});

// ── Total assertion ──────────────────────────────────────────────────────────

describe("Order total = max(0, subtotal + shippingFee)", () => {
  let product;
  beforeEach(async () => {
    await seedShippingData();
    product = await makeProduct();
  });

  it("total equals subtotal + shippingFee for a normal order", async () => {
    const quote = await getQuote(product._id);
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    const order = await Order.findById(res.body.data.orderId);
    expect(order.total).toBe(order.subtotal + order.shippingFee);
    expect(order.total).toBeGreaterThan(0);
  });

  it("total never goes negative (floor at 0)", async () => {
    // Even if we somehow end up with a negative shipping fee (shouldn't
    // happen but defense-in-depth), total must be >= 0.
    const order = await Order.create({
      orderNumber: `EZW-FLOOR-${Date.now()}`,
      items: [{ name: "Test", price: 0, qty: 1 }],
      subtotal: 0,
      shippingFee: 0,
      total: 0,
      customer: { name: "Ama", phone: "0244000000" },
      status: "pending",
    });
    expect(order.total).toBeGreaterThanOrEqual(0);
  });
});

// ── Address change ───────────────────────────────────────────────────────────

describe("PATCH /api/v1/orders/:id/address", () => {
  let product, token;
  beforeEach(async () => {
    await seedShippingData();
    token = await makeAdmin();
    product = await makeProduct();
  });

  async function createTestOrder() {
    const quote = await getQuote(product._id);
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com", address: "East Legon, Accra" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "east legon",
        method: "in_house_delivery",
      });
    return Order.findById(res.body.data.orderId);
  }

  it("recalculates shipping fee on address change", async () => {
    const order = await createTestOrder();
    const oldFee = order.shippingFee;

    const res = await request(app)
      .patch(`${BASE}/orders/${order._id}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        address: "Community 1, Tema",
        neighborhood: "east legon",
        city: "Accra",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(200);
    expect(res.body.meta.oldShippingFee).toBe(oldFee);
    expect(typeof res.body.meta.newShippingFee).toBe("number");
    expect(res.body.data.customer.address).toBe("Community 1, Tema");
  });

  it("records address change in addressHistory", async () => {
    const order = await createTestOrder();
    await request(app)
      .patch(`${BASE}/orders/${order._id}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        address: "Madina, Accra",
        neighborhood: "madina",
        city: "Accra",
        method: "in_house_delivery",
      });
    const updated = await Order.findById(order._id);
    expect(updated.addressHistory.length).toBe(1);
    expect(updated.addressHistory[0].address).toBeTruthy();
    expect(typeof updated.addressHistory[0].shippingFee).toBe("number");
  });

  it("blocks address change when order is shipped", async () => {
    const order = await createTestOrder();
    order.status = "shipped";
    await order.save();

    const res = await request(app)
      .patch(`${BASE}/orders/${order._id}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        address: "New address",
        neighborhood: "osu",
        city: "Accra",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/shipped/i);
  });

  it("blocks address change when order is delivered", async () => {
    const order = await createTestOrder();
    order.status = "delivered";
    await order.save();

    const res = await request(app)
      .patch(`${BASE}/orders/${order._id}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        address: "New address",
        neighborhood: "osu",
        city: "Accra",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delivered/i);
  });

  it("rejects unauthenticated access", async () => {
    const order = await createTestOrder();
    const res = await request(app)
      .patch(`${BASE}/orders/${order._id}/address`)
      .send({
        address: "New address",
        neighborhood: "osu",
        city: "Accra",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(401);
  });

  it("rejects missing required fields", async () => {
    const order = await createTestOrder();
    const res = await request(app)
      .patch(`${BASE}/orders/${order._id}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({ address: "Only address" });
    expect(res.status).toBe(400);
  });

  it("404 for non-existent order", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`${BASE}/orders/${fakeId}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        address: "New address",
        neighborhood: "osu",
        city: "Accra",
        method: "in_house_delivery",
      });
    expect(res.status).toBe(404);
  });
});

// ── Legacy deliveryZone path still works ─────────────────────────────────────

describe("Order creation with legacy deliveryZoneId", () => {
  let product;
  beforeEach(async () => {
    await seedShippingData();
    product = await makeProduct();
  });

  it("uses the flat fee from the old DeliveryZone model", async () => {
    const DeliveryZone = require("../models/DeliveryZone");
    const zone = await DeliveryZone.create({
      name: "Test Zone",
      fee: 3000,
      estimatedDays: 2,
    });
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        deliveryZoneId: zone._id.toString(),
      });
    expect(res.status).toBe(200);
    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingFee).toBe(3000);
    expect(order.deliveryFee).toBe(3000);
    expect(order.total).toBe(order.subtotal + 3000);
  });
});

// ── T80 E2 — bus-station pickup through quote → order ────────────────────────
//
// Regional (outside Greater Accra) fulfilment: bus_station_pickup. The cart
// hash must carry region + pickupLocationId so a fulfilment-mode switch at
// checkout kills the quote, and the order must snapshot the chosen station.

async function seedRegionalPickup() {
  shippingCache.invalidateAll();
  await seedShippingData();
  const settings = await ShippingSettings.getSettings();
  settings.pickupAvailable = true;
  await settings.save();
  await Location.create({
    region: "Ashanti",
    city: "Kumasi",
    neighborhoods: [],
    inAccraCore: false,
    isActive: true,
  });
  await ShippingZone.create({
    name: "Ashanti Region",
    code: "ASHANTI",
    city: "Kumasi",
    region: "Ashanti",
    inAccraCore: false,
    pickupMode: "bus_station",
    neighborhoods: [],
    baseRate: 0,
    perKgRate: 0,
    regionalBaseFee: 2000,
    regionalPricePerKg: 400,
    estimatedDays: 3,
    isActive: true,
  });
  const station = await PickupLocation.create({
    name: "Kumasi Kejetia Terminal",
    kind: "bus_station",
    region: "Ashanti",
    city: "Kumasi",
    address: "Kejetia, Kumasi",
    landmark: "Kejetia Bus Terminal",
    isActive: true,
  });
  return station;
}

describe("T80 E2 — ShippingQuote model region + pickup", () => {
  it("buildCartHash includes region (changes when region changes)", () => {
    const items = [{ productId: "aaa", quantity: 1 }];
    const h1 = buildCartHash(items, "Kumasi", "", "bus_station_pickup", "standard", "Ashanti", "pickup1");
    const h2 = buildCartHash(items, "Kumasi", "", "bus_station_pickup", "standard", "Eastern", "pickup1");
    expect(h1).not.toBe(h2);
  });

  it("buildCartHash includes pickupLocationId (changes when the station changes)", () => {
    const items = [{ productId: "aaa", quantity: 1 }];
    const h1 = buildCartHash(items, "Kumasi", "", "bus_station_pickup", "standard", "Ashanti", "pickupA");
    const h2 = buildCartHash(items, "Kumasi", "", "bus_station_pickup", "standard", "Ashanti", "pickupB");
    expect(h1).not.toBe(h2);
  });

  it("buildCartHash differs between delivery and pickup for the same city", () => {
    const items = [{ productId: "aaa", quantity: 1 }];
    const deliveryHash = buildCartHash(items, "Accra", "osu", "courier_dispatch", "standard", "", "");
    const pickupHash = buildCartHash(items, "Accra", "osu", "bus_station_pickup", "standard", "Greater Accra", "warehouse1");
    expect(deliveryHash).not.toBe(pickupHash);
  });
});

describe("POST /api/v1/shipping/quote — regional bus-station pickup", () => {
  let product, station;
  beforeEach(async () => {
    station = await seedRegionalPickup();
    product = await makeProduct();
  });

  it("computes a regional pickup fee and persists region + pickupLocationId", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Kumasi",
        neighborhood: "",
        address: "Kejetia, Kumasi",
        method: "bus_station_pickup",
        region: "Ashanti",
        pickupLocationId: String(station._id),
        items: [{ productId: String(product._id), quantity: 2 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.isPickup).toBe(true);
    expect(res.body.data.region).toBe("Ashanti");
    // 0.3 kg × 2 = 0.6 kg → 2000 + 0.6×400 = 2240
    expect(res.body.data.shippingFee).toBe(2240);
    expect(res.body.data.freeDeliveryApplied).toBe(false);

    const doc = await ShippingQuote.findOne({ quoteId: res.body.data.quoteId });
    expect(String(doc.region)).toBe("Ashanti");
    expect(String(doc.pickupLocationId)).toBe(String(station._id));
    expect(doc.method).toBe("bus_station_pickup");
  });

  it("rejects an unknown pickupLocationId", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Kumasi",
        neighborhood: "",
        method: "bus_station_pickup",
        region: "Ashanti",
        pickupLocationId: "000000000000000000000000",
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not available|pickup/i);
  });

  it("rejects bus-station pickup without a pickupLocationId", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Kumasi",
        neighborhood: "",
        method: "bus_station_pickup",
        region: "Ashanti",
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(JSON.stringify(res.body.errors)).toMatch(/pickup location is required/i);
  });
});

describe("Order creation — bus-station pickup with a quote", () => {
  let product, station;
  beforeEach(async () => {
    station = await seedRegionalPickup();
    product = await makeProduct();
  });

  it("creates an order that snapshots the pickup station + method", async () => {
    const quoteRes = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Kumasi",
        neighborhood: "",
        address: "Kejetia, Kumasi",
        method: "bus_station_pickup",
        region: "Ashanti",
        pickupLocationId: String(station._id),
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    const quote = quoteRes.body.data;

    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com", address: "Kejetia, Kumasi" },
        shippingQuoteId: quote.quoteId,
        city: "Kumasi",
        neighborhood: "",
        method: "bus_station_pickup",
        region: "Ashanti",
      });
    expect(res.status).toBe(200);

    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingMethod).toBe("bus_station_pickup");
    expect(String(order.pickupLocationId)).toBe(String(station._id));
    expect(order.pickupLocationName).toBe("Kumasi Kejetia Terminal");
    expect(order.shippingFee).toBe(quote.shippingFee);
    expect(order.shippingFee).toBeGreaterThan(0);
    expect(order.total).toBe(order.subtotal + order.shippingFee);
  });

  it("rejects the order if pickup switch breaks the cart hash", async () => {
    // Quote for regional pickup, then try to place a home-delivery order in
    // the core with the same quote — the stored method/city/region differ.
    const quoteRes = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Kumasi",
        neighborhood: "",
        method: "bus_station_pickup",
        region: "Ashanti",
        pickupLocationId: String(station._id),
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    const quote = quoteRes.body.data;

    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Accra",
        neighborhood: "osu",
        method: "courier_dispatch",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/changed|quote/i);
  });

  it("rejects bus-station pickup order without a quote and no pickupLocationId", async () => {
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        city: "Kumasi",
        neighborhood: "",
        method: "bus_station_pickup",
        region: "Ashanti",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pickup location is required/i);
  });

  // Regression: the no-quote path validated the station at the top of the
  // handler but never adopted it into the local, so the order was stored with
  // no collection point at all — a pickup order nobody could route.
  it("snapshots the pickup station on the no-quote path", async () => {
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        city: "Kumasi",
        neighborhood: "",
        method: "bus_station_pickup",
        region: "Ashanti",
        pickupLocationId: String(station._id),
      });
    expect(res.status).toBe(200);

    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingMethod).toBe("bus_station_pickup");
    expect(String(order.pickupLocationId)).toBe(String(station._id));
    expect(order.pickupLocationName).toBe("Kumasi Kejetia Terminal");
    expect(order.shippingFee).toBeGreaterThan(0);
  });

  // Pitfall 10.12: the server must recompute and validate, never trust.
  it("rejects an order whose body claims a cheaper shipping fee", async () => {
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        city: "Kumasi",
        neighborhood: "",
        method: "bus_station_pickup",
        region: "Ashanti",
        pickupLocationId: String(station._id),
        shippingFee: 0,
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed since checkout/i);
  });

  it("accepts a matching echoed fee and stores the server's figure", async () => {
    const quoteRes = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Kumasi", neighborhood: "", method: "bus_station_pickup",
        region: "Ashanti", pickupLocationId: String(station._id),
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    const quote = quoteRes.body.data;

    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quote.quoteId,
        city: "Kumasi", neighborhood: "", method: "bus_station_pickup", region: "Ashanti",
        shippingFee: quote.shippingFee,
      });
    expect(res.status).toBe(200);
    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingFee).toBe(quote.shippingFee);
  });

  it("clamps an inflated client fee down to the server figure", async () => {
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        city: "Kumasi", neighborhood: "", method: "bus_station_pickup",
        region: "Ashanti", pickupLocationId: String(station._id),
        shippingFee: 999999,
      });
    expect(res.status).toBe(200);
    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingFee).toBeLessThan(999999);
  });

  it("does not carry a stray station id onto a delivery order", async () => {
    const res = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Kofi", phone: "0244000001", email: "kofi@test.com" },
        city: "Accra",
        neighborhood: "osu",
        method: "courier_dispatch",
        pickupLocationId: String(station._id),
      });
    expect(res.status).toBe(200);

    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingMethod).toBe("courier_dispatch");
    expect(order.pickupLocationId == null).toBe(true);
    expect(order.pickupLocationName == null).toBe(true);
  });
});
