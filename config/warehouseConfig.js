/**
 * warehouseConfig.js — the single fixed origin for every EazWorld delivery.
 *
 * Every neighbourhood's distance is measured from HERE. It never varies per
 * order, per seller or per product; changing it invalidates every stored
 * distance (see models/NeighborhoodDistance.js — the originKey hash).
 *
 * Coordinates are used by the Distance Matrix lookup at seed/admin time only.
 * Nothing on the checkout path reads this file.
 */
const WAREHOUSE_LOCATION = {
  lat: parseFloat(process.env.WAREHOUSE_LAT) || 5.5820038,
  lng: parseFloat(process.env.WAREHOUSE_LNG) || -0.1984173,
  address: process.env.WAREHOUSE_ADDRESS || "Nima, Accra, Ghana",
};

/**
 * Beyond this we do not deliver. A distance past it is an error, never a
 * silent fall-through to the most expensive zone — an unserviceable address
 * must be visible at quote time, not absorbed into a price.
 */
const MAX_SERVICEABLE_KM = 100;

/** `${lat},${lng}` — the form the Distance Matrix / Routes APIs want. */
function warehouseOriginCoords() {
  return `${WAREHOUSE_LOCATION.lat},${WAREHOUSE_LOCATION.lng}`;
}

module.exports = { WAREHOUSE_LOCATION, MAX_SERVICEABLE_KM, warehouseOriginCoords };
