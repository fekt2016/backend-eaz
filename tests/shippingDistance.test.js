// Google-Maps distance pricing. The Maps key is blanked in tests/setup.js, so
// nothing here reaches Google — the resolve endpoint is proven to refuse
// without a key, and the pricing tests seed NeighborhoodDistance rows directly,
// which is exactly what the admin flow produces.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Location = require("../models/Location");
const ShippingZone = require("../models/ShippingZone");
const ShippingTier = require("../models/ShippingTier");
const ShippingSettings = require("../models/ShippingSettings");
const NeighborhoodDistance = require("../models/NeighborhoodDistance");
const { buildOriginKey } = require("../models/NeighborhoodDistance");
const { DEFAULT_TIER_CATEGORY } = require("../models/ShippingTier");
const { shippingCache } = require("../services/shipping/shippingCache");
const googleDistance = require("../services/shipping/googleDistance");
const { quoteShipping } = require("../services/shipping/shippingCalculator");

const BASE = "/api/v1";
const ORIGIN = "Nima Market, Accra, Ghana";

async function makeAdmin() {
  const user = await User.create({
    name: `admin-${Date.now()}`,
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role: "admin",
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

// A zone priced by the E2 distance formula: fee = base + km × perKm + kg × perKg.
// The distance band midpoint is 20 km, so a measured distance that differs from
// 20 makes the two sources trivially distinguishable in the fee.
async function seedDistanceZone() {
  shippingCache.invalidateAll();
  await Location.create({
    region: "Greater Accra",
    city: "Accra",
    neighborhoods: ["osu", "madina", "kasoa"],
    inAccraCore: true,
    isActive: true,
  });
  await ShippingZone.create({
    name: "Accra Distance", code: "ACC-DIST", city: "Accra", region: "Greater Accra",
    neighborhoods: ["osu", "madina", "kasoa"],
    distanceMinKm: 10, distanceMaxKm: 30,   // midpoint 20
    distanceBaseFee: 1000, pricePerKm: 100, pricePerKg: 0,
    baseRate: 1000, perKgRate: 0,
    fragileSurcharge: 0, estimatedDays: 1, isDefault: true, isActive: true,
  });
  await ShippingTier.create({
    name: "Default", category: DEFAULT_TIER_CATEGORY, level: 0, multiplier: 1.0,
  });
  const settings = await ShippingSettings.getSettings();
  settings.originAddress = ORIGIN;
  settings.useGoogleDistance = true;
  settings.inHouseDeliveryAvailable = true;
  settings.courierDispatchAvailable = true;
  settings.freeDeliveryThreshold = null;
  await settings.save();
  return settings;
}

function itemsFor(product) {
  return [{ product, quantity: 1 }];
}

async function makeProduct() {
  return Product.create({
    name: "Cable",
    slug: `cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 5000, category: "Cables", stock: 10,
    weight: 0.2, weightUnit: "kg", isFragile: false,
  });
}

describe("googleDistance service", () => {
  it("reports no config when the key is blank (test hermeticity)", () => {
    expect(googleDistance.hasConfig()).toBe(false);
  });

  it("refuses to resolve without a key rather than calling Google", async () => {
    await expect(
      googleDistance.resolveDistances(ORIGIN, ["Osu, Accra, Ghana"]),
    ).rejects.toThrow(/GOOGLE_MAPS_API_KEY/i);
  });

  // Verified against the live API: a project without billing answers 403 with
  // ErrorInfo.reason BILLING_DISABLED, array-wrapped on the Routes API. It must
  // be told apart from "this API is not enabled", which the legacy fallback can
  // actually rescue — billing cannot, so retrying there just wastes a call.
  it("detects BILLING_DISABLED in the Routes API error shape", () => {
    const err = {
      response: {
        status: 403,
        data: [
          {
            error: {
              code: 403,
              message: "This API method requires billing to be enabled.",
              status: "PERMISSION_DENIED",
              details: [{ reason: "BILLING_DISABLED", domain: "googleapis.com" }],
            },
          },
        ],
      },
    };
    expect(googleDistance.isBillingDisabled(err)).toBe(true);
  });

  it("detects BILLING_DISABLED in the legacy (unwrapped) error shape", () => {
    const err = {
      response: { status: 403, data: { error: { message: "You must enable Billing on the project" } } },
    };
    expect(googleDistance.isBillingDisabled(err)).toBe(true);
  });

  it("does not mistake a disabled-API error for a billing problem", () => {
    const err = {
      response: {
        status: 403,
        data: [{ error: { message: "Routes API has not been used in project 1 before", details: [{ reason: "SERVICE_DISABLED" }] } }],
      },
    };
    expect(googleDistance.isBillingDisabled(err)).toBe(false);
  });

  it("builds a Ghana-qualified destination address", () => {
    expect(
      googleDistance.buildDestinationAddress({
        neighborhood: "osu", city: "Accra", region: "Greater Accra",
      }),
    ).toBe("osu, Accra, Greater Accra, Ghana");
  });

  it("omits empty parts from the destination address", () => {
    expect(
      googleDistance.buildDestinationAddress({ neighborhood: "osu", city: "", region: "" }),
    ).toBe("osu, Ghana");
  });
});

describe("buildOriginKey", () => {
  it("is stable across case and whitespace", () => {
    expect(buildOriginKey("Nima,  Accra")).toBe(buildOriginKey("nima, accra"));
  });

  it("differs for a different origin", () => {
    expect(buildOriginKey("Nima, Accra")).not.toBe(buildOriginKey("Tema, Accra"));
  });

  it("is empty for a blank origin", () => {
    expect(buildOriginKey("")).toBe("");
  });
});

describe("Distance-priced quotes", () => {
  let product;
  beforeEach(async () => {
    await seedDistanceZone();
    product = await makeProduct();
  });

  it("prices from the measured distance when one exists", async () => {
    await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "osu" },
      { distanceKm: 5, originKey: buildOriginKey(ORIGIN), originAddress: ORIGIN },
    );
    shippingCache.invalidateAll();

    const quote = await quoteShipping({
      city: "Accra", neighborhood: "osu", region: "Greater Accra",
      method: "courier_dispatch", items: itemsFor(product), subtotal: 5000,
    });

    // 1000 + 5 km × 100 = 1500 pesewas
    expect(quote.distanceSource).toBe("google");
    expect(quote.distanceKm).toBe(5);
    expect(quote.shippingFee).toBe(1500);
  });

  it("falls back to the zone band when the neighbourhood is unmeasured", async () => {
    const quote = await quoteShipping({
      city: "Accra", neighborhood: "madina", region: "Greater Accra",
      method: "courier_dispatch", items: itemsFor(product), subtotal: 5000,
    });

    // Band midpoint 20 km → 1000 + 20 × 100 = 3000 pesewas
    expect(quote.distanceSource).toBe("zone_band");
    expect(quote.distanceKm).toBe(20);
    expect(quote.shippingFee).toBe(3000);
  });

  it("ignores measured distances while the toggle is off", async () => {
    await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "osu" },
      { distanceKm: 5, originKey: buildOriginKey(ORIGIN), originAddress: ORIGIN },
    );
    const settings = await ShippingSettings.getSettings();
    settings.useGoogleDistance = false;
    await settings.save();
    shippingCache.invalidateAll();

    const quote = await quoteShipping({
      city: "Accra", neighborhood: "osu", region: "Greater Accra",
      method: "courier_dispatch", items: itemsFor(product), subtotal: 5000,
    });
    expect(quote.distanceSource).toBe("zone_band");
    expect(quote.shippingFee).toBe(3000);
  });

  it("falls back to the band when no neighbourhood is supplied", async () => {
    const quote = await quoteShipping({
      city: "Accra", neighborhood: "", region: "Greater Accra",
      method: "courier_dispatch", items: itemsFor(product), subtotal: 5000,
    });
    expect(quote.distanceSource).toBe("zone_band");
  });

  it("charges courier on a distance-priced quote, and frees only in-house", async () => {
    // Free delivery follows WHO delivers, not basket size: a courier is paid
    // per drop, so the threshold must not zero the fee.
    await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "osu" },
      { distanceKm: 5, originKey: buildOriginKey(ORIGIN), originAddress: ORIGIN },
    );
    const settings = await ShippingSettings.getSettings();
    settings.freeDeliveryThreshold = 4000;
    await settings.save();
    shippingCache.invalidateAll();

    const courier = await quoteShipping({
      city: "Accra", neighborhood: "osu", region: "Greater Accra",
      method: "courier_dispatch", items: itemsFor(product), subtotal: 5000,
    });
    expect(courier.freeDeliveryApplied).toBe(false);
    expect(courier.shippingFee).toBe(1500);

    const inHouse = await quoteShipping({
      city: "Accra", neighborhood: "osu", region: "Greater Accra",
      method: "in_house_delivery", items: itemsFor(product), subtotal: 5000,
    });
    expect(inHouse.freeDeliveryApplied).toBe(true);
    expect(inHouse.shippingFee).toBe(0);
    expect(inHouse.grossShippingFee).toBe(1500);   // the real cost is still surfaced
  });
});

describe("NeighborhoodDistance model", () => {
  it("upserts rather than duplicating on re-record", async () => {
    const key = buildOriginKey(ORIGIN);
    await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "Osu" },
      { distanceKm: 5, originKey: key, originAddress: ORIGIN },
    );
    await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "osu" },
      { distanceKm: 7, originKey: key, originAddress: ORIGIN },
    );
    const rows = await NeighborhoodDistance.find({ city: "Accra" });
    expect(rows).toHaveLength(1);
    expect(rows[0].distanceKm).toBe(7);
    expect(rows[0].neighborhood).toBe("osu");   // lowercased
  });

  it("flags a row measured from a previous origin as stale", async () => {
    const row = await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "osu" },
      { distanceKm: 5, originKey: buildOriginKey(ORIGIN), originAddress: ORIGIN },
    );
    expect(row.isStaleFor(buildOriginKey(ORIGIN))).toBe(false);
    expect(row.isStaleFor(buildOriginKey("Tema Station, Accra"))).toBe(true);
  });

  it("returns null for an unmeasured neighbourhood", async () => {
    const km = await NeighborhoodDistance.lookupKm({
      region: "Greater Accra", city: "Accra", neighborhood: "nowhere",
    });
    expect(km).toBeNull();
  });
});

describe("Admin distance endpoints", () => {
  let token;
  beforeEach(async () => {
    await seedDistanceZone();
    token = await makeAdmin();
  });

  it("lists every neighbourhood with its measured distance, gaps included", async () => {
    await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "osu" },
      { distanceKm: 5, originKey: buildOriginKey(ORIGIN), originAddress: ORIGIN },
    );

    const res = await request(app)
      .get(`${BASE}/admin/shipping/distances?region=Greater%20Accra&city=Accra`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    const osu = res.body.data.find((d) => d.neighborhood === "osu");
    expect(osu.distanceKm).toBe(5);
    expect(osu.stale).toBe(false);
    const madina = res.body.data.find((d) => d.neighborhood === "madina");
    expect(madina.distanceKm).toBeNull();
    expect(res.body.meta.resolved).toBe(1);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.meta.googleConfigured).toBe(false);
  });

  it("marks rows stale after the origin address changes", async () => {
    await NeighborhoodDistance.record(
      { region: "Greater Accra", city: "Accra", neighborhood: "osu" },
      { distanceKm: 5, originKey: buildOriginKey(ORIGIN), originAddress: ORIGIN },
    );
    const settings = await ShippingSettings.getSettings();
    settings.originAddress = "Tema Station, Accra, Ghana";
    await settings.save();

    const res = await request(app)
      .get(`${BASE}/admin/shipping/distances?region=Greater%20Accra&city=Accra`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.find((d) => d.neighborhood === "osu").stale).toBe(true);
  });

  it("refuses to resolve when no Maps key is configured", async () => {
    const res = await request(app)
      .post(`${BASE}/admin/shipping/distances/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Greater Accra", city: "Accra" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GOOGLE_MAPS_API_KEY/i);
  });

  it("accepts a manual distance override and prices from it", async () => {
    const res = await request(app)
      .patch(`${BASE}/admin/shipping/distances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Greater Accra", city: "Accra", neighborhood: "Kasoa", distanceKm: 12.5 });

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("manual");
    expect(res.body.data.distanceKm).toBe(12.5);

    const product = await makeProduct();
    const quote = await quoteShipping({
      city: "Accra", neighborhood: "kasoa", region: "Greater Accra",
      method: "courier_dispatch", items: itemsFor(product), subtotal: 5000,
    });
    // 1000 + 12.5 × 100 = 2250
    expect(quote.shippingFee).toBe(2250);
    expect(quote.distanceSource).toBe("google");
  });

  it("rejects a negative manual distance", async () => {
    const res = await request(app)
      .patch(`${BASE}/admin/shipping/distances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Greater Accra", city: "Accra", neighborhood: "kasoa", distanceKm: -3 });
    expect(res.status).toBe(400);
  });

  it("requires admin auth", async () => {
    const res = await request(app).get(`${BASE}/admin/shipping/distances?city=Accra`);
    expect(res.status).toBe(401);
  });

  it("persists originAddress + useGoogleDistance through the settings endpoint", async () => {
    const res = await request(app)
      .patch(`${BASE}/admin/shipping/settings`)
      .set("Authorization", `Bearer ${token}`)
      .send({ originAddress: "Nima Roundabout, Accra", useGoogleDistance: false });

    expect(res.status).toBe(200);
    expect(res.body.data.originAddress).toBe("Nima Roundabout, Accra");
    expect(res.body.data.useGoogleDistance).toBe(false);
  });
});
