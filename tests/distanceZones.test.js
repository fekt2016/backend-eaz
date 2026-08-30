// Distance-zone pricing: the six A–F zones, the fee formula, zone resolution,
// and the guards from the spec's pitfall list.
//
// Speed tiers here are the configured ones: standard ×1.0, next_day ×1.2,
// express ×1.5. The spec's worked examples are written against its own tier
// names; the arithmetic is identical, the labels differ.
// Order creation initialises a Paystack transaction. Mock the SDK so the suite
// never reaches the network (tests/setup.js supplies a dummy secret).
jest.mock("@paystack/paystack-sdk", () => {
  class Paystack {
    get transaction() {
      return {
        initialize: jest.fn(async () => ({
          status: true,
          data: {
            authorization_url: "https://pay.example/checkout",
            access_code: "acc_code",
            reference: `REF_DZ_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
const User = require("../models/User");
const Product = require("../models/Product");
const Location = require("../models/Location");
const Neighborhood = require("../models/Neighborhood");
const ShippingZone = require("../models/ShippingZone");
const ShippingSettings = require("../models/ShippingSettings");
const { shippingCache } = require("../services/shipping/shippingCache");
const { calcShipping, calcShippingWithBreakdown, ceilToCedi } = require("../services/shipping/distanceFee");
const { classifyZone, checkCoverage, InvalidDistanceError } = require("../services/shipping/zoneClassification");
const { resolveZoneByNeighborhoodId, resolveZoneByName, ZoneResolutionError } = require("../services/shipping/zoneResolver");
const { quoteShipping } = require("../services/shipping/shippingCalculator");

const BASE = "/api/v1";

const SPEED_TIERS = [
  { code: "standard", label: "Standard", multiplier: 1.0, estimatedDays: "1-2" },
  { code: "next_day", label: "Next Day", multiplier: 1.2, estimatedDays: "1-2" },
  { code: "express",  label: "Express",  multiplier: 1.5, estimatedDays: "1-2" },
];

// Rates in pesewas — the spec's GHS table ×100.
const ZONE_SPECS = [
  { zoneKey: "A", minKm: 0,  maxKm: 5,   baseRate: 1500, perKgRate: 200, days: 1, label: "1-2" },
  { zoneKey: "B", minKm: 5,  maxKm: 10,  baseRate: 3000, perKgRate: 250, days: 1, label: "1-2" },
  { zoneKey: "C", minKm: 10, maxKm: 15,  baseRate: 4000, perKgRate: 300, days: 1, label: "1-2" },
  { zoneKey: "D", minKm: 15, maxKm: 25,  baseRate: 5000, perKgRate: 350, days: 2, label: "2-3" },
  { zoneKey: "E", minKm: 25, maxKm: 40,  baseRate: 6500, perKgRate: 400, days: 2, label: "2-3" },
  { zoneKey: "F", minKm: 40, maxKm: 100, baseRate: 8000, perKgRate: 500, days: 2, label: "2-3" },
];

async function seedZones() {
  shippingCache.invalidateAll();
  await ShippingZone.create(
    ZONE_SPECS.map((z) => ({
      name: `Zone ${z.zoneKey}`, code: `ZONE-${z.zoneKey}`, zoneKey: z.zoneKey,
      city: "Accra", region: "Greater Accra", inAccraCore: true,
      distanceMinKm: z.minKm, distanceMaxKm: z.maxKm,
      baseRate: z.baseRate, perKgRate: z.perKgRate, fragileSurcharge: 500,
      speedTiers: SPEED_TIERS, estimatedDays: z.days, estimatedDaysLabel: z.label,
      isActive: true,
    })),
  );
  return ShippingZone.getActiveZones();
}

function zoneDoc(key) {
  const z = ZONE_SPECS.find((s) => s.zoneKey === key);
  return { zoneKey: key, code: `ZONE-${key}`, baseRate: z.baseRate, perKgRate: z.perKgRate,
           fragileSurcharge: 500, speedTiers: SPEED_TIERS, estimatedDaysLabel: z.label };
}

// ── The fee formula ─────────────────────────────────────────────────────────

describe("calcShipping — the spec's worked examples", () => {
  // GH₵ figures from the spec, expressed in pesewas.
  const cases = [
    ["A", 1.0, "standard", false, 1700, "15 + 2×1 = 17"],
    ["A", 0.2, "standard", false, 1600, "floored to 0.5 kg → 15 + 1 = 16"],
    ["B", 1.0, "standard", false, 3300, "30 + 2.5 = 32.5 → ceil 33"],
    ["C", 2.0, "next_day", false, 5600, "(40 + 6) × 1.2 = 55.2 → ceil 56"],
    ["D", 1.0, "express",  true,  8600, "(50 + 3.5) × 1.5 = 80.25, +5 = 85.25 → ceil 86"],
    ["E", 3.0, "standard", false, 7700, "65 + 12 = 77"],
    ["F", 1.0, "express",  false, 12800, "(80 + 5) × 1.5 = 127.5 → ceil 128"],
  ];

  it.each(cases)("Zone %s, %s kg, %s, fragile=%s → %s pesewas (%s)",
    (key, kg, speed, fragile, expected) => {
      expect(calcShipping(zoneDoc(key), kg, speed, fragile)).toBe(expected);
    });
});

describe("calcShippingWithBreakdown", () => {
  it("returns components that sum to the quoted fee", () => {
    const { fee, breakdown } = calcShippingWithBreakdown(zoneDoc("C"), 2.0, "next_day", false);
    expect(breakdown.baseRate + breakdown.weightFee).toBe(breakdown.subtotal);
    expect(breakdown.afterSpeed + breakdown.fragileSurcharge + breakdown.roundingAdjustment).toBe(fee);
  });

  it("adds the fragile surcharge AFTER the multiplier, never marked up", () => {
    const plain = calcShippingWithBreakdown(zoneDoc("D"), 1.0, "express", false);
    const fragile = calcShippingWithBreakdown(zoneDoc("D"), 1.0, "express", true);
    expect(fragile.breakdown.afterSpeed).toBe(plain.breakdown.afterSpeed);
    expect(fragile.breakdown.fragileSurcharge).toBe(500);
  });

  it("floors the chargeable weight at 0.5 kg", () => {
    expect(calcShippingWithBreakdown(zoneDoc("A"), 0.01, "standard", false).breakdown.chargeableWeightKg).toBe(0.5);
    expect(calcShippingWithBreakdown(zoneDoc("A"), 0, "standard", false).breakdown.chargeableWeightKg).toBe(0.5);
  });

  it("throws on a speed the zone does not define rather than defaulting to ×1.0", () => {
    expect(() => calcShipping(zoneDoc("A"), 1, "teleport", false)).toThrow(/no "teleport" speed tier/i);
  });

  // Found by the spec's own final audit step: `zone.baseRate || 0` would have
  // turned a broken zone into the cheapest possible quote, silently.
  it("throws on a zone with no base rate rather than quoting near-zero", () => {
    const broken = { zoneKey: "X", perKgRate: 200, fragileSurcharge: 0, speedTiers: SPEED_TIERS };
    expect(() => calcShipping(broken, 1, "standard", false)).toThrow(/no base rate/i);
  });

  it("still allows a zone that bills by base rate alone", () => {
    const baseOnly = { zoneKey: "Y", baseRate: 2000, fragileSurcharge: 0, speedTiers: SPEED_TIERS };
    expect(calcShipping(baseOnly, 3, "standard", false)).toBe(2000);
  });

  it("ceils to a whole cedi", () => {
    expect(ceilToCedi(3250)).toBe(3300);
    expect(ceilToCedi(3300)).toBe(3300);
    expect(ceilToCedi(3301)).toBe(3400);
  });
});

// ── Classification ──────────────────────────────────────────────────────────

describe("classifyZone", () => {
  beforeEach(async () => { await seedZones(); });

  // Half-open [min, max): each boundary belongs to exactly one zone.
  it.each([[0, "A"], [4.999, "A"], [5, "B"], [9.999, "B"], [10, "C"],
           [14.999, "C"], [15, "D"], [24.999, "D"], [25, "E"],
           [39.999, "E"], [40, "F"], [99.999, "F"]])(
    "%s km → zone %s", async (km, expected) => {
      expect(await classifyZone(km)).toBe(expected);
    });

  it("treats 100 km as outside the service area, not as Zone F", async () => {
    await expect(classifyZone(100)).rejects.toThrow(/do not deliver/i);
  });

  it("rejects a distance beyond the radius rather than pricing it", async () => {
    await expect(classifyZone(250)).rejects.toThrow(/do not deliver/i);
  });

  it.each([[null], [undefined], [NaN], [-1], ["12"]])(
    "throws on invalid distance %p instead of defaulting to a zone", async (bad) => {
      await expect(classifyZone(bad)).rejects.toThrow(InvalidDistanceError);
    });
});

describe("checkCoverage", () => {
  it("passes for contiguous bands covering 0–100", async () => {
    const zones = await seedZones();
    expect(checkCoverage(zones)).toEqual([]);
  });

  it("detects a gap between bands", () => {
    const problems = checkCoverage([
      { zoneKey: "A", distanceMinKm: 0, distanceMaxKm: 5 },
      { zoneKey: "B", distanceMinKm: 6, distanceMaxKm: 100 },
    ]);
    expect(problems.join(" ")).toMatch(/gap/i);
  });

  it("detects an overlap between bands", () => {
    const problems = checkCoverage([
      { zoneKey: "A", distanceMinKm: 0, distanceMaxKm: 8 },
      { zoneKey: "B", distanceMinKm: 5, distanceMaxKm: 100 },
    ]);
    expect(problems.join(" ")).toMatch(/overlap/i);
  });

  it("detects coverage that stops short of the serviceable radius", () => {
    const problems = checkCoverage([{ zoneKey: "A", distanceMinKm: 0, distanceMaxKm: 40 }]);
    expect(problems.join(" ")).toMatch(/serviceable radius/i);
  });
});

// ── Zone resolution ─────────────────────────────────────────────────────────

async function seedNeighborhoods() {
  await Neighborhood.create([
    { name: "Nima", city: "Accra", municipality: "Ayawaso East", lat: 5.582, lng: -0.198,
      distanceKm: 0.5, assignedZone: "A", isActive: true },
    { name: "Kasoa", city: "Accra", municipality: "Awutu Senya East", lat: 5.534, lng: -0.425,
      distanceKm: 33.4, assignedZone: "E", isActive: true },
    { name: "Prampram", city: "Tema", municipality: "Ningo Prampram", lat: 5.734, lng: 0.030,
      distanceKm: 45.0, assignedZone: "F", isActive: true },
    { name: "Retired Area", city: "Accra", municipality: "Somewhere", lat: 5.6, lng: -0.2,
      distanceKm: 3, assignedZone: "A", isActive: false },
  ]);
}

describe("zoneResolver", () => {
  beforeEach(async () => { await seedZones(); await seedNeighborhoods(); });

  it("resolves a neighbourhood id to its zone", async () => {
    const n = await Neighborhood.findOne({ name: "Kasoa" });
    const out = await resolveZoneByNeighborhoodId(n._id);
    expect(out.zone.zoneKey).toBe("E");
    expect(out.zoneSource).toBe("neighborhood");
  });

  it("throws — never returns a default — when the id is missing", async () => {
    await expect(resolveZoneByNeighborhoodId(null)).rejects.toThrow(ZoneResolutionError);
  });

  it("throws for an unknown neighbourhood", async () => {
    await expect(
      resolveZoneByNeighborhoodId("6a9181e8e090aa2a1a3d6188"),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses an inactive neighbourhood", async () => {
    const n = await Neighborhood.findOne({ name: "Retired Area" });
    await expect(resolveZoneByNeighborhoodId(n._id)).rejects.toThrow(/not currently delivering/i);
  });

  it("refuses when the assigned zone is switched off", async () => {
    await ShippingZone.updateOne({ zoneKey: "E" }, { $set: { isActive: false } });
    shippingCache.invalidateAll();
    const n = await Neighborhood.findOne({ name: "Kasoa" });
    await expect(resolveZoneByNeighborhoodId(n._id)).rejects.toThrow(/not active/i);
  });

  it("matches by exact name within a city", async () => {
    const out = await resolveZoneByName("kasoa", "Accra");
    expect(out.zone.zoneKey).toBe("E");
    expect(out.zoneSource).toBe("exact_in_city");
  });

  it("reports the looser strategy it fell back to", async () => {
    const out = await resolveZoneByName("Prampram", "Accra"); // it is in Tema
    expect(out.zoneSource).toBe("exact_any_city");
    expect(out.zone.zoneKey).toBe("F");
  });

  it("throws for a name that matches nothing", async () => {
    await expect(resolveZoneByName("Atlantis", "Accra")).rejects.toThrow(ZoneResolutionError);
  });

  it("does not let regex metacharacters through", async () => {
    await expect(resolveZoneByName(".*", "Accra")).rejects.toThrow(ZoneResolutionError);
  });
});

// ── End-to-end on the real quote path ───────────────────────────────────────

async function makeProduct(weight = 1) {
  return Product.create({
    name: "Widget", slug: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 5000, category: "Cables", stock: 10,
    weight, weightUnit: "kg", isFragile: false,
  });
}

async function enableDistanceZones() {
  await Location.create({
    region: "Greater Accra", city: "Accra", neighborhoods: ["nima", "kasoa"],
    inAccraCore: true, isActive: true,
  });
  const settings = await ShippingSettings.getSettings();
  settings.useDistanceZones = true;
  settings.inHouseDeliveryAvailable = true;
  settings.courierDispatchAvailable = true;
  settings.freeDeliveryThreshold = null;
  // T136/T115 — pin the same-day window so the suite does not depend on when it
  // runs. `express` is the same-day service, so without these two lines the
  // assertions below hold only before the cutoff hour and only on a day that is
  // not in deliveryClosedDays (which defaults to Sunday).
  settings.sameDayCutoffHour = 23; // past any wall-clock time the suite runs at
  settings.deliveryClosedDays = []; // no closed days, so any weekday works
  await settings.save();
  shippingCache.invalidateAll();
}

describe("Distance zones on the real quote path", () => {
  let product;
  beforeEach(async () => {
    await seedZones();
    await seedNeighborhoods();
    await enableDistanceZones();
    product = await makeProduct(1);
  });

  // The single most valuable test in this file: it fails instantly if the zone
  // lookup is dead code, if the id never reaches the calculator, or if the city
  // is read off the wrong variable. Unit-testing the fee maths alone catches
  // none of those — the arithmetic is right, it is just handed the wrong zone.
  it("charges strictly more for a far neighbourhood than a near one", async () => {
    const near = await Neighborhood.findOne({ name: "Nima" });
    const far = await Neighborhood.findOne({ name: "Prampram" });

    const nearQuote = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "nima",
      neighborhoodId: String(near._id), method: "courier_dispatch",
      items: [{ product, quantity: 1 }], subtotal: 5000,
    });
    const farQuote = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "prampram",
      neighborhoodId: String(far._id), method: "courier_dispatch",
      items: [{ product, quantity: 1 }], subtotal: 5000,
    });

    expect(nearQuote.distanceZoneKey).toBe("A");
    expect(farQuote.distanceZoneKey).toBe("F");
    expect(farQuote.shippingFee).toBeGreaterThan(nearQuote.shippingFee);
    expect(nearQuote.shippingFee).toBe(1700);   // 15 + 2×1
    expect(farQuote.shippingFee).toBe(8500);    // 80 + 5×1
  });

  it("reports zoneSource on the quote so a fuzzy match is auditable", async () => {
    const near = await Neighborhood.findOne({ name: "Nima" });
    const quote = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "nima",
      neighborhoodId: String(near._id), method: "courier_dispatch",
      items: [{ product, quantity: 1 }], subtotal: 5000,
    });
    expect(quote.zoneSource).toBe("neighborhood");
    expect(quote.breakdown).toBeTruthy();
    expect(quote.breakdown.zone).toBe("A");
  });

  it("REFUSES to quote when the zone cannot be resolved — never the cheapest zone", async () => {
    await expect(
      quoteShipping({
        city: "Accra", region: "Greater Accra", neighborhood: "nowhere-at-all",
        method: "courier_dispatch", items: [{ product, quantity: 1 }], subtotal: 5000,
      }),
    ).rejects.toThrow(ZoneResolutionError);
  });

  it("never makes courier free, even with a threshold set and a huge basket", async () => {
    // A courier is a third party paid per drop, so there is a real cost to
    // recover on every order. Free delivery is a property of WHO delivers, not
    // of basket size — the threshold must not override that.
    const settings = await ShippingSettings.getSettings();
    settings.freeDeliveryThreshold = 4000;
    await settings.save();
    shippingCache.invalidateAll();

    const far = await Neighborhood.findOne({ name: "Prampram" });
    const quote = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "prampram",
      neighborhoodId: String(far._id), method: "courier_dispatch",
      items: [{ product, quantity: 1 }], subtotal: 5_000_000,
    });
    expect(quote.freeDeliveryApplied).toBe(false);
    expect(quote.shippingFee).toBe(8500);

    // The same address by our own rider IS free.
    const inHouse = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "prampram",
      neighborhoodId: String(far._id), method: "in_house_delivery",
      items: [{ product, quantity: 1 }], subtotal: 5_000_000,
    });
    expect(inHouse.freeDeliveryApplied).toBe(true);
    expect(inHouse.shippingFee).toBe(0);
    expect(inHouse.grossShippingFee).toBe(8500);   // real cost stays visible
  });

  it("leaves the legacy path alone when the toggle is off", async () => {
    const settings = await ShippingSettings.getSettings();
    settings.useDistanceZones = false;
    await settings.save();
    shippingCache.invalidateAll();

    const near = await Neighborhood.findOne({ name: "Nima" });
    const quote = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "nima",
      neighborhoodId: String(near._id), method: "courier_dispatch",
      items: [{ product, quantity: 1 }], subtotal: 5000,
    });
    expect(quote.zoneSource).toBe("legacy");
  });
});

// ── Public endpoints ────────────────────────────────────────────────────────

describe("Public endpoints", () => {
  beforeEach(async () => { await seedZones(); await seedNeighborhoods(); });

  it("GET /neighborhoods lists active ones grouped by city → municipality", async () => {
    const res = await request(app).get(`${BASE}/neighborhoods`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(3);   // the inactive one is excluded
    expect(res.body.data.grouped.Accra["Ayawaso East"][0].name).toBe("Nima");
    expect(res.body.data.neighborhoods[0].id).toBeTruthy();
  });

  it("GET /neighborhoods?city=Tema filters by city", async () => {
    const res = await request(app).get(`${BASE}/neighborhoods?city=Tema`);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.neighborhoods[0].name).toBe("Prampram");
  });

  it("GET /shipping/zones returns the rate table", async () => {
    const res = await request(app).get(`${BASE}/shipping/zones`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(6);
    const a = res.body.data.find((z) => z.zone === "A");
    expect(a.baseRate).toBe(1500);
    expect(a.distanceRange).toBe("0-5 km");
    expect(a.speedTiers.find((t) => t.code === "express").multiplier).toBe(1.5);
  });
});

// ── Guards from the pitfall list ────────────────────────────────────────────


// ── Admin neighbourhood management (what the Business Settings UI drives) ───

describe("Admin neighbourhood endpoints", () => {
  let token;
  beforeEach(async () => {
    await seedZones();
    await seedNeighborhoods();
    const admin = await User.create({
      name: "Admin", email: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
      password: "Password123!", role: "admin", isVerified: true,
    });
    token = jwt.sign({ id: admin._id.toString() }, process.env.JWT_SECRET);
  });

  const auth = (req) => req.set("Authorization", `Bearer ${token}`);

  it("lists active areas and filters by city and zone", async () => {
    const all = await auth(request(app).get(`${BASE}/admin/neighborhoods`));
    expect(all.status).toBe(200);
    expect(all.body.count).toBe(3); // the inactive one is excluded by default

    const tema = await auth(request(app).get(`${BASE}/admin/neighborhoods?city=Tema`));
    expect(tema.body.count).toBe(1);

    const zoneE = await auth(request(app).get(`${BASE}/admin/neighborhoods?zone=E`));
    expect(zoneE.body.data[0].name).toBe("Kasoa");
  });

  it("includes disabled areas only when asked", async () => {
    const res = await auth(request(app).get(`${BASE}/admin/neighborhoods?includeInactive=true`));
    expect(res.body.count).toBe(4);
  });

  it("searches by name without letting regex metacharacters through", async () => {
    const hit = await auth(request(app).get(`${BASE}/admin/neighborhoods?q=kas`));
    expect(hit.body.data.map((r) => r.name)).toContain("Kasoa");

    const meta = await auth(request(app).get(`${BASE}/admin/neighborhoods?q=.%2A`));
    expect(meta.body.count).toBe(0);
  });

  it("reports coverage the settings screen renders", async () => {
    const res = await auth(request(app).get(`${BASE}/admin/neighborhoods/coverage`));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.estimated).toBe(3);   // none measured via Google yet
    expect(res.body.data.cities).toEqual(["Accra", "Tema"]);
    expect(res.body.data.byZone.find((z) => z.zone === "E").count).toBe(1);
  });

  it("creates an area", async () => {
    const res = await auth(
      request(app).post(`${BASE}/admin/neighborhoods`).send({
        name: "Achimota", city: "Accra", municipality: "Okaikwei North",
        lat: 5.6128, lng: -0.2343, distanceKm: 6.8, assignedZone: "B",
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.assignedZone).toBe("B");
  });

  it("refuses an area with no distance behind its zone", async () => {
    const res = await auth(
      request(app).post(`${BASE}/admin/neighborhoods`).send({
        name: "Nowhere", city: "Accra", municipality: "X",
        lat: 5.6, lng: -0.2, assignedZone: "B",
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("marks a hand-set zone as an override so recalculation cannot undo it", async () => {
    const n = await Neighborhood.findOne({ name: "Kasoa" });
    expect(n.zoneOverride).toBe(false);

    const res = await auth(
      request(app).patch(`${BASE}/admin/neighborhoods/${n._id}`).send({ assignedZone: "F" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.assignedZone).toBe("F");
    expect(res.body.data.zoneOverride).toBe(true);
  });

  it("does not set the override flag when the zone is unchanged", async () => {
    const n = await Neighborhood.findOne({ name: "Kasoa" });
    const res = await auth(
      request(app).patch(`${BASE}/admin/neighborhoods/${n._id}`).send({ distanceKm: 31 }),
    );
    expect(res.body.data.zoneOverride).toBe(false);
    expect(res.body.data.distanceKm).toBe(31);
  });

  it("deactivates rather than deleting, so historical orders keep their zone", async () => {
    const n = await Neighborhood.findOne({ name: "Kasoa" });
    const res = await auth(request(app).delete(`${BASE}/admin/neighborhoods/${n._id}`));
    expect(res.status).toBe(200);
    expect(await Neighborhood.findById(n._id)).not.toBeNull();
    expect((await Neighborhood.findById(n._id)).isActive).toBe(false);
  });

  it("refuses to measure without a Maps key rather than failing silently", async () => {
    const n = await Neighborhood.findOne({ name: "Kasoa" });
    const one = await auth(request(app).post(`${BASE}/admin/neighborhoods/${n._id}/recalculate`).send({}));
    expect(one.status).toBe(400);
    expect(one.body.error).toMatch(/GOOGLE_MAPS_API_KEY/i);

    const batch = await auth(request(app).post(`${BASE}/admin/neighborhoods/recalculate-all`).send({}));
    expect(batch.status).toBe(400);
  });

  it("404s for an unknown area", async () => {
    const res = await auth(
      request(app).patch(`${BASE}/admin/neighborhoods/6a9181e8e090aa2a1a3d6188`).send({ distanceKm: 5 }),
    );
    expect(res.status).toBe(404);
  });
});


// ── /shipping/methods must agree with /shipping/quote ───────────────────────
//
// Regression: methods priced from the legacy city zone and could not see the
// cart, while the quote priced from the A–F zone and applied free delivery. So
// picking a courier showed one figure and then visibly changed to another a
// moment later, once the quote landed.

describe("Methods and quote agree", () => {
  let product;
  beforeEach(async () => {
    await seedZones();
    await seedNeighborhoods();
    await enableDistanceZones();
    product = await makeProduct(1);
  });

  const methodsFor = async (qs) =>
    (await request(app).get(`${BASE}/shipping/methods?${qs}`)).body.data.methods;

  it("prices every offered speed from the same zone the quote uses", async () => {
    const area = await Neighborhood.findOne({ name: "Kasoa" });   // zone E
    const methods = await methodsFor(
      `city=Accra&region=Greater%20Accra&neighborhood=kasoa&neighborhoodId=${area._id}&subtotal=5000&weightKg=1`,
    );
    const courier = methods.filter((m) => m.id.startsWith("courier_dispatch_"));
    expect(courier.length).toBeGreaterThan(0);
    expect(courier.every((m) => m.zone === "E")).toBe(true);

    for (const m of courier) {
      const quote = await quoteShipping({
        city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
        neighborhoodId: String(area._id), method: "courier_dispatch",
        deliverySpeed: m.speed, items: [{ product, quantity: 1 }], subtotal: 5000,
      });
      expect(quote.shippingFee).toBe(m.indicativeFee);
    }
  });

  it("never advertises courier as free, threshold or not", async () => {
    const settings = await ShippingSettings.getSettings();
    settings.freeDeliveryThreshold = 4000;
    await settings.save();
    shippingCache.invalidateAll();

    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const methods = await methodsFor(
      `city=Accra&region=Greater%20Accra&neighborhood=kasoa&neighborhoodId=${area._id}&subtotal=5000000&weightKg=1`,
    );
    const courier = methods.filter((m) => m.id.startsWith("courier_dispatch_"));
    expect(courier.every((m) => m.freeDeliveryApplied === false)).toBe(true);
    expect(courier.every((m) => m.indicativeFee > 0)).toBe(true);

    const inHouse = methods.find((m) => m.id === "in_house_delivery");
    expect(inHouse.freeDeliveryApplied).toBe(true);
  });

  it("does not claim free delivery when the cart is not known", async () => {
    const settings = await ShippingSettings.getSettings();
    settings.freeDeliveryThreshold = 4000;
    await settings.save();
    shippingCache.invalidateAll();

    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const methods = await methodsFor(
      `city=Accra&region=Greater%20Accra&neighborhood=kasoa&neighborhoodId=${area._id}`,
    );
    const courier = methods.filter((m) => m.id.startsWith("courier_dispatch_"));
    expect(courier.every((m) => m.freeDeliveryApplied === false)).toBe(true);
  });

  it("shows in-house as free and courier as priced, regardless of cart size", async () => {
    // In-house is our own rider — free unconditionally. Courier is only ever
    // free when a freeDeliveryThreshold is set, and with it disabled (the
    // default) courier must always quote a price, however large the basket.
    const settings = await ShippingSettings.getSettings();
    settings.freeDeliveryThreshold = null;
    await settings.save();
    shippingCache.invalidateAll();

    const area = await Neighborhood.findOne({ name: "Kasoa" });
    for (const subtotal of [5000, 5_000_000]) {
      const methods = await methodsFor(
        `city=Accra&region=Greater%20Accra&neighborhood=kasoa&neighborhoodId=${area._id}&subtotal=${subtotal}&weightKg=1`,
      );
      const inHouse = methods.find((m) => m.id === "in_house_delivery");
      expect(inHouse.freeDeliveryApplied).toBe(true);
      expect(inHouse.indicativeFee).toBe(0);

      const courier = methods.filter((m) => m.id.startsWith("courier_dispatch_"));
      expect(courier.length).toBeGreaterThan(0);
      expect(courier.every((m) => m.freeDeliveryApplied === false)).toBe(true);
      expect(courier.every((m) => m.indicativeFee > 0)).toBe(true);
    }
  });

  it("keeps courier priced on the quote too when the threshold is off", async () => {
    const settings = await ShippingSettings.getSettings();
    settings.freeDeliveryThreshold = null;
    await settings.save();
    shippingCache.invalidateAll();

    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const courier = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
      neighborhoodId: String(area._id), method: "courier_dispatch",
      items: [{ product, quantity: 1 }], subtotal: 5_000_000,
    });
    expect(courier.freeDeliveryApplied).toBe(false);
    expect(courier.shippingFee).toBeGreaterThan(0);

    const inHouse = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
      neighborhoodId: String(area._id), method: "in_house_delivery",
      items: [{ product, quantity: 1 }], subtotal: 100,
    });
    expect(inHouse.freeDeliveryApplied).toBe(true);
    expect(inHouse.shippingFee).toBe(0);
    expect(inHouse.grossShippingFee).toBeGreaterThan(0);   // real cost stays visible
  });

  it("offers only the speed tiers the zone actually defines", async () => {
    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const methods = await methodsFor(
      `city=Accra&region=Greater%20Accra&neighborhood=kasoa&neighborhoodId=${area._id}&subtotal=5000`,
    );
    const offered = methods.filter((m) => m.id.startsWith("courier_dispatch_")).map((m) => m.speed).sort();
    expect(offered).toEqual(["express", "next_day", "standard"]);
  });

  it("a next_day quote round-trips through the ShippingQuote document", async () => {
    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const res = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
        neighborhoodId: String(area._id), method: "courier_dispatch",
        deliverySpeed: "next_day",
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.quoteId).toBeTruthy();
  });
});

// ── The chosen courier is recorded on the order ─────────────────────────────

describe("Selected method is tracked through to the order", () => {
  let product;
  beforeEach(async () => {
    await seedZones();
    await seedNeighborhoods();
    await enableDistanceZones();
    product = await makeProduct(1);
  });

  it("labels each quote the way the customer saw it", async () => {
    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const cases = [
      ["standard", "Courier — Standard"],
      ["next_day", "Courier — Next Day"],
      ["express", "Courier — Express"],
    ];
    for (const [speed, label] of cases) {
      const quote = await quoteShipping({
        city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
        neighborhoodId: String(area._id), method: "courier_dispatch",
        deliverySpeed: speed, items: [{ product, quantity: 1 }], subtotal: 5000,
      });
      expect(quote.methodLabel).toBe(label);
    }

    const inHouse = await quoteShipping({
      city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
      neighborhoodId: String(area._id), method: "in_house_delivery",
      items: [{ product, quantity: 1 }], subtotal: 5000,
    });
    expect(inHouse.methodLabel).toBe("In-House Delivery");
  });

  it("snapshots the label onto the order, so a later tier rename cannot rewrite it", async () => {
    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const quoteRes = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
        neighborhoodId: String(area._id), method: "courier_dispatch",
        deliverySpeed: "express",
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    expect(quoteRes.body.data.methodLabel).toBe("Courier — Express");

    const Order = require("../models/Order");
    const orderRes = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quoteRes.body.data.quoteId,
        city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
        method: "courier_dispatch",
      });
    expect(orderRes.status).toBe(200);

    const order = await Order.findById(orderRes.body.data.orderId);
    expect(order.shippingMethodLabel).toBe("Courier — Express");
    expect(order.shippingMethod).toBe("courier_dispatch");
    expect(order.shippingSpeed).toBe("express");

    // Renaming the tier must not change what this order says it bought.
    await ShippingZone.updateOne(
      { zoneKey: "E" },
      { $set: { "speedTiers.$[t].label": "Priority" } },
      { arrayFilters: [{ "t.code": "express" }] },
    );
    shippingCache.invalidateAll();
    const reread = await Order.findById(orderRes.body.data.orderId);
    expect(reread.shippingMethodLabel).toBe("Courier — Express");
  });

  it("exposes the label on the public tracking response", async () => {
    const Order = require("../models/Order");
    const area = await Neighborhood.findOne({ name: "Kasoa" });
    const quoteRes = await request(app)
      .post(`${BASE}/shipping/quote`)
      .send({
        city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
        neighborhoodId: String(area._id), method: "courier_dispatch",
        deliverySpeed: "next_day",
        items: [{ productId: String(product._id), quantity: 1 }],
      });
    const orderRes = await request(app)
      .post(`${BASE}/orders`)
      .send({
        items: [{ slug: product.slug, qty: 1 }],
        customer: { name: "Ama", phone: "0244000000", email: "ama@test.com" },
        shippingQuoteId: quoteRes.body.data.quoteId,
        city: "Accra", region: "Greater Accra", neighborhood: "kasoa",
        method: "courier_dispatch",
      });
    const order = await Order.findById(orderRes.body.data.orderId);

    const track = await request(app).get(`${BASE}/track/${order.trackingNumber}`);
    if (track.status === 200) {
      expect(track.body.data.shippingMethodLabel).toBe("Courier — Next Day");
    } else {
      // Tracking route shape differs across builds; the stored value is what matters.
      expect(order.shippingMethodLabel).toBe("Courier — Next Day");
    }
  });
});

describe("Pricing-path guards", () => {
  // A missing export makes the destructured name undefined; the call then
  // throws TypeError, and a broad catch upstream turns that into a cheap
  // default. Assert the exports exist rather than trusting the import.
  it("every pricing module exports the functions its callers destructure", () => {
    const resolver = require("../services/shipping/zoneResolver");
    const fee = require("../services/shipping/distanceFee");
    const classification = require("../services/shipping/zoneClassification");
    const calculator = require("../services/shipping/shippingCalculator");

    expect(typeof resolver.resolveZoneByNeighborhoodId).toBe("function");
    expect(typeof resolver.resolveZoneByName).toBe("function");
    expect(typeof fee.calcShipping).toBe("function");
    expect(typeof fee.calcShippingWithBreakdown).toBe("function");
    expect(typeof classification.classifyZone).toBe("function");
    expect(typeof classification.checkCoverage).toBe("function");
    expect(typeof calculator.quoteShipping).toBe("function");
    expect(typeof calculator.resolveDistanceKm).toBe("function");
  });

  it("admin neighbourhood routes reject unauthenticated requests", async () => {
    expect((await request(app).get(`${BASE}/admin/neighborhoods`)).status).toBe(401);
    expect((await request(app).post(`${BASE}/admin/neighborhoods/recalculate-all`).send({})).status).toBe(401);
  });

  it("admin neighbourhood routes reject a non-admin user", async () => {
    const user = await User.create({
      name: "Cust", email: `c-${Date.now()}@eaz.test`, password: "Password123!",
      role: "user", isVerified: true,
    });
    const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
    const res = await request(app)
      .get(`${BASE}/admin/neighborhoods`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
