/**
 * zoneClassification.js — distance → zone, derived from the ShippingZone
 * documents and nowhere else.
 *
 * THE RULE: there is exactly one copy of the zone boundaries, and it lives in
 * the database. Duplicating them into a constant here (or into a seed file, or
 * into a second classifier) is how the numbers drift apart — each copy looks
 * correct in isolation, no two agree, and which price a customer gets depends
 * on which function happened to be called. If another entry point needs to
 * classify, it calls this module; it does not re-implement the thresholds.
 *
 * THE OTHER RULE: never map "I don't know" to a zone. An invalid distance and
 * an out-of-range distance both throw. A classifier that returns a zone for a
 * failed geocode turns a visible error into a silently mispriced delivery.
 */
const ShippingZone = require("../../models/ShippingZone");
const { MAX_SERVICEABLE_KM } = require("../../config/warehouseConfig");
const { OutOfRangeError, UnsupportedDeliveryAreaError } = require("./shippingErrors");
const { shippingCache } = require("./shippingCache");
const logger = require("../../utils/logger");

class InvalidDistanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidDistanceError";
    this.statusCode = 400;
  }
}

/** The six banded zones, cached like the rest of the rate card. */
async function loadDistanceZones() {
  return shippingCache.wrap("distanceZones", () => ShippingZone.getActiveZones());
}

/**
 * Assert the active bands tile [0, MAX_SERVICEABLE_KM) with no gap and no
 * overlap. Returns a list of problems (empty when healthy) rather than
 * throwing, so a caller can decide whether to warn or refuse to boot.
 *
 * Run this at startup: a bad admin edit then surfaces on deploy, not on a
 * customer's checkout.
 */
function checkCoverage(zones) {
  const problems = [];
  if (!zones.length) return ["No active distance zones are configured."];

  const sorted = [...zones].sort((a, b) => a.distanceMinKm - b.distanceMinKm);

  for (const zone of sorted) {
    if (zone.distanceMinKm == null || zone.distanceMaxKm == null) {
      problems.push(`Zone ${zone.zoneKey || zone.code} has no distance band.`);
    } else if (zone.distanceMaxKm <= zone.distanceMinKm) {
      problems.push(
        `Zone ${zone.zoneKey || zone.code} has an empty band (${zone.distanceMinKm}–${zone.distanceMaxKm}).`,
      );
    }
  }
  if (problems.length) return problems;

  if (sorted[0].distanceMinKm !== 0) {
    problems.push(`Coverage starts at ${sorted[0].distanceMinKm} km, not 0.`);
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.distanceMinKm > prev.distanceMaxKm) {
      problems.push(
        `Gap between ${prev.zoneKey || prev.code} (ends ${prev.distanceMaxKm}) and ` +
          `${curr.zoneKey || curr.code} (starts ${curr.distanceMinKm}) — a distance in ` +
          "between belongs to no zone.",
      );
    } else if (curr.distanceMinKm < prev.distanceMaxKm) {
      problems.push(
        `Overlap between ${prev.zoneKey || prev.code} and ${curr.zoneKey || curr.code} ` +
          `at ${curr.distanceMinKm} km.`,
      );
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.distanceMaxKm < MAX_SERVICEABLE_KM) {
    problems.push(
      `Coverage ends at ${last.distanceMaxKm} km but the serviceable radius is ${MAX_SERVICEABLE_KM} km.`,
    );
  }
  return problems;
}

/** Log the coverage verdict once at boot. Never throws — logging only. */
async function assertCoverageAtStartup() {
  try {
    const zones = await loadDistanceZones();
    if (!zones.length) {
      logger.warn("[shipping] no distance zones configured — distance pricing is inactive");
      return [];
    }
    const problems = checkCoverage(zones);
    if (problems.length) {
      problems.forEach((p) => logger.error(`[shipping] zone coverage: ${p}`));
    } else {
      logger.info(
        `[shipping] ${zones.length} distance zones cover 0–${zones[zones.length - 1].distanceMaxKm} km with no gaps`,
      );
    }
    return problems;
  } catch (err) {
    logger.error(`[shipping] zone coverage check failed: ${err.message}`);
    return [`Coverage check failed: ${err.message}`];
  }
}

/**
 * The zone key for a driving distance.
 *
 * @throws {InvalidDistanceError} the distance is missing, NaN or negative —
 *   an unknown distance is not a cheap zone, it is an error.
 * @throws {OutOfRangeError} the address is past the serviceable radius. NOT
 *   the most expensive zone: "we don't deliver there" and "that costs the most"
 *   are different answers and the customer deserves the right one.
 */
async function classifyZone(distanceKm) {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new InvalidDistanceError(
      `Cannot determine a shipping zone: "${distanceKm}" is not a valid distance.`,
    );
  }

  const zones = await loadDistanceZones();
  if (!zones.length) throw new UnsupportedDeliveryAreaError([]);

  const match = zones.find(
    (z) => distanceKm >= z.distanceMinKm && distanceKm < z.distanceMaxKm,
  );
  if (match) return match.zoneKey;

  const furthest = Math.max(...zones.map((z) => z.distanceMaxKm));
  if (distanceKm >= furthest) {
    throw new OutOfRangeError(
      `We do not deliver ${distanceKm} km out — our service area reaches ${furthest} km.`,
    );
  }
  // Inside the radius but matching nothing means the bands have a hole in
  // them. Say so plainly rather than rounding the customer into a zone.
  throw new InvalidDistanceError(
    `No shipping zone covers ${distanceKm} km. The configured zone bands have a gap — ` +
      "check Business Settings → Shipping.",
  );
}

module.exports = {
  classifyZone,
  loadDistanceZones,
  checkCoverage,
  assertCoverageAtStartup,
  InvalidDistanceError,
};
