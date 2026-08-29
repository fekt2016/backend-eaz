/**
 * zoneResolver.js — neighbourhood → ShippingZone.
 *
 * This is the module whose absence silently voids the whole feature, so read
 * the failure policy before changing anything:
 *
 *   1. It NEVER returns a zone it is not sure about. Every failure throws a
 *      typed error. There is no "couldn't work it out, here's Zone A".
 *   2. Callers must not wrap it in a blanket try/catch. Catch
 *      ZoneResolutionError — a real data condition — and let TypeErrors and
 *      the like propagate, because a programming fault must not be absorbed as
 *      if it were a missing neighbourhood.
 *   3. Every resolution reports `zoneSource`, which is stored on the order, so
 *      after the fact you can tell a precise id match from a fuzzy name match.
 *
 * Prefer resolveZoneByNeighborhoodId. The name resolver exists for legacy
 * free-text addresses and can, at its loosest, match across cities — it is a
 * migration aid, and it logs which strategy fired so you can measure how often
 * the fuzzy path is actually used.
 */
const Neighborhood = require("../../models/Neighborhood");
const ShippingZone = require("../../models/ShippingZone");
const logger = require("../../utils/logger");

class ZoneResolutionError extends Error {
  constructor(message, code = "ZONE_UNRESOLVED") {
    super(message);
    this.name = "ZoneResolutionError";
    this.code = code;
    this.statusCode = 400;
  }
}

/** Escape regex metacharacters — user text reaches these queries. */
function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Load the active banded zone for a key, or throw. */
async function loadZone(zoneKey, neighborhoodName) {
  const zone = await ShippingZone.findOne({ zoneKey, isActive: true }).lean();
  if (!zone) {
    // A neighbourhood pointing at a zone that is missing or switched off is a
    // configuration fault, not a customer problem. Loud, and never priced.
    throw new ZoneResolutionError(
      `Neighbourhood "${neighborhoodName}" is assigned to zone ${zoneKey}, which is not active. ` +
        "Check Business Settings → Shipping.",
      "ZONE_INACTIVE",
    );
  }
  return zone;
}

/**
 * The precise path: a neighbourhood id the customer picked from the list.
 * @returns {Promise<{neighborhood, zone, zoneSource: 'neighborhood'}>}
 */
async function resolveZoneByNeighborhoodId(neighborhoodId) {
  if (!neighborhoodId) {
    throw new ZoneResolutionError("A neighbourhood is required to price delivery.", "NO_NEIGHBORHOOD");
  }

  const neighborhood = await Neighborhood.findById(neighborhoodId).lean();
  if (!neighborhood) {
    throw new ZoneResolutionError("That delivery area was not found.", "NOT_FOUND");
  }
  if (!neighborhood.isActive) {
    throw new ZoneResolutionError(
      `We are not currently delivering to ${neighborhood.name}.`,
      "INACTIVE",
    );
  }
  if (!neighborhood.assignedZone) {
    throw new ZoneResolutionError(
      `${neighborhood.name} has no delivery zone assigned yet.`,
      "NO_ZONE",
    );
  }

  const zone = await loadZone(neighborhood.assignedZone, neighborhood.name);
  return { neighborhood, zone, zoneSource: "neighborhood" };
}

/**
 * The legacy path: free-text name (+ optional city), strict to loose.
 * Each strategy is logged so the fuzzy tail is measurable.
 */
async function resolveZoneByName(name, city) {
  const needle = String(name || "").trim();
  if (!needle) {
    throw new ZoneResolutionError("A neighbourhood name is required.", "NO_NEIGHBORHOOD");
  }
  const safe = escapeRegex(needle);
  const cityFilter = city ? { city } : {};

  const strategies = [
    {
      id: "exact_in_city",
      query: { ...cityFilter, name: new RegExp(`^${safe}$`, "i"), isActive: true },
    },
    {
      id: "partial_in_city",
      query: { ...cityFilter, name: new RegExp(safe, "i"), isActive: true },
    },
    {
      id: "keyword_in_city",
      query: null, // built below — needs the token split
    },
    {
      // Loosest: ignores the city entirely, so it can return a same-named
      // neighbourhood elsewhere. Flagged as low confidence for that reason.
      id: "exact_any_city",
      query: { name: new RegExp(`^${safe}$`, "i"), isActive: true },
    },
  ];

  const tokens = needle.split(/\s+/).filter((t) => t.length > 2).map(escapeRegex);
  strategies[2].query = tokens.length
    ? { ...cityFilter, isActive: true, $or: tokens.map((t) => ({ name: new RegExp(t, "i") })) }
    : null;

  for (const strategy of strategies) {
    if (!strategy.query) continue;
    const neighborhood = await Neighborhood.findOne(strategy.query).lean();
    if (!neighborhood || !neighborhood.assignedZone) continue;

    if (strategy.id !== "exact_in_city") {
      logger.warn(
        `[shipping] neighbourhood "${needle}" (${city || "any city"}) matched by ` +
          `${strategy.id} → ${neighborhood.name}, ${neighborhood.city} (zone ${neighborhood.assignedZone})`,
      );
    }
    const zone = await loadZone(neighborhood.assignedZone, neighborhood.name);
    return { neighborhood, zone, zoneSource: strategy.id };
  }

  throw new ZoneResolutionError(
    `Could not determine a shipping zone for "${needle}"${city ? ` in ${city}` : ""}.`,
    "NOT_FOUND",
  );
}

module.exports = {
  resolveZoneByNeighborhoodId,
  resolveZoneByName,
  ZoneResolutionError,
  escapeRegex,
};
