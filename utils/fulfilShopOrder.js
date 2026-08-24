const Order = require('../models/Order');
const Part = require('../models/Part');
const Product = require('../models/Product');
const { log, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { formatGhs } = require('./money');
const { notifyRoles, NOTIFICATION_TYPES } = require('./notifications');

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

  // Notify admin/staff — in-app (T12)
  notifyRoles(['superadmin', 'admin', 'staff'], {
    type:  NOTIFICATION_TYPES.NEW_ORDER,
    title: `New order paid: ${paid.orderNumber}`,
    body:  `${formatGhs(paid.total)} — ${paid.customer?.name || 'Customer'}`,
    link:  `/dashboard/orders/${paid._id}`,
    resourceType: 'Order',
    resourceId:   paid.orderNumber,
  }).catch(() => {});

  // Decrement stock atomically per item. Never oversell: if the guard
  // fails for an item, log it and continue. T48's `sold` counter rides on the
  // same update, so it inherits this function's idempotence (the pending→paid
  // guard above means a webhook retry never gets here twice) and a line that
  // fails the stock guard is not counted as sold either.
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

    // Variant lines decrement that variant's stock; plain product lines keep
    // the original top-level stock decrement.
    let result;
    if (item.variant && item.variant.sku) {
      result = await Product.findOneAndUpdate(
        { _id: item.product, variants: { $elemMatch: { sku: item.variant.sku, stock: { $gte: item.qty } } } },
        { $inc: { "variants.$.stock": -item.qty, sold: item.qty } }
      );
    } else {
      result = await Product.findOneAndUpdate(
        { _id: item.product, stock: { $gte: item.qty } },
        { $inc: { stock: -item.qty, sold: item.qty } }
      );
    }
    if (!result) {
      console.error(
        `[fulfil] Stock decrement failed for order ${paid.orderNumber} item ${item.name} (qty ${item.qty})`
      );
    }
  }

  await Order.updateOne({ _id: paid._id }, { $set: { stockDeducted: true } });

  return paid;
}

/**
 * Restore stock for every item on an order whose stock was previously
 * decremented (paid → cancelled). Mirrors the decrement loop in
 * fulfilShopOrder. Idempotent at the call site — callers must guard with
 * `order.stockDeducted && !order.stockRestored` and set `stockRestored`.
 */
async function restockOrderItems(order) {
  for (const item of order.items) {
    if (item.part) {
      await Part.findByIdAndUpdate(item.part, { $inc: { quantity: item.qty } });
      continue;
    }

    if (item.variant && item.variant.sku) {
      await Product.findOneAndUpdate(
        { _id: item.product, variants: { $elemMatch: { sku: item.variant.sku } } },
        { $inc: { "variants.$.stock": item.qty } }
      );
    } else if (item.product) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.qty } });
    }

    // Take the units back off `sold` (T48). Separate from the stock restore
    // above because it is clamped at zero and because `sold` is product-level,
    // shared by variant and plain lines alike.
    if (item.product) await Product.decrementSold(item.product, item.qty);
  }
}

module.exports = { fulfilShopOrder, restockOrderItems };