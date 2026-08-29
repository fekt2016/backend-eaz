/**
 * googleDistance.js — driving-distance lookups for shipping zones.
 *
 * WHY THIS IS NOT ON THE QUOTE PATH: Google bills per element and adds network
 * latency to checkout. Distances between a fixed warehouse and a fixed
 * neighbourhood do not change, so an admin resolves them ONCE (business
 * settings → Shipping → Neighbourhood distances) and the result is stored in
 * models/NeighborhoodDistance.js. `shippingCalculator` only ever reads that
 * cached number. A Google outage can never take checkout down.
 *
 * TWO APIS, IN ORDER:
 *   1. Routes API (`computeRouteMatrix`) — the current product. Required for
 *      Google Cloud projects created after 1 March 2025, when the legacy
 *      Distance Matrix API was closed to new customers.
 *   2. Distance Matrix API — the legacy endpoint, still enabled on older
 *      projects. Tried only when Routes is denied, so an existing key that
 *      predates the cutoff keeps working.
 *
 * Distances come back in metres and are returned as kilometres (2 dp).
 */
const axios = require("axios");
const logger = require("../../utils/logger");

const ROUTES_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const LEGACY_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";

// Google caps computeRouteMatrix at 625 elements; with one origin that is 625
// destinations. We chunk far below that so a single failure costs little and
// the request stays well inside the timeout.
const MAX_DESTINATIONS_PER_CALL = 25;
const REQUEST_TIMEOUT_MS = 10_000;

/** True when a Maps key is configured. Blank in tests — see tests/setup.js. */
function hasConfig() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function metresToKm(metres) {
  return Math.round((Number(metres) / 1000) * 100) / 100;
}

/**
 * Google reports a project with billing switched off as a 403 whose
 * ErrorInfo.reason is BILLING_DISABLED — nested inside an array-wrapped error
 * body on the Routes API. Detected explicitly because it needs a different
 * remedy from "this API is not enabled", and because the free tier still
 * requires a billing account, which surprises people.
 */
function isBillingDisabled(err) {
  const body = err.response?.data;
  const error = (Array.isArray(body) ? body[0]?.error : body?.error) || {};
  if ((error.details || []).some((d) => d.reason === "BILLING_DISABLED")) return true;
  return /enable billing/i.test(error.message || err.message || "");
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Routes API — one origin, many destinations, addresses as free text.
 * Returns a Map of destinationIndex → { distanceKm, durationMins }.
 */
async function viaRoutesApi(origin, destinations) {
  const { data } = await axios.post(
    ROUTES_URL,
    {
      origins: [{ waypoint: { address: origin } }],
      destinations: destinations.map((address) => ({ waypoint: { address } })),
      travelMode: "DRIVE",
    },
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
        // Field mask is REQUIRED by the Routes API — without it Google 400s.
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,distanceMeters,duration,condition",
      },
    },
  );

  const results = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    // `condition` is ROUTE_EXISTS or ROUTE_NOT_FOUND; a missing route yields no
    // distance, which we surface as unresolved rather than as zero.
    if (row.condition !== "ROUTE_EXISTS" || row.distanceMeters == null) continue;
    results.set(row.destinationIndex, {
      distanceKm: metresToKm(row.distanceMeters),
      durationMins: row.duration
        ? Math.round(parseInt(String(row.duration).replace("s", ""), 10) / 60)
        : null,
    });
  }
  return results;
}

/**
 * Legacy Distance Matrix API — same shape, older endpoint. Only reached when
 * Routes is unavailable on this key.
 */
async function viaLegacyApi(origin, destinations) {
  const { data } = await axios.get(LEGACY_URL, {
    timeout: REQUEST_TIMEOUT_MS,
    params: {
      origins: origin,
      destinations: destinations.join("|"),
      mode: "driving",
      units: "metric",
      key: process.env.GOOGLE_MAPS_API_KEY,
    },
  });

  if (data.status !== "OK") {
    throw new Error(`Distance Matrix returned ${data.status}: ${data.error_message || "no detail"}`);
  }

  const results = new Map();
  const elements = data.rows?.[0]?.elements || [];
  elements.forEach((el, index) => {
    if (el.status !== "OK" || !el.distance) return;
    results.set(index, {
      distanceKm: metresToKm(el.distance.value),
      durationMins: el.duration ? Math.round(el.duration.value / 60) : null,
    });
  });
  return results;
}

/**
 * Resolve driving distances from one origin to many destinations.
 *
 * Never throws for a single bad address — an address Google cannot route to
 * comes back with `distanceKm: null` and a `status` explaining why, so the
 * admin UI can show which neighbourhoods still need a manual number. A hard
 * failure (bad key, quota, network) rejects, because that is a configuration
 * problem the admin must see rather than a per-row gap.
 *
 * @param {string} origin        Free-text origin address (the warehouse).
 * @param {string[]} destinations Free-text destination addresses.
 * @returns {Promise<Array<{destination: string, distanceKm: number|null, durationMins: number|null, status: string}>>}
 */
async function resolveDistances(origin, destinations) {
  if (!hasConfig()) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }
  if (!origin || !String(origin).trim()) {
    throw new Error("An origin address is required to measure distances.");
  }
  if (!destinations.length) return [];

  const out = [];
  for (const batch of chunk(destinations, MAX_DESTINATIONS_PER_CALL)) {
    let results;
    try {
      results = await viaRoutesApi(origin, batch);
    } catch (err) {
      const status = err.response?.status;

      // Billing off is a project-level problem: the legacy endpoint fails the
      // same way, so a fallback attempt is pure waste. Say so plainly — this
      // is the single most common setup mistake, and Google's own message is
      // buried three levels into the error payload.
      if (isBillingDisabled(err)) {
        throw new Error(
          "Google Maps billing is not enabled for this project. Enable billing in the " +
            "Google Cloud console (the Maps free tier still requires it), then retry.",
        );
      }

      // 403 PERMISSION_DENIED / 404 = the Routes API is not enabled on this
      // project. Anything else (network, quota, malformed key) is not worth a
      // second paid attempt, so only fall back on those two.
      if (status !== 403 && status !== 404) {
        logger.error(`[googleDistance] Routes API failed: ${err.message}`);
        throw err;
      }
      logger.warn(
        "[googleDistance] Routes API unavailable on this key — falling back to the legacy Distance Matrix API.",
      );
      results = await viaLegacyApi(origin, batch);
    }

    batch.forEach((destination, index) => {
      const hit = results.get(index);
      out.push({
        destination,
        distanceKm: hit ? hit.distanceKm : null,
        durationMins: hit ? hit.durationMins : null,
        status: hit ? "OK" : "NOT_FOUND",
      });
    });
  }
  return out;
}

/**
 * Build the free-text address Google should route to for a neighbourhood.
 * Ghana is appended so an ambiguous name ("Community 1") resolves locally
 * rather than to a same-named place on another continent.
 */
function buildDestinationAddress({ neighborhood, city, region }) {
  return [neighborhood, city, region, "Ghana"]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

module.exports = {
  hasConfig,
  resolveDistances,
  buildDestinationAddress,
  isBillingDisabled,
  MAX_DESTINATIONS_PER_CALL,
};
