// Each courier speed tier states its own delivery promise.
//
// The zones were seeded with `SPEED_TIERS(z.eta, z.eta)` — standard, next_day
// and express sharing one ETA — so "Courier — Next Day" advertised 1-2 days
// (2-3 in the outer zones): slower than its name, and 20% dearer than Standard
// for no stated benefit.
const ShippingZone = require("../models/ShippingZone");
const { updateSpeedTierEtas, TIER_ETAS } = require("../scripts/updateSpeedTierEtas");

const silent = () => {};

async function makeZone(zoneKey, sharedEta) {
  return ShippingZone.create({
    name: `Zone ${zoneKey}`,
    code: `ZONE-${zoneKey}`,
    zoneKey,
    city: "Accra",
    baseRate: 3000,
    perKgRate: 250,
    estimatedDays: 2,
    speedTiers: [
      { code: "standard", label: "Standard", multiplier: 1.0, estimatedDays: sharedEta },
      { code: "next_day", label: "Next Day", multiplier: 1.2, estimatedDays: sharedEta },
      { code: "express", label: "Express", multiplier: 1.5, estimatedDays: sharedEta },
    ],
  });
}

const tierEta = (zone, code) =>
  String(zone.speedTiers.find((t) => t.code === code).estimatedDays);

describe("updateSpeedTierEtas", () => {
  it("writes nothing on a dry run", async () => {
    const zone = await makeZone("A", "1-2");

    const res = await updateSpeedTierEtas({ log: silent });

    expect(res.updated).toBe(0);
    expect(tierEta(await ShippingZone.findById(zone._id).lean(), "standard")).toBe("1-2");
  });

  it("gives standard 1-3 days and next day a single day", async () => {
    const zone = await makeZone("D", "2-3");

    await updateSpeedTierEtas({ apply: true, log: silent });
    const updated = await ShippingZone.findById(zone._id).lean();

    expect(tierEta(updated, "standard")).toBe("1-3");
    expect(tierEta(updated, "next_day")).toBe("1");
  });

  it("makes express the same-day tier", async () => {
    // Express is the same-day service now — which is why the separate same_day
    // tier is no longer offered.
    const zone = await makeZone("D", "2-3");

    await updateSpeedTierEtas({ apply: true, log: silent });

    expect(tierEta(await ShippingZone.findById(zone._id).lean(), "express")).toBe("0");
  });

  it("leaves a tier it does not own untouched", async () => {
    const zone = await ShippingZone.create({
      name: "Zone F", code: "ZONE-F", zoneKey: "F", city: "Accra",
      baseRate: 3000, perKgRate: 250, estimatedDays: 2,
      speedTiers: [
        { code: "standard", label: "Standard", multiplier: 1.0, estimatedDays: "2-3" },
        { code: "same_day", label: "Same Day", multiplier: 1.2, estimatedDays: "1" },
      ],
    });

    await updateSpeedTierEtas({ apply: true, log: silent });
    const updated = await ShippingZone.findById(zone._id).lean();

    expect(tierEta(updated, "standard")).toBe("1-3");
    expect(tierEta(updated, "same_day")).toBe("1"); // not in TIER_ETAS
  });

  it("moves no price", async () => {
    const zone = await makeZone("B", "1-2");
    const before = await ShippingZone.findById(zone._id).lean();

    await updateSpeedTierEtas({ apply: true, log: silent });
    const after = await ShippingZone.findById(zone._id).lean();

    expect(after.baseRate).toBe(before.baseRate);
    expect(after.perKgRate).toBe(before.perKgRate);
    expect(after.speedTiers.map((t) => t.multiplier)).toEqual(
      before.speedTiers.map((t) => t.multiplier),
    );
  });

  it("is idempotent — a second run changes nothing", async () => {
    await makeZone("A", "1-2");
    await updateSpeedTierEtas({ apply: true, log: silent });

    const second = await updateSpeedTierEtas({ apply: true, log: silent });

    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("states a promise for exactly the tiers it owns", async () => {
    // A guard on the map itself: adding a tier here changes what customers are
    // promised, so it should be a deliberate edit rather than a side effect.
    expect(TIER_ETAS).toEqual({ standard: "1-3", next_day: "1", express: "0" });
  });
});
