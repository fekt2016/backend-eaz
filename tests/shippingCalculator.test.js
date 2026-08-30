// T78 Phase 2 — the shipping calculation engine. These tests pin the fee
// formula, zone/tier/weight resolution, method gating and free delivery, plus
// the TTL cache module. The calculator is the only place a shipping fee is
// ever computed, so this file is the spec.
const mongoose = require("mongoose");

const ShippingZone = require("../models/ShippingZone");
const ShippingTier = require("../models/ShippingTier");
const ShippingSettings = require("../models/ShippingSettings");
const Location = require("../models/Location");
const { DEFAULT_TIER_CATEGORY, DEFAULT_TIER } = require("../models/ShippingTier");
const calculator = require("../services/shipping/shippingCalculator");
const { createShippingCache, shippingCache } = require("../services/shipping/shippingCache");
const {
  UnsupportedDeliveryAreaError,
  DisabledDeliveryMethodError,
  OutOfRangeError,
  InvalidFulfilmentMethodError,
} = require("../services/shipping/shippingErrors");

// Rate-card fixture — mirrors src/seedShipping.js's launch numbers so the
// worked-example assertions double as documentation of the real rate card.
async function seedRates() {
  await ShippingZone.create([
    {
      name: "Accra Central",
      code: "ACC-CENTRAL",
      city: "Accra",
      neighborhoods: ["osu", "labone", "east legon", "madina"],
      distanceMinKm: 0,
      distanceMaxKm: 25,
      baseRate: 1500,
      perKgRate: 300,
      sameDayMultiplier: 1.2,
      expressMultiplier: 1.4,
      fragileSurcharge: 500,
      estimatedDays: 1,
      isDefault: true,
    },
    {
      name: "Tema Central",
      code: "TEMA-CENTRAL",
      city: "Tema",
      neighborhoods: ["community 1", "sakumono", "ashaiman"],
      distanceMinKm: 0,
      distanceMaxKm: 30,
      baseRate: 2000,
      perKgRate: 400,
      fragileSurcharge: 500,
      estimatedDays: 2,
      isDefault: true,
    },
  ]);
  await ShippingTier.create([
    { name: "Default", category: DEFAULT_TIER_CATEGORY, level: 0, multiplier: 1.0 },
    {
      name: "Screens & Displays",
      category: "Screen Protectors",
      level: 3,
      multiplier: 1.15,
      fragileSurcharge: 500,
      weightThresholdKg: 0.5,
      weightSurchargePerKg: 200,
    },
    { name: "Phones & Devices", category: "Phones", level: 3, multiplier: 1.25, fragileSurcharge: 1000 },
    // Same level as screens but a lower multiplier — loses the tie-break.
    { name: "Cheap Level 3", category: "Bulk Cartons", level: 3, multiplier: 1.05 },
  ]);
  // Launch settings, mirroring src/seedShipping.js. Note
  // courierDispatchAvailable defaults FALSE in the schema — every courier test
  // below depends on this switch being turned on explicitly.
  const settings = await ShippingSettings.getSettings();
  settings.freeDeliveryThreshold = 50_000;
  settings.inHouseDeliveryAvailable = true;
  settings.courierDispatchAvailable = true;
  settings.expressAvailable = true;
  settings.inHouseRadiusKm = null;
  // Permissive defaults so the time-independent legacy same-day assertions
  // below aren't flaky past the cutoff hour or on a closed day. The T80 E2
  // same-day describe overrides these per-test via changeSettings().
  settings.sameDayCutoffHour = 23;
  settings.deliveryClosedDays = [];
  await settings.save();
}

const line = (product, quantity = 1) => ({ product, quantity });

// Mutate the settings singleton the way an admin write does in production:
// save, then invalidate the rate cache — otherwise the calculator keeps
// quoting against its cached copy for up to the TTL.
async function changeSettings(mutate) {
  const settings = await ShippingSettings.getSettings();
  mutate(settings);
  await settings.save();
  shippingCache.invalidateAll();
}

describe("shipping cache", () => {
  it("stores, returns and invalidates values", () => {
    const cache = createShippingCache({ ttlMs: 60_000 });
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", { a: 1 });
    expect(cache.get("k")).toEqual({ a: 1 });
    cache.invalidate("k");
    expect(cache.get("k")).toBeUndefined();
  });

  it("expires entries after the TTL (injected clock)", () => {
    let t = 1_000_000;
    const cache = createShippingCache({ ttlMs: 5_000, now: () => t });
    cache.set("k", "v");
    t += 4_999;
    expect(cache.get("k")).toBe("v");
    t += 1;
    expect(cache.get("k")).toBeUndefined();
  });

  it("wrap loads once until invalidated", async () => {
    const cache = createShippingCache();
    const loader = jest.fn(async () => "fresh");
    await expect(cache.wrap("k", loader)).resolves.toBe("fresh");
    await expect(cache.wrap("k", loader)).resolves.toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(1);
    cache.invalidateAll();
    await expect(cache.wrap("k", loader)).resolves.toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("convertWeightToKg", () => {
  it("converts g → kg by ÷1000", () =>
    expect(calculator.convertWeightToKg(300, "g")).toEqual({ kg: 0.3, assumed: false }));
  it("converts lb → kg by ×0.453592", () =>
    expect(calculator.convertWeightToKg(1, "lb")).toEqual({ kg: 0.453592, assumed: false }));
  it("passes kg through", () =>
    expect(calculator.convertWeightToKg(2.5, "kg")).toEqual({ kg: 2.5, assumed: false }));
  it.each([
    ["undefined weight", undefined, "kg"],
    ["zero weight", 0, "kg"],
    ["negative weight", -3, "kg"],
    ["non-numeric weight", "heavy", "kg"],
  ])("assumes %s at the documented default", (_label, w, u) =>
    expect(calculator.convertWeightToKg(w, u)).toEqual({
      kg: calculator.ASSUMED_WEIGHT_KG,
      assumed: true,
    }));
});

describe("selectTier", () => {
  const tiers = [
    { name: "D", category: DEFAULT_TIER_CATEGORY, level: 0, multiplier: 1 },
    { category: "Screen Protectors", level: 3, multiplier: 1.15 },
    { category: "Phones", level: 3, multiplier: 1.25 },
    { category: "Cables", level: 1, multiplier: 1.0 },
  ];
  it("highest level wins in a mixed cart (one screen + twenty cables prices at screen tier)", () => {
    const tier = calculator.selectTier(tiers, ["Screen Protectors", "Cables"]);
    expect(tier.category).toBe("Screen Protectors");
  });
  it("level ties break on the higher multiplier", () => {
    const tier = calculator.selectTier(tiers, ["Screen Protectors", "Phones"]);
    expect(tier.category).toBe("Phones");
  });
  it("entirely unmapped categories resolve to the editable __default__ tier row", () => {
    const tier = calculator.selectTier(tiers, ["Something New"]);
    expect(tier.category).toBe(DEFAULT_TIER_CATEGORY);
  });
  it("with no tiers at all, falls back to the frozen constant — never throws", () => {
    const tier = calculator.selectTier([], ["Anything"]);
    expect(tier).toEqual(DEFAULT_TIER);
  });
});

describe("computeFee", () => {
  const zone = {
    baseRate: 2000,
    perKgRate: 300,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    fragileSurcharge: 500,
  };
  const plainTier = { multiplier: 1.0, weightThresholdKg: 0, weightSurchargePerKg: 0, fragileSurcharge: 0 };

  it("applies the tier multiplier with half-up pesewa rounding", () => {
    expect(
      calculator.computeFee({ zone, tier: { ...plainTier, multiplier: 1.15 }, totalWeightKg: 0, speedMultiplier: 1, anyItemFragile: false }),
    ).toBe(2300); // 2000 × 1.15
  });
  it("standard speed bills exactly the base", () =>
    expect(calculator.computeFee({ zone, tier: plainTier, totalWeightKg: 0, speedMultiplier: 1, anyItemFragile: false })).toBe(2000));
  it("same_day applies the zone's sameDayMultiplier", () =>
    expect(calculator.computeFee({ zone, tier: plainTier, totalWeightKg: 0, speedMultiplier: 1.2, anyItemFragile: false })).toBe(2400));
  it("express applies the zone's expressMultiplier", () =>
    expect(calculator.computeFee({ zone, tier: plainTier, totalWeightKg: 0, speedMultiplier: 1.4, anyItemFragile: false })).toBe(2800));

  describe("weight surcharge threshold", () => {
    const heavyTier = { multiplier: 1.0, weightThresholdKg: 5, weightSurchargePerKg: 150 };
    it("exactly at the threshold bills no surcharge", () =>
      expect(calculator.computeFee({ zone, tier: heavyTier, totalWeightKg: 5, speedMultiplier: 1, anyItemFragile: false })).toBe(2000));
    it("above the threshold bills only the excess kg", () =>
      expect(calculator.computeFee({ zone, tier: heavyTier, totalWeightKg: 7.5, speedMultiplier: 1, anyItemFragile: false })).toBe(2375)); // +2.5kg × 150
  });
  it("falls back to zone.perKgRate when the tier has no per-kg surcharge", () => {
    const tier = { multiplier: 1.0, weightThresholdKg: 1, weightSurchargePerKg: 0 };
    // 3kg − 1kg threshold = 2 billable kg × zone's 300 = +600
    expect(calculator.computeFee({ zone, tier, totalWeightKg: 3, speedMultiplier: 1, anyItemFragile: false })).toBe(2600);
  });
  it("fragile adds tier + zone surcharges once for the whole order", () => {
    const tier = { ...plainTier, fragileSurcharge: 250 };
    expect(calculator.computeFee({ zone, tier, totalWeightKg: 0, speedMultiplier: 1, anyItemFragile: true })).toBe(2750);
    expect(calculator.computeFee({ zone, tier, totalWeightKg: 0, speedMultiplier: 1, anyItemFragile: false })).toBe(2000);
  });
});

describe("zone resolution helpers", () => {
  const accra = { name: "A Zone", city: "Accra", neighborhoods: ["east legon", "legon"], distanceMinKm: 10 };
  const tema = { name: "T Zone", city: "Tema", neighborhoods: ["sakumono"] };
  const zones = [
    accra,
    tema,
    { name: "B Zone", city: "Accra", neighborhoods: [], distanceMinKm: 5 },
  ];

  it("matches a neighbourhood directly from the dropdown selection", () => {
    const zone = calculator.pickZoneByNeighborhood(zones.filter((z) => z.city === "Accra"), "east legon");
    expect(zone.name).toBe("A Zone");
  });
  it("matches neighbourhood case-insensitively", () => {
    const zone = calculator.pickZoneByNeighborhood([accra], "East Legon");
    expect(zone).toBeTruthy();
  });
  it("returns null when nothing matches", () => {
    expect(calculator.pickZoneByNeighborhood(zones, "takoradi")).toBeNull();
  });
  it("returns null for empty neighbourhood", () => {
    expect(calculator.pickZoneByNeighborhood(zones, "")).toBeNull();
  });
  it("fallback prefers an isDefault-flagged zone", () => {
    const pool = [
      { name: "Zulu", city: "X", neighborhoods: [], distanceMinKm: 0 },
      { name: "Alpha", city: "X", neighborhoods: [], distanceMinKm: 99, isDefault: true },
    ];
    expect(calculator.pickFallbackZone(pool).name).toBe("Alpha");
  });
  it("without a flag, fallback takes lowest distanceMinKm then name asc", () => {
    const pool = [
      { name: "B", city: "X", neighborhoods: [], distanceMinKm: 5 },
      { name: "A", city: "X", neighborhoods: [], distanceMinKm: 5 },
      { name: "C", city: "X", neighborhoods: [], distanceMinKm: 1 },
    ];
    expect(calculator.pickFallbackZone(pool).name).toBe("C");
  });
});

describe("quoteShipping", () => {
  beforeEach(async () => {
    // setup.js wipes the collections, but the in-process rate cache survives
    // between tests — exactly what an admin write invalidates in production.
    shippingCache.invalidateAll();
    await seedRates();
  });

  const accraScreen = { _id: new mongoose.Types.ObjectId(), name: "iPhone 12 Screen", category: "Screen Protectors", weight: 0.3, weightUnit: "kg", isFragile: true };

  it("worked example — 2 fragile Accra screens, standard in-house", async () => {
    const quote = await calculator.quoteShipping({
      city: "Accra",
      neighborhood: "east legon",
      method: "in_house_delivery",
      items: [line(accraScreen, 2)],
      subtotal: 24_000,
    });
    // In-house delivery is always free — gross fee is still computed.
    // base 1500 × 1.15 = 1725 · standard ×1 · (0.6−0.5)kg × 200 ≈ +20 · +500+500 fragile
    expect(quote.shippingFee).toBe(0);
    expect(quote.grossShippingFee).toBe(2745);
    expect(quote.freeDeliveryApplied).toBe(true);
    expect(quote.zoneCode).toBe("ACC-CENTRAL");
    expect(quote.tierLevel).toBe(3);
    expect(quote.totalWeightKg).toBe(0.6);
    expect(quote.weightAssumed).toBe(false);
    expect(quote.estimatedDays).toBe(1);
    expect(quote.currency).toBe("GHS");
  });

  it("same_day multiplies via the zone card", async () => {
    // same_day is off by default now (ShippingSettings.sameDayAvailable); the
    // multiplier it carries is still the zone's, which is what this asserts.
    await changeSettings((s) => {
      s.sameDayAvailable = true;
      s.sameDayCutoffHour = 23;
      s.deliveryClosedDays = [];
    });
    const quote = await calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "in_house_delivery", deliverySpeed: "same_day",
      items: [line({ ...accraScreen, isFragile: false }, 1)], subtotal: 12_000,
    });
    expect(quote.grossShippingFee).toBe(2070); // round(round(1725) × 1.2) + 0 fragile
    expect(quote.shippingFee).toBe(0); // in-house is always free
    expect(quote.freeDeliveryApplied).toBe(true);
  });

  it("courier dispatch quotes the same formula when enabled", async () => {
    const quote = await calculator.quoteShipping({
      city: "Tema",
      neighborhood: "community 1",
      method: "courier_dispatch",
      items: [line({ _id: "p1", category: "Unknown Stuff", weight: 0 }, 1)],
      subtotal: 5_000,
    });
    // weight 0 ⇒ assumed at 0.5 kg; default tier has no per-kg surcharge so the
    // zone's 400/kg applies to that 0.5 kg: 2000 + 0.5×400 = 2200
    expect(quote.zoneCode).toBe("TEMA-CENTRAL");
    expect(quote.weightAssumed).toBe(true);
    expect(quote.shippingFee).toBe(2200);
  });

  it("in-house delivery zeroes the fee but keeps grossShippingFee", async () => {
    // Our own rider: free, with the cost we absorbed still visible.
    const quote = await calculator.quoteShipping({
      city: "Accra", neighborhood: "labone", method: "in_house_delivery",
      items: [line({ _id: "p2", category: "Misc", weight: 1 }, 1)], subtotal: 50_000,
    });
    expect(quote.freeDeliveryApplied).toBe(true);
    expect(quote.shippingFee).toBe(0);
    expect(quote.grossShippingFee).toBeGreaterThan(0);
  });

  it("courier pays full freight no matter how large the basket", async () => {
    // A third party is paid per drop, so courier is never free — basket size
    // does not change that.
    for (const subtotal of [49_999, 50_000, 5_000_000]) {
      const quote = await calculator.quoteShipping({
        city: "Accra", neighborhood: "labone", method: "courier_dispatch",
        items: [line({ _id: "p3", category: "Misc", weight: 1 }, 1)], subtotal,
      });
      expect(quote.freeDeliveryApplied).toBe(false);
      expect(quote.shippingFee).toBe(quote.grossShippingFee);
      expect(quote.shippingFee).toBeGreaterThan(0);
    }
  });

  it("unsupported city raises UnsupportedDeliveryAreaError naming the cities", async () => {
    await expect(calculator.quoteShipping({
      city: "Kumasi", neighborhood: "adum", method: "courier_dispatch",
      items: [line({ _id: "p4", category: "Misc" }, 1)], subtotal: 100,
    })).rejects.toThrow(UnsupportedDeliveryAreaError);
  });

  it("disabled methods are rejected before any maths", async () => {
    await changeSettings((s) => { s.inHouseDeliveryAvailable = false; });
    await expect(calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "in_house_delivery",
      items: [line(accraScreen, 1)], subtotal: 100,
    })).rejects.toThrow(DisabledDeliveryMethodError);

    await changeSettings((s) => { s.courierDispatchAvailable = false; });
    await expect(calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "courier_dispatch",
      items: [line(accraScreen, 1)], subtotal: 100,
    })).rejects.toThrow(DisabledDeliveryMethodError);
  });

  it("zones beyond the in-house radius are pushed to courier", async () => {
    await changeSettings((s) => { s.inHouseRadiusKm = 20; });
    // Tema Central reaches 30km — outside a 20km rider radius.
    await expect(calculator.quoteShipping({
      city: "Tema", neighborhood: "ashaiman", method: "in_house_delivery",
      items: [line({ _id: "p5", category: "Misc", weight: 1 }, 1)], subtotal: 100,
    })).rejects.toThrow(OutOfRangeError);
    // …but courier dispatch still serves it.
    await expect(calculator.quoteShipping({
      city: "Tema", neighborhood: "ashaiman", method: "courier_dispatch",
      items: [line({ _id: "p6", category: "Misc", weight: 1 }, 1)], subtotal: 100,
    })).resolves.toMatchObject({ method: "courier_dispatch" });
  });

  it("express is refused while settings.expressAvailable is false", async () => {
    await changeSettings((s) => { s.expressAvailable = false; });
    await expect(calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "courier_dispatch", deliverySpeed: "express",
      items: [line(accraScreen, 1)], subtotal: 100,
    })).rejects.toThrow(DisabledDeliveryMethodError);
  });

  it("quantity multiplies into the billable weight", async () => {
    const cable = { _id: "p7", category: "Bulk Cartons", weight: 2 }; // tier level 3 mult 1.05
    const one = await calculator.quoteShipping({ city: "Tema", neighborhood: "sakumono", method: "courier_dispatch", items: [line(cable, 1)], subtotal: 0 });
    const three = await calculator.quoteShipping({ city: "Tema", neighborhood: "sakumono", method: "courier_dispatch", items: [line(cable, 3)], subtotal: 0 });
    // base 2000×1.05=2100; +6kg over 0-threshold × 400 (tier has no surcharge → zone perKg)
    expect(one.shippingFee).toBe(2100 + 2 * 400);
    expect(three.shippingFee).toBe(2100 + 6 * 400);
  });
});

// ── T80 E2 ──────────────────────────────────────────────────────────────────
// The shipping expansion: region/city/neighborhood taxonomy, Greater-Accra
// distance pricing, regional bus-station-pickup pricing, and the same-day /
// Mon-Sat delivery rules. The calculator is the server-side authority for all
// of it, so these tests pin down the E2 rules exactly as the seed installs them.

// Freeze the process clock so the time-dependent same-day rules are
// deterministic. `iso` must be a Monday (day 1) or a weekday (1–5) to exercise
// the open-day branch; pick a fixed Wednesday to be safe.
function freezeNow(iso = "2026-08-26T10:00:00.000Z") {
  const RealDate = global.Date;
  const fixed = new RealDate(iso).getTime();
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  // Swap in the frozen clock. MockDate extends RealDate so the inherited
  // statics (parse, UTC) and a working `now()` stay intact — MongoDB's ObjectId
  // generator calls `Date.now()`, which must still return a number.
  global.Date = MockDate;
  return () => { global.Date = RealDate; };
}

describe("T80 E2 — same-day cutoff + Mon-Sat rules", () => {
  beforeEach(async () => {
    shippingCache.invalidateAll();
    await seedRates();
  });

  it("refuses same-day when the local hour is past the cutoff (cutoff=0 always past)", async () => {
    await changeSettings((s) => {
      s.sameDayCutoffHour = 0; // midnight: any hour is past the cutoff
      s.deliveryClosedDays = [];
    });
    await expect(calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "courier_dispatch", deliverySpeed: "same_day",
      items: [line({ _id: "c1", category: "Misc", weight: 1 }, 1)], subtotal: 0,
    })).rejects.toThrow(DisabledDeliveryMethodError);
  });

  it("accepts same-day before the cutoff on an open (non-closed) weekday", async () => {
    const restore = freezeNow("2026-08-26T10:00:00.000Z"); // Wednesday
    try {
      await changeSettings((s) => {
        s.sameDayAvailable = true; // the master switch, off by default
        s.sameDayCutoffHour = 23; // well past any open morning hour
        s.deliveryClosedDays = []; // no closed days — weekday is open
      });
      const quote = await calculator.quoteShipping({
        city: "Accra", neighborhood: "osu", method: "courier_dispatch", deliverySpeed: "same_day",
        items: [line({ _id: "c2", category: "Misc", weight: 1 }, 1)], subtotal: 0,
      });
      expect(quote.deliverySpeed).toBe("same_day");
      expect(quote.shippingFee).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("refuses same-day on a closed weekday (setting deliveryClosedDays = today)", async () => {
    const restore = freezeNow("2026-08-26T10:00:00.000Z"); // Wednesday → day 3
    try {
      await changeSettings((s) => {
        s.sameDayCutoffHour = 23;
        s.deliveryClosedDays = [3]; // close Wednesday specifically
      });
      await expect(calculator.quoteShipping({
        city: "Accra", neighborhood: "osu", method: "courier_dispatch", deliverySpeed: "same_day",
        items: [line({ _id: "c3", category: "Misc", weight: 1 }, 1)], subtotal: 0,
      })).rejects.toThrow(DisabledDeliveryMethodError);
    } finally {
      restore();
    }
  });

  it("default-closed Sunday: same-day on a Sunday is refused even before the cutoff", async () => {
    // Default deliveryClosedDays = [0] (Sunday). Freeze to a Sunday.
    const restore = freezeNow("2026-08-30T10:00:00.000Z"); // 2026-08-30 is a Sunday
    try {
      await changeSettings((s) => {
        s.sameDayCutoffHour = 23; // before cutoff, but closed day
        s.deliveryClosedDays = [0];
      });
      await expect(calculator.quoteShipping({
        city: "Accra", neighborhood: "osu", method: "courier_dispatch", deliverySpeed: "same_day",
        items: [line({ _id: "c4", category: "Misc", weight: 1 }, 1)], subtotal: 0,
      })).rejects.toThrow(DisabledDeliveryMethodError);
    } finally {
      restore();
    }
  });

  it("bus-station pickup is unaffected by the same-day cutoff/mon-sat rules", async () => {
    await changeSettings((s) => {
      s.sameDayCutoffHour = 0; // would block same-day delivery
      s.pickupAvailable = true;
    });
    await Location.create({ region: "Ashanti", city: "Kumasi", inAccraCore: false, neighborhoods: [], isActive: true });
    await ShippingZone.create({
      name: "Ashanti Region", code: "ASHANTI", city: "Kumasi", region: "Ashanti",
      inAccraCore: false, pickupMode: "bus_station", neighborhoods: [],
      baseRate: 0, perKgRate: 0, fragileSurcharge: 500,
      regionalBaseFee: 2000, regionalPricePerKg: 400, estimatedDays: 3, isActive: true,
    });
    const quote = await calculator.quoteShipping({
      city: "Kumasi", method: "bus_station_pickup", deliverySpeed: "standard",
      items: [line({ _id: "c5", category: "Misc", weight: 1 }, 1)], subtotal: 0,
      region: "Ashanti",
    });
    expect(quote.isPickup).toBe(true);
    expect(quote.shippingFee).toBeGreaterThan(0);
  });
});

describe("T80 E2 — Greater-Accra distance formula", () => {
  beforeEach(async () => {
    shippingCache.invalidateAll();
    await seedRates();
  });

  it("uses the E2 distance fields when the zone opts in (distanceBaseFee + pricePerKm + pricePerKg)", async () => {
    await ShippingZone.updateOne(
      { code: "ACC-CENTRAL" },
      { $set: { distanceBaseFee: 1000, pricePerKm: 100, pricePerKg: 200 } },
    );
    shippingCache.invalidate("zones");
    // Accra Central distance band 0–25 km → midpoint 12.5; 1 kg non-fragile.
    // 1000 + 12.5×100 + 1×200 = 2450
    const quote = await calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "courier_dispatch",
      items: [line({ _id: "d1", category: "Misc", weight: 1 }, 1)], subtotal: 0,
    });
    expect(quote.shippingFee).toBe(2450);
    expect(quote.zoneCode).toBe("ACC-CENTRAL");
  });

  it("adds the fragile surcharge once for the whole order", async () => {
    await ShippingZone.updateOne(
      { code: "ACC-CENTRAL" },
      { $set: { distanceBaseFee: 1000, pricePerKm: 100, pricePerKg: 200, fragileSurcharge: 500 } },
    );
    shippingCache.invalidate("zones");
    const quote = await calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "courier_dispatch",
      items: [line({ _id: "d2", category: "Misc", weight: 1, isFragile: true }, 1)], subtotal: 0,
    });
    // 2450 + 500 fragile = 2950 (region-independent; tier fragile not applied here)
    expect(quote.shippingFee).toBe(2950);
  });
});

describe("T80 E2 — regional bus-station-pickup formula", () => {
  beforeEach(async () => {
    shippingCache.invalidateAll();
    await seedRates();
    // Pickup must be switched on so these tests reach the pricing formula rather
    // than being short-circuited by the availability gate.
    await changeSettings((s) => { s.pickupAvailable = true; });
  });

  it("prices a regional pickup by regionalBaseFee + weight × regionalPricePerKg", async () => {
    await Location.create({ region: "Ashanti", city: "Kumasi", inAccraCore: false, neighborhoods: [], isActive: true });
    await ShippingZone.create({
      name: "Ashanti Region", code: "ASHANTI", city: "Kumasi", region: "Ashanti",
      inAccraCore: false, pickupMode: "bus_station", neighborhoods: [],
      baseRate: 0, perKgRate: 0, fragileSurcharge: 500,
      regionalBaseFee: 2000, regionalPricePerKg: 400, estimatedDays: 3, isActive: true,
    });
    // 2 kg → 2000 + 2×400 = 2800
    const quote = await calculator.quoteShipping({
      city: "Kumasi", neighborhood: "", method: "bus_station_pickup",
      items: [line({ _id: "r1", category: "Misc", weight: 2 }, 1)], subtotal: 0,
      region: "Ashanti", pickupLocationId: "000000000000000000000000",
    });
    expect(quote.isPickup).toBe(true);
    expect(quote.shippingFee).toBe(2800);
    expect(quote.grossShippingFee).toBe(2800);
    expect(quote.freeDeliveryApplied).toBe(false);
    expect(quote.region).toBe("Ashanti");
  });

  it("regional pickup is always charged (no free delivery)", async () => {
    await Location.create({ region: "Eastern", city: "Koforidua", inAccraCore: false, neighborhoods: [], isActive: true });
    await ShippingZone.create({
      name: "Eastern Region", code: "EASTERN", city: "Koforidua", region: "Eastern",
      inAccraCore: false, pickupMode: "bus_station", neighborhoods: [],
      baseRate: 0, perKgRate: 0, fragileSurcharge: 0,
      regionalBaseFee: 1500, regionalPricePerKg: 300, estimatedDays: 2, isActive: true,
    });
    const quote = await calculator.quoteShipping({
      city: "Koforidua", neighborhood: "", method: "bus_station_pickup",
      items: [line({ _id: "r2", category: "Misc", weight: 0 }, 1)], subtotal: 100_000,
      region: "Eastern", pickupLocationId: "000000000000000000000000",
    });
    // weight 0 → assumed 0.5 → 1500 + 0.5×300 = 1650; free threshold ignored for pickup
    expect(quote.shippingFee).toBe(1650);
    expect(quote.freeDeliveryApplied).toBe(false);
  });
});

describe("T80 E2 — fulfilment-method gating", () => {
  beforeEach(async () => {
    shippingCache.invalidateAll();
    await seedRates();
    // Enable pickup so the gate is the thing under test; the dedicated test
    // below re-disables it to assert the availability switch behaviour.
    await changeSettings((s) => { s.pickupAvailable = true; });
  });

  it("blocks home delivery outside the Greater-Accra core (regional address)", async () => {
    await Location.create({ region: "Ashanti", city: "Kumasi", inAccraCore: false, neighborhoods: [], isActive: true });
    await ShippingZone.create({
      name: "Ashanti Region", code: "ASHANTI", city: "Kumasi", region: "Ashanti",
      inAccraCore: false, pickupMode: "bus_station", neighborhoods: [],
      baseRate: 0, perKgRate: 0, fragileSurcharge: 500,
      regionalBaseFee: 2000, regionalPricePerKg: 400, estimatedDays: 3, isActive: true,
    });
    await expect(calculator.quoteShipping({
      city: "Kumasi", neighborhood: "", method: "courier_dispatch",
      items: [line({ _id: "g1", category: "Misc", weight: 1 }, 1)], subtotal: 0,
      region: "Ashanti",
    })).rejects.toThrow(InvalidFulfilmentMethodError);
  });

  it("blocks bus-station pickup inside the Greater-Accra core (Accra address)", async () => {
    // seedRates registers Accra Central with region unset → legacy in-core via
    // Accra enum. Enforce region resolution for an in-core city to hit the gate.
    await Location.create({ region: "Greater Accra", city: "Accra", inAccraCore: true, neighborhoods: ["osu"], isActive: true });
    await ShippingZone.create({
      name: "Accra Central", code: "ACC-X", city: "Accra", region: "Greater Accra",
      inAccraCore: true, pickupMode: "none", neighborhoods: ["osu"],
      baseRate: 1500, perKgRate: 300, regionalBaseFee: 2000, regionalPricePerKg: 400,
      estimatedDays: 1, isActive: true,
    });
    await expect(calculator.quoteShipping({
      city: "Accra", neighborhood: "osu", method: "bus_station_pickup",
      items: [line({ _id: "g2", category: "Misc", weight: 1 }, 1)], subtotal: 0,
      region: "Greater Accra", pickupLocationId: "000000000000000000000000",
    })).rejects.toThrow(InvalidFulfilmentMethodError);
  });

  it("refuses bus-station pickup when settings.pickupAvailable is false", async () => {
    await changeSettings((s) => { s.pickupAvailable = false; });
    await Location.create({ region: "Ashanti", city: "Kumasi", inAccraCore: false, neighborhoods: [], isActive: true });
    await ShippingZone.create({
      name: "Ashanti Region", code: "ASHANTI", city: "Kumasi", region: "Ashanti",
      inAccraCore: false, pickupMode: "bus_station", neighborhoods: [],
      baseRate: 0, perKgRate: 0, regionalBaseFee: 2000, regionalPricePerKg: 400, estimatedDays: 3, isActive: true,
    });
    await expect(calculator.quoteShipping({
      city: "Kumasi", neighborhood: "", method: "bus_station_pickup",
      items: [line({ _id: "g3", category: "Misc", weight: 1 }, 1)], subtotal: 0,
      region: "Ashanti",
    })).rejects.toThrow(DisabledDeliveryMethodError);
  });
});

// T114 (owner, 2026-08-29): the cutoff moved from noon to 5 PM. Express is the
// same-day service, so a noon cutoff withdrew the only "today" option halfway
// through the working day — and it made two suites pass or fail on wall-clock
// time. These pin the default and the customer-facing wording; they inject
// `now`, so they do not care what time the suite runs at.
// T136 (found during T120, 2026-08-30): `deliveryClosedDays: []` meant "Sunday
// is closed", not "nothing is closed". The check was
// `Array.isArray(x) && x.length`, and [] is falsy on .length, so an explicit
// empty array was indistinguishable from an unset field and fell through to the
// [0] default. Two consequences: an admin who cleared every closed day could not
// actually get seven-day delivery, and 10 tests across 5 shipping suites failed
// every Sunday. These pin the three cases apart so a future refactor cannot
// collapse them again. `now` is injected, so the day is chosen, not ambient.
describe("deliveryClosedDays — empty means none, missing means Sunday (T136)", () => {
  // A concrete Sunday and Monday, so this does not depend on when it runs.
  const SUNDAY = new Date("2026-08-30T16:30:00");
  const MONDAY = new Date("2026-08-31T16:30:00");

  it("treats an explicit empty array as no closed days", () => {
    expect(calculator.sameDayWindowOpen({ deliveryClosedDays: [] }, "express", SUNDAY).open).toBe(true);
    expect(calculator.sameDayWindowOpen({ deliveryClosedDays: [] }, "express", MONDAY).open).toBe(true);
  });

  it("falls back to Sunday-closed only when the field is missing", () => {
    expect(calculator.sameDayWindowOpen({}, "express", SUNDAY).open).toBe(false);
    expect(calculator.sameDayWindowOpen({}, "express", MONDAY).open).toBe(true);
  });

  it("honours an explicit list, including one that does not contain Sunday", () => {
    const wedOnly = { deliveryClosedDays: [3] };
    expect(calculator.sameDayWindowOpen(wedOnly, "express", SUNDAY).open).toBe(true);
    const sunAndMon = { deliveryClosedDays: [0, 1] };
    expect(calculator.sameDayWindowOpen(sunAndMon, "express", SUNDAY).open).toBe(false);
    expect(calculator.sameDayWindowOpen(sunAndMon, "express", MONDAY).open).toBe(false);
  });

  it("still applies the time cutoff on an open day", () => {
    const lateSunday = new Date("2026-08-30T18:30:00");
    expect(calculator.sameDayWindowOpen({ deliveryClosedDays: [] }, "express", lateSunday).open).toBe(false);
  });
});

describe("same-day window — 5 PM cutoff (T114)", () => {
  const at = (hour) => {
    const d = new Date();
    d.setHours(hour, 30, 0, 0);
    return d;
  };
  const open = () => ({ deliveryClosedDays: [] });

  it("defaults to 5 PM when the setting is absent, not noon", async () => {
    // A settings row saved before this field existed must not be stricter than
    // a fresh one — the calculator's fallback tracks the model default.
    expect(calculator.sameDayWindowOpen(open(), "express", at(16)).open).toBe(true);
    expect(calculator.sameDayWindowOpen(open(), "express", at(17)).open).toBe(false);
  });

  it("uses the configured hour when one is set", async () => {
    const s = { ...open(), sameDayCutoffHour: 12 };
    expect(calculator.sameDayWindowOpen(s, "express", at(11)).open).toBe(true);
    expect(calculator.sameDayWindowOpen(s, "express", at(12)).open).toBe(false);
  });

  it("states the hour in 12-hour time, not 17:00", async () => {
    const closed = calculator.sameDayWindowOpen(open(), "express", at(18));
    expect(closed.reason).toContain("5:00 PM");
    expect(closed.reason).not.toContain("17:00");

    const noon = calculator.sameDayWindowOpen(
      { ...open(), sameDayCutoffHour: 12 }, "express", at(13),
    );
    expect(noon.reason).toContain("12:00 PM");
  });

  it("closes on a closed day even before the cutoff", async () => {
    const today = new Date().getDay();
    const s = { deliveryClosedDays: [today] };
    expect(calculator.sameDayWindowOpen(s, "express", at(9)).open).toBe(false);
  });
});
