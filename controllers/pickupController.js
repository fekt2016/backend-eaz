const PickupLocation = require("../models/PickupLocation");

// T80 E2 — public PickupLocation reads for the checkout pickup selector.
// Auth-free; rate-limited via the global /api/ limiter.
//
// Cache: short in-process TTL so a customer hitting the cascade doesn't
// thrash the DB.
//
// The TTL is a SAFETY NET, not the invalidation story — same contract as
// services/shipping/shippingCache.js. Every admin write in
// adminPickupController calls invalidatePickupCache(). 60 seconds of staleness
// is NOT acceptable here: a station deactivated because we stopped using it
// stayed selectable at checkout, so a customer could pay for a handoff point
// that no longer exists.

let cache = { ts: 0, data: null };
const CACHE_MS = 60 * 1000;

/** Drop the cached pickup rows. Called by every admin write, and by tests. */
function invalidatePickupCache() {
  cache = { ts: 0, data: null };
}

async function loadActive() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) return cache.data;
  const data = await PickupLocation.find({ isActive: true })
    .sort({ kind: 1, isDefault: -1, region: 1, city: 1, name: 1 })
    .lean();
  cache = { ts: now, data };
  return data;
}

// GET /api/v1/pickups?kind=bus_station&region=Ashanti&city=Kumasi
// Returns the pickup rows the storefront can render. Optional filters narrow
// the result set; kind defaults to 'bus_station' for the public endpoint
// because the warehouse is a fulfilment origin, not a customer choice.
const listPickups = async (req, res, next) => {
  try {
    const kind = req.query.kind || "bus_station";
    const data = await loadActive();
    let rows = data.filter((p) => p.kind === kind);
    if (req.query.region) rows = rows.filter((p) => p.region === String(req.query.region));
    if (req.query.city) rows = rows.filter((p) => p.city === String(req.query.city));
    // Strip internal fields the storefront never needs.
    const shaped = rows.map((p) => ({
      id: String(p._id),
      name: p.name,
      region: p.region,
      city: p.city,
      address: p.address,
      landmark: p.landmark,
      isDefault: p.isDefault,
    }));
    res.status(200).json({ success: true, count: shaped.length, data: shaped });
  } catch (err) { next(err); }
};

module.exports = { listPickups, invalidatePickupCache };
