// T78 Phase 3 — shipping endpoint tests. Proves the HTTP layer (Zod
// validation, auth gating, response shape) on top of the calculator
// proven in shippingCalculator.test.js.
//
// KEY PATTERN: afterEach in tests/setup.js wipes ALL collections after every
// test, so every describe block must use `beforeEach` to recreate auth tokens
// and seed data — `beforeAll` only survives the first test.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const ShippingZone = require("../models/ShippingZone");
const ShippingTier = require("../models/ShippingTier");
const ShippingSettings = require("../models/ShippingSettings");
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
    {
      name: "Tema Central", code: "TEMA-CENTRAL", city: "Tema",
      neighborhoods: ["community 1", "sakumono", "ashaiman"],
      distanceMinKm: 0, distanceMaxKm: 30,
      baseRate: 2000, perKgRate: 400, fragileSurcharge: 500, estimatedDays: 2, isDefault: true,
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
  // T136/T115 — pin the same-day window so the suite does not depend on when it
  // runs. `express` is the same-day service, so without these two lines the
  // assertions below hold only before the cutoff hour and only on a day that is
  // not in deliveryClosedDays (which defaults to Sunday).
  settings.sameDayCutoffHour = 23; // past any wall-clock time the suite runs at
  settings.deliveryClosedDays = []; // no closed days, so any weekday works
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/shipping/quote", () => {
  let product;
  beforeEach(async () => {
    await seedShippingData();
    product = await makeProduct();
  });

  it("returns a valid quote for a known active product (courier)", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, { method: "courier_dispatch" }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shippingFee).toBeGreaterThan(0);
    expect(res.body.data.zoneCode).toBe("ACC-CENTRAL");
    expect(res.body.data.currency).toBe("GHS");
    expect(res.body.data.productIds).toContain(String(product._id));
  });

  it("in-house delivery is always free", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id));
    expect(res.status).toBe(200);
    expect(res.body.data.shippingFee).toBe(0);
    expect(res.body.data.grossShippingFee).toBeGreaterThan(0);
    expect(res.body.data.freeDeliveryApplied).toBe(true);
  });

  it("rejects an unsupported city", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({ ...quoteBody(product._id), city: "Kumasi" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects an unknown delivery method", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({ ...quoteBody(product._id), method: "drone" });
    expect(res.status).toBe(400);
  });

  it("rejects an inactive product", async () => {
    const inactive = await makeProduct({ slug: `dead-${Date.now()}`, isActive: false });
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(inactive._id));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unavailable/i);
  });

  it("rejects an empty items array", async () => {
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({ city: "Accra", method: "in_house_delivery", items: [] });
    expect(res.status).toBe(400);
  });

  it("free-delivery zeroes the fee when subtotal meets the threshold", async () => {
    const expProduct = await makeProduct({ slug: `exp-${Date.now()}`, price: 50000, isFragile: false });
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(expProduct._id, 1));
    expect(res.status).toBe(200);
    expect(res.body.data.freeDeliveryApplied).toBe(true);
    expect(res.body.data.shippingFee).toBe(0);
    expect(res.body.data.grossShippingFee).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/shipping/methods", () => {
  beforeEach(seedShippingData);

  it("returns available methods for a valid city", async () => {
    const res = await request(app).get(`${BASE}/shipping/methods?city=Accra`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.methods)).toBe(true);
    expect(res.body.data.methods.length).toBeGreaterThanOrEqual(2);
    const ids = res.body.data.methods.map((m) => m.id);
    expect(ids).toContain("in_house_delivery");
    expect(ids).toContain("courier_dispatch_standard");
    expect(ids).toContain("courier_dispatch_express");
    // Same-day is not a service EazWorld sells — gated by
    // ShippingSettings.sameDayAvailable, which is off by default.
    expect(ids).not.toContain("courier_dispatch_same_day");
  });

  it("enriches methods with estimatedDays when a valid city is supplied", async () => {
    const res = await request(app).get(`${BASE}/shipping/methods?city=Accra`);
    const courierMethods = res.body.data.methods.filter((m) => m.id.startsWith("courier_dispatch"));
    expect(courierMethods.length).toBeGreaterThan(0);
    for (const m of courierMethods) {
      // Standard states a range ("1-3"), so an ETA is a number or a label —
      // never absent.
      expect(["number", "string"]).toContain(typeof m.estimatedDays);
      expect(String(m.estimatedDays)).not.toBe("");
    }
  });

  it("includes indicativeFee on courier methods when city + neighborhood match", async () => {
    const res = await request(app).get(`${BASE}/shipping/methods?city=Accra&neighborhood=madina`);
    const byId = Object.fromEntries(
      res.body.data.methods
        .filter((m) => m.id.startsWith("courier_dispatch"))
        .map((m) => [m.speed, m]),
    );
    // T117: three sold speeds. These seed zones predate speedTiers, so they
    // carry named express/same-day multipliers and no next-day rate.
    expect(Object.keys(byId).sort()).toEqual(["express", "next_day", "standard"]);

    for (const speed of ["standard", "express"]) {
      expect(typeof byId[speed].indicativeFee).toBe("number");
      expect(byId[speed].indicativeFee).toBeGreaterThanOrEqual(0);
    }
    // Offered without a figure rather than quoted at the standard price — the
    // storefront renders null as "—" and the quote endpoint is authoritative.
    expect(byId.next_day.indicativeFee).toBeNull();
  });

  it("serves regional cities and rejects a missing city (E2)", async () => {
    // E2: Kumasi is a valid regional city — the old Accra/Tema-only 400 is gone.
    const ok = await request(app).get(`${BASE}/shipping/methods?city=Kumasi&region=Ashanti`);
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);

    // A missing city is still rejected by the Zod schema.
    const res = await request(app).get(`${BASE}/shipping/methods`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/shipping/neighborhoods", () => {
  beforeEach(async () => {
    await seedShippingData();
  });

  it("returns the neighborhoods for the requested city only", async () => {
    const res = await request(app).get(`${BASE}/shipping/neighborhoods?city=Tema`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((n) => n.neighborhood);
    expect(names).toEqual(expect.arrayContaining(["community 1", "sakumono"]));
    expect(names).not.toContain("osu");
  });

  it("rejects an unsupported city", async () => {
    const res = await request(app).get(`${BASE}/shipping/neighborhoods?city=Narnia`);
    expect(res.status).toBe(400);
  });

  // Regression: this endpoint cached a city-filtered zone list under the bare
  // "zones" key that the calculator uses for EVERY active zone. A lookup for
  // one city then starved the quote path of every other city's zones until the
  // 5-minute TTL expired.
  it("does not poison the calculator's zone cache for other cities", async () => {
    const product = await makeProduct();

    const warm = await request(app).get(`${BASE}/shipping/neighborhoods?city=Tema`);
    expect(warm.status).toBe(200);

    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send(quoteBody(product._id, 1, { method: "courier_dispatch" }));
    expect(res.status).toBe(200);
    expect(res.body.data.zoneCode).toBe("ACC-CENTRAL");
  });
});

describe("GET /api/v1/shipping/free-delivery", () => {
  beforeEach(seedShippingData);

  it("returns enabled + threshold", async () => {
    const res = await request(app).get(`${BASE}/shipping/free-delivery`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.threshold).toBe(50000);
    expect(res.body.data.currency).toBe("GHS");
  });
});

describe("Admin shipping zones CRUD", () => {
  let token;
  beforeEach(async () => {
    await seedShippingData();
    token = await makeAdmin();
  });

  it("GET /admin/shipping/zones — lists zones", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/zones`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("POST /admin/shipping/zones — creates a zone", async () => {
    const res = await request(app)
      .post(`${BASE}/admin/shipping/zones`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Accra East", code: "ACC-EAST", city: "Accra",
        neighborhoods: ["teshie", "nungua"],
        baseRate: 1800, estimatedDays: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("ACC-EAST");
  });

  it("GET /admin/shipping/zones/:id — fetches a single zone", async () => {
    const zones = await ShippingZone.find().lean();
    const res = await request(app)
      .get(`${BASE}/admin/shipping/zones/${zones[0]._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(String(zones[0]._id));
  });

  it("GET /admin/shipping/zones/:id — 404 on unknown id", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`${BASE}/admin/shipping/zones/${fakeId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("PATCH /admin/shipping/zones/:id — updates a zone", async () => {
    const zone = await ShippingZone.findOne({ code: "ACC-CENTRAL" });
    const res = await request(app)
      .patch(`${BASE}/admin/shipping/zones/${zone._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ baseRate: 1600 });
    expect(res.status).toBe(200);
    expect(res.body.data.baseRate).toBe(1600);
  });

  it("DELETE /admin/shipping/zones/:id — deletes a zone", async () => {
    const zone = await ShippingZone.create({
      name: "Temp Zone", code: "TEMP-Z", city: "Accra",
      baseRate: 1000, estimatedDays: 1,
    });
    const res = await request(app)
      .delete(`${BASE}/admin/shipping/zones/${zone._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await ShippingZone.findById(zone._id)).toBeNull();
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get(`${BASE}/admin/shipping/zones`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin roles", async () => {
    const staffToken = await makeAdmin("staff");
    const res = await request(app)
      .get(`${BASE}/admin/shipping/zones`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });
});

describe("Admin shipping tiers CRUD", () => {
  let token;
  beforeEach(async () => {
    await seedShippingData();
    token = await makeAdmin();
  });

  it("lists tiers sorted by level descending", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/tiers`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].level).toBeGreaterThanOrEqual(res.body.data[1].level);
  });

  it("creates, fetches, updates, deletes a tier", async () => {
    const createRes = await request(app)
      .post(`${BASE}/admin/shipping/tiers`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bulk", category: "Bulk Cables", level: 1, multiplier: 1.0 });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data._id;

    const getRes = await request(app)
      .get(`${BASE}/admin/shipping/tiers/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe("Bulk");

    const patchRes = await request(app)
      .patch(`${BASE}/admin/shipping/tiers/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ multiplier: 1.1 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.multiplier).toBe(1.1);

    const delRes = await request(app)
      .delete(`${BASE}/admin/shipping/tiers/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(delRes.status).toBe(200);
  });

  it("refuses to delete the default tier", async () => {
    const def = await ShippingTier.findOne({ category: DEFAULT_TIER_CATEGORY });
    const res = await request(app)
      .delete(`${BASE}/admin/shipping/tiers/${def._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/default tier/i);
  });
});

describe("Admin shipping settings", () => {
  let token;
  beforeEach(async () => {
    await seedShippingData();
    token = await makeAdmin();
  });

  it("GET returns the singleton settings document", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/settings`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.freeDeliveryThreshold).toBe(50000);
    expect(res.body.data.inHouseDeliveryAvailable).toBe(true);
  });

  it("PATCH updates settings and returns the updated document", async () => {
    const res = await request(app)
      .patch(`${BASE}/admin/shipping/settings`)
      .set("Authorization", `Bearer ${token}`)
      .send({ freeDeliveryThreshold: 100000 });
    expect(res.status).toBe(200);
    expect(res.body.data.freeDeliveryThreshold).toBe(100000);
  });

  it("PATCH with no actual changes returns meta.noChanges", async () => {
    const res = await request(app)
      .patch(`${BASE}/admin/shipping/settings`)
      .set("Authorization", `Bearer ${token}`)
      .send({ freeDeliveryThreshold: 50000 });
    expect(res.status).toBe(200);
    expect(res.body.meta?.noChanges).toBe(true);
  });
});

describe("Admin courier rate", () => {
  let token;
  beforeEach(async () => {
    await seedShippingData();
    token = await makeAdmin();
  });

  it("GET creates and returns the default config if none exists", async () => {
    const res = await request(app)
      .get(`${BASE}/admin/shipping/courier-rate`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe("COURIER_PAYOUT");
    expect(res.body.data.mode).toBe("percentage");
  });

  it("PATCH updates mode and percentage", async () => {
    const res = await request(app)
      .patch(`${BASE}/admin/shipping/courier-rate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "percentage", percentage: 35 });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe("percentage");
    expect(res.body.data.percentage).toBe(35);
  });
});

// T116: /shipping/methods had two code paths building courier methods. The
// distance-zone branch offered whatever tiers the zone defined; the legacy
// branch carried its own hardcoded list that omitted next_day — so every seeded
// zone defined a next_day tier the endpoint never offered. The legacy branch now
// reads the same speedTiers array the quote prices from.
describe("GET /shipping/methods — legacy branch reads the zone's tiers (T116)", () => {
  const TIERS = [
    { code: "standard", label: "Standard", multiplier: 1.0, estimatedDays: "1-3" },
    { code: "next_day", label: "Next Day", multiplier: 1.2, estimatedDays: "1" },
  ];

  async function seedTieredZone() {
    await seedShippingData();
    await ShippingZone.deleteMany({ city: "Accra" });
    await ShippingZone.create({
      name: "Accra Tiered", code: "ACC-TIERED", city: "Accra",
      neighborhoods: ["osu"],
      distanceMinKm: 0, distanceMaxKm: 25,
      baseRate: 1500, perKgRate: 300,
      fragileSurcharge: 500, estimatedDays: 1, isDefault: true,
      speedTiers: TIERS,
    });
  }

  it("offers next_day when the zone defines it", async () => {
    await seedTieredZone();

    const res = await request(app).get(`${BASE}/shipping/methods?city=Accra`);

    const speeds = res.body.data.methods
      .filter((m) => m.id.startsWith("courier_dispatch_"))
      .map((m) => m.speed)
      .sort();
    expect(speeds).toEqual(["next_day", "standard"]);
  });

  it("prices each tier from its own multiplier, not a named field", async () => {
    await seedTieredZone();

    const res = await request(app).get(`${BASE}/shipping/methods?city=Accra`);
    const byId = Object.fromEntries(res.body.data.methods.map((m) => [m.id, m]));

    // baseRate 1500 × the tier's multiplier. Quoting next_day at 1.0 because no
    // `nextDayMultiplier` field exists is exactly the drift this closes.
    expect(byId.courier_dispatch_standard.indicativeFee).toBe(1500);
    expect(byId.courier_dispatch_next_day.indicativeFee).toBe(1800);
    expect(byId.courier_dispatch_next_day.estimatedDays).toBe("1");
  });

  it("still uses the short list for a zone with no tiers", async () => {
    await seedShippingData(); // seeds legacy zones carrying named multipliers only

    const res = await request(app).get(`${BASE}/shipping/methods?city=Accra`);
    const speeds = res.body.data.methods
      .filter((m) => m.id.startsWith("courier_dispatch_"))
      .map((m) => m.speed)
      .sort();
    // T117: the short list is the three sold speeds. same_day is gone entirely.
    expect(speeds).toEqual(["express", "next_day", "standard"]);
  });
});
