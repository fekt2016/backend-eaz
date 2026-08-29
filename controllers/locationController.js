const Location = require("../models/Location");

// T80 E2 — public Location reads for the checkout cascade. Auth-free; rate-
// limited via the global /api/ limiter. Returns trimmed shapes the storefront
// can render without further processing.
//
// Cache: the storefront hits this on every checkout page load, so the result
// is small enough to keep in a memory cache for a short window. We do NOT
// cache admin writes via mongoose middleware here — admins don't toggle
// locations often enough to matter, and the freshness on a 60s TTL is fine.

// In-process cache, per-process (cleared on restart). Production may swap
// this for Redis; the call sites stay the same.
let cache = { ts: 0, data: null };
const CACHE_MS = 60 * 1000;

async function loadAllActive() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) return cache.data;
  const locations = await Location.find({ isActive: true })
    .sort({ region: 1, city: 1 })
    .lean();
  cache = { ts: now, data: locations };
  return locations;
}

/**
 * Case- and whitespace-insensitive comparison for region/city names.
 *
 * The address form used to take the region as free text, so stored addresses
 * can carry "greater accra" or "Greater  Accra". An exact match on those
 * returns nothing, and the failure is silent all the way down: no cities, no
 * neighbourhoods, `inAccraCore` false, and checkout quietly offering pickup in
 * a city it should be delivering to. Matching loosely here means an address
 * saved before the dropdown existed still resolves.
 */
function sameName(a, b) {
  return String(a || "").trim().replace(/\s+/g, " ").toLowerCase()
    === String(b || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// GET /api/v1/locations
// Query params:
//   region=Ashanti       → only Ashanti region entries
//   inAccraCore=true     → only Greater-Accra-core (delivery-eligible) cities
// Returns: { regions: [{ region, cities: [{ city, neighborhoods, inAccraCore }] }] }
const listLocations = async (req, res, next) => {
  try {
    const locations = await loadAllActive();
    const regionFilter = req.query.region
      ? String(req.query.region).trim().toLowerCase()
      : null;
    const inAccraCoreOnly = req.query.inAccraCore === "true";

    // Group by region → city for the cascading dropdown UX.
    const regionMap = new Map();
    for (const loc of locations) {
      if (regionFilter && String(loc.region).toLowerCase() !== regionFilter) continue;
      if (inAccraCoreOnly && !loc.inAccraCore) continue;
      if (!regionMap.has(loc.region)) {
        regionMap.set(loc.region, {
          region: loc.region,
          cities: [],
        });
      }
      regionMap.get(loc.region).cities.push({
        city: loc.city,
        neighborhoods: loc.neighborhoods || [],
        inAccraCore: !!loc.inAccraCore,
      });
    }

    res.status(200).json({
      success: true,
      count: regionMap.size,
      data: Array.from(regionMap.values()),
    });
  } catch (err) { next(err); }
};

// GET /api/v1/locations/regions
// Flat list of region strings — the first dropdown only needs the names.
const listRegions = async (req, res, next) => {
  try {
    const locations = await loadAllActive();
    const regionSet = new Set(locations.map((l) => l.region));
    res.status(200).json({
      success: true,
      count: regionSet.size,
      data: Array.from(regionSet).sort(),
    });
  } catch (err) { next(err); }
};

// GET /api/v1/locations/cities?region=Ashanti
// Cities in a given region — the second dropdown's data source.
const listCities = async (req, res, next) => {
  try {
    const region = String(req.query.region || "").trim();
    if (!region) {
      return res.status(400).json({
        success: false,
        error: "region query param is required.",
      });
    }
    const locations = await loadAllActive();
    const cities = locations
      .filter((l) => sameName(l.region, region))
      .map((l) => ({
        city: l.city,
        neighborhoods: l.neighborhoods || [],
        inAccraCore: !!l.inAccraCore,
      }));
    res.status(200).json({ success: true, count: cities.length, data: cities });
  } catch (err) { next(err); }
};

// GET /api/v1/locations/neighborhoods?region=Greater%20Accra&city=Accra
// Neighborhoods in a (region, city) — the third dropdown's data source.
const listNeighborhoods = async (req, res, next) => {
  try {
    const region = String(req.query.region || "").trim();
    const city = String(req.query.city || "").trim();
    if (!region || !city) {
      return res.status(400).json({
        success: false,
        error: "region and city query params are required.",
      });
    }
    const locations = await loadAllActive();
    const loc = locations.find((l) => sameName(l.region, region) && sameName(l.city, city));
    if (!loc) {
      return res.status(404).json({
        success: false,
        error: `No location found for ${region} → ${city}.`,
      });
    }
    res.status(200).json({
      success: true,
      data: {
        region: loc.region,
        city: loc.city,
        inAccraCore: !!loc.inAccraCore,
        neighborhoods: loc.neighborhoods || [],
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  listLocations,
  listRegions,
  listCities,
  listNeighborhoods,
};
