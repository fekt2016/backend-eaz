const CourierRate = require("../../models/CourierRate");
const DeliveryCharge = require("../../models/DeliveryCharge");

/**
 * Settle the courier payout for a delivered order.
 *
 * Called by orderController when an order transitions to `delivered`.
 * Idempotent: if a DeliveryCharge already exists for this orderId the
 * existing record is returned (no duplicate work).
 *
 * Invariant: courierPayout + retainedMargin === shippingFeeCollected.
 * Negative margin is surfaced, never clamped.
 *
 * @param {Object} order — populated Order document
 * @returns {Promise<DeliveryCharge>}
 */
async function settleDeliveryCharge(order) {
  const shippingFee = Math.max(0, Number(order.shippingFee) || 0);

  // No shipping fee → nothing to settle.
  if (shippingFee === 0) {
    return null;
  }

  // Idempotent: already settled?
  const existing = await DeliveryCharge.findOne({ orderId: order._id });
  if (existing) return existing;

  // Resolve the courier payout config. Missing/invalid → fallback chain
  // inside resolvePayout (never silently 0).
  const rate = await CourierRate.getOrCreate();
  const zoneCode = order.shippingZoneCode || null;
  const courierPayout = rate.resolvePayout(shippingFee, zoneCode);
  const retainedMargin = shippingFee - courierPayout;

  return DeliveryCharge.settle(order._id, {
    shippingFeeCollected: shippingFee,
    courierPayout,
    retainedMargin,
    mode: rate.mode,
    zoneCode: zoneCode || undefined,
    method: order.shippingMethod || undefined,
  });
}

module.exports = { settleDeliveryCharge };
