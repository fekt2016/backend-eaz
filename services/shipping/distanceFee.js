/**
 * distanceFee.js — the distance-zone fee formula.
 *
 *   chargeableWeight = max(weightKg, MIN_CHARGEABLE_KG)
 *   subtotal         = baseRate + perKgRate × chargeableWeight
 *   afterSpeed       = subtotal × speedMultiplier
 *   fee              = ceilToCedi(afterSpeed + (fragile ? fragileSurcharge : 0))
 *
 * The fragile surcharge is added AFTER the multiplier, so a next-day fragile
 * order does not pay 1.2× the surcharge as well.
 *
 * Money is integer pesewas throughout (GH₵1.00 === 100), per the app-wide
 * convention — the spec's GHS decimals are the same numbers ×100. The final
 * ceil is to a whole cedi, which is what the worked examples round to.
 */
const MIN_CHARGEABLE_KG = 0.5;
const PESEWAS_PER_CEDI = 100;

/** Round up to a whole cedi, in pesewas. 3250 (GH₵32.50) → 3300 (GH₵33). */
function ceilToCedi(pesewas) {
  return Math.ceil(pesewas / PESEWAS_PER_CEDI) * PESEWAS_PER_CEDI;
}

/**
 * The multiplier for a speed code, read off the zone's `speedTiers` array by
 * `code`.
 *
 * A speed the zone does not define is an ERROR, not ×1.0. Defaulting an
 * unknown speed to the cheapest multiplier is precisely the silent
 * under-charge this whole module is written to avoid: nothing throws, nobody
 * complains, and the margin quietly leaks.
 */
function speedTierFor(zone, speedCode) {
  const tiers = zone.speedTiers || [];
  const tier = tiers.find((t) => t.code === speedCode);
  if (!tier) {
    const available = tiers.map((t) => t.code).join(", ") || "none configured";
    const err = new Error(
      `Zone ${zone.zoneKey || zone.code} has no "${speedCode}" speed tier (has: ${available}).`,
    );
    err.statusCode = 400;
    throw err;
  }
  return tier;
}

/**
 * The shipping fee in pesewas.
 *
 * @param {object} zone       A ShippingZone with zoneKey, baseRate, perKgRate,
 *                            fragileSurcharge and speedTiers.
 * @param {number} weightKg   Total cart weight in kg.
 * @param {string} speedCode  'standard' | 'next_day' | 'express' — must exist
 *                            in the zone's speedTiers.
 * @param {boolean} fragile   Whether any item in the cart is fragile.
 * @returns {number} pesewas
 */
function calcShipping(zone, weightKg, speedCode = "standard", fragile = false) {
  return calcShippingWithBreakdown(zone, weightKg, speedCode, fragile).fee;
}

/**
 * The fee plus the line-by-line derivation the checkout UI renders.
 * Field names are part of the API contract — keep them stable.
 */
function calcShippingWithBreakdown(zone, weightKg, speedCode = "standard", fragile = false) {
  const raw = Number(weightKg);
  const chargeableWeightKg = Math.max(
    Number.isFinite(raw) && raw > 0 ? raw : 0,
    MIN_CHARGEABLE_KG,
  );

  const tier = speedTierFor(zone, speedCode);

  // A zone with no base rate is a broken zone, not a free delivery. `|| 0`
  // here would turn a missing field into the cheapest possible quote and
  // report no error at all — the exact shape of silent under-charging this
  // module exists to prevent. perKgRate genuinely defaults to 0 in the schema
  // (a zone may bill by base alone), so its `|| 0` is a real default.
  if (!Number.isFinite(zone.baseRate)) {
    const err = new Error(
      `Zone ${zone.zoneKey || zone.code || "(unknown)"} has no base rate — cannot price this delivery.`,
    );
    err.statusCode = 500;
    throw err;
  }
  const baseRate = zone.baseRate;
  const weightFee = Math.round((zone.perKgRate || 0) * chargeableWeightKg);
  const subtotal = baseRate + weightFee;
  const afterSpeed = Math.round(subtotal * tier.multiplier);
  const fragileSurcharge = fragile ? zone.fragileSurcharge || 0 : 0;
  const fee = ceilToCedi(afterSpeed + fragileSurcharge);

  return {
    fee,
    breakdown: {
      zone: zone.zoneKey || zone.code,
      baseRate,
      perKgRate: zone.perKgRate || 0,
      chargeableWeightKg,
      weightFee,
      subtotal,
      multiplier: tier.multiplier,
      afterSpeed,
      fragileSurcharge,
      // What the ceil to a whole cedi added, so the components visibly sum to
      // the fee rather than falling one rounding step short.
      roundingAdjustment: fee - (afterSpeed + fragileSurcharge),
      shippingType: speedCode,
      estimatedDays: tier.estimatedDays || zone.estimatedDaysLabel || "",
      currency: "GHS",
    },
  };
}

module.exports = {
  calcShipping,
  calcShippingWithBreakdown,
  ceilToCedi,
  speedTierFor,
  MIN_CHARGEABLE_KG,
};
