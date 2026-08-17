const Order = require('../models/Order');
const Part = require('../models/Part');
const Product = require('../models/Product');
const { log, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { formatGhs } = require('./money');

/**
 * Atomically transition a shop order pending→paid and decrement stock.
 * Idempotent: if the order is not pending it does nothing and returns null,
 * so concurrent webhook + verification paths never double-decrement.
 */
async function fulfilShopOrder(reference) {
  const paid = await Order.findOneAndUpdate(
    { paystackReference: reference, status: 'pending' },
    {
      $set: { status: 'paid', paidAt: new Date() },
      $push: {
        trackingHistory: {
          status: 'paid',
          note: 'Payment confirmed — order fulfilled.',
          timestamp: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!paid) return null;

  await log({
    action: ACTIONS.ORDER_PAID,
    resourceType: RESOURCES.ORDER,
    resourceId: paid.orderNumber,
    resourceName: paid.orderNumber,
    description: `Payment confirmed for order ${paid.orderNumber} (${formatGhs(paid.total)})`,
    metadata: { reference: reference, totalPesewas: paid.total },
  });

  // Decrement stock atomically per item. Never oversell: if the guard
  // fails for an item, log it and continue.
  for (const item of paid.items) {
    if (item.part) {
      const result = await Part.findOneAndUpdate(
        { _id: item.part, quantity: { $gte: item.qty } },
        { $inc: { quantity: -item.qty } }
      );
      if (!result) {
        console.error(
          `[fulfil] Part stock decrement failed for order ${paid.orderNumber} item ${item.part} (qty ${item.qty})`
        );
      }
      continue;
    }

    const result = await Product.findOneAndUpdate(
      { _id: item.product, stock: { $gte: item.qty } },
      { $inc: { stock: -item.qty } }
    );
    if (!result) {
      console.error(
        `[fulfil] Stock decrement failed for order ${paid.orderNumber} item ${item.name} (qty ${item.qty})`
      );
    }
  }

  return paid;
}

module.exports = { fulfilShopOrder };