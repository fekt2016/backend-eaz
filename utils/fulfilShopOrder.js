const Order = require('../models/Order');
const Product = require('../models/Product');
const { syncVariantStock } = require('./syncVariantStock');
const DeliveryZone = require('../models/DeliveryZone');
const { log, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { formatGhs } = require('./money');
const { notifyRoles, NOTIFICATION_TYPES } = require('./notifications');
const { sendShopOrderConfirmationEmail } = require('./email');

/**
 * Build a guard rejection. `code` is what callers branch on — the message
 * carries the detail for the log.
 */
function paymentGuardError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Codes thrown by fulfilShopOrder's payment guard. Callers import this to
 *  tell a rejected charge from a genuine failure. */
const PAYMENT_GUARD_CODES = ['MISSING_PAYMENT_GUARD', 'CURRENCY_MISMATCH', 'AMOUNT_MISMATCH'];

/**
 * Atomically transition a shop order pending→paid and decrement stock.
 *
 * `payment` is mandatory and must carry what Paystack actually charged:
 * `{ amountPesewas, currency }`. The amount is folded into the update's own
 * filter, so an order cannot be flipped to paid by a charge that doesn't match
 * its total — no caller can fulfil an order without proving the amount. This
 * guard used to be duplicated at each call site; it lives here so a future
 * caller inherits it instead of forgetting it.
 *
 * Idempotent: if the order is not pending it does nothing and returns null,
 * so concurrent webhook + verification paths never double-decrement.
 *
 * Throws (see PAYMENT_GUARD_CODES) on MISSING_PAYMENT_GUARD, CURRENCY_MISMATCH,
 * or AMOUNT_MISMATCH — never a silent no-op, since those mean a charge that
 * must not fulfil.
 */
async function fulfilShopOrder(reference, payment) {
  const amountPesewas = Number(payment?.amountPesewas);
  const currency      = payment?.currency;

  if (!Number.isFinite(amountPesewas) || amountPesewas <= 0) {
    throw paymentGuardError(
      'MISSING_PAYMENT_GUARD',
      `fulfilShopOrder(${reference}) called without the charged amount — refusing to fulfil`
    );
  }
  if (currency && currency !== 'GHS') {
    throw paymentGuardError(
      'CURRENCY_MISMATCH',
      `Order ${reference} was charged in ${currency}, expected GHS`
    );
  }

  const paid = await Order.findOneAndUpdate(
    { paystackReference: reference, status: 'pending', total: amountPesewas },
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

  if (!paid) {
    // Either already fulfilled (idempotent no-op) or the amount clause in the
    // filter above rejected it. Only re-read to tell those apart — the happy
    // path stays a single atomic write.
    const existing = await Order.findOne({ paystackReference: reference })
      .select('status total orderNumber')
      .lean();
    if (existing && existing.status === 'pending' && existing.total !== amountPesewas) {
      throw paymentGuardError(
        'AMOUNT_MISMATCH',
        `Order ${existing.orderNumber} expects ${existing.total} pesewas, Paystack charged ${amountPesewas}`
      );
    }
    return null;
  }

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

  // T62 — the customer's receipt, with their tracking number so the journey is
  // reachable from the inbox. Best-effort: a mail failure must not undo a
  // payment that already landed. The pre-order section needs each line's
  // expected-availability note, which lives on the product, not the order.
  Promise.all([
    paid.deliveryZone ? DeliveryZone.findById(paid.deliveryZone).select('name').lean().catch(() => null) : null,
    ...paid.items.filter((i) => i.isPreorder && i.product).map((i) =>
      Product.findById(i.product).select('name preorder.note preorder.availableFrom').lean().catch(() => null)),
  ])
    .then(([zone, ...preorderProducts]) => {
      const preorderNotes = preorderProducts.filter(Boolean).map((p) => {
        const bits = [];
        if (p.preorder?.availableFrom) {
          bits.push(`expected from ${new Date(p.preorder.availableFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
        }
        if (p.preorder?.note) bits.push(p.preorder.note);
        return bits.length ? `${p.name} (${bits.join(' — ')})` : p.name;
      });
      return sendShopOrderConfirmationEmail(paid, {
        deliveryZoneName: zone?.name || '',
        preorderNotes,
      });
    })
    .catch(() => {});

  // Decrement stock atomically per item. Never oversell: if the guard fails for
  // an item we still continue — the payment has landed and must not be undone —
  // but T89 means the failure is now RECORDED rather than only logged. Every
  // failed line is collected here and persisted on the order below, so a
  // shortfall is visible in the dashboard instead of surfacing as a complaint.
  const fulfilmentIssues = [];
  // Original note, still true: if the guard fails for an item, log it and continue. T48's `sold` counter rides on the
  // same update, so it inherits this function's idempotence (the pending→paid
  // guard above means a webhook retry never gets here twice) and a line that
  // fails the stock guard is not counted as sold either.
  for (const item of paid.items) {
    if (item.part) {
      // T48's `sold` counter rides on the same guarded update as the stock
      // move, exactly as it does for products below — a line that fails the
      // stock guard is not counted as sold either.
      const result = await Product.findOneAndUpdate(
        { _id: item.part, stock: { $gte: item.qty } },
        { $inc: { stock: -item.qty, sold: item.qty } }
      );
      if (!result) {
        console.error(
          `[fulfil] Part stock decrement failed for order ${paid.orderNumber} item ${item.part} (qty ${item.qty})`
        );
        fulfilmentIssues.push({
          itemName: item.name || 'Part',
          productId: item.part,
          qtyRequested: item.qty,
          reason: 'insufficient_stock',
        });
      }
      continue;
    }

    // A line with neither `product` nor `part` has nothing to decrement — both
    // refs are optional on the Order item schema, so this is legal data (a
    // manually-entered line, say). The decrement below would query
    // `{ _id: undefined }`, match nothing, and — before this guard — get
    // recorded as `insufficient_stock`, which is a lie: there is no stock
    // record to be short of. Skip it rather than invent a shortfall.
    if (!item.product) continue;

    // T45: a pre-order line has no stock behind it yet — that is the whole point.
    // Skip it here (a decrement would fail its guard and log a false alarm); the
    // stock move and the `sold` bump happen when staff release it on arrival.
    if (item.isPreorder && !item.preorderReleasedAt) continue;

    // Variant lines decrement that variant's stock; plain product lines keep
    // the original top-level stock decrement.
    let result;
    if (item.variant && item.variant.sku) {
      result = await Product.findOneAndUpdate(
        { _id: item.product, variants: { $elemMatch: { sku: item.variant.sku, stock: { $gte: item.qty } } } },
        { $inc: { "variants.$.stock": -item.qty, sold: item.qty } }
      );
      // The top-level field is not touched by the line above, so without this it
      // keeps reading the pre-sale number to the edit form and the product page.
      if (result) await syncVariantStock(item.product);
    } else {
      result = await Product.findOneAndUpdate(
        { _id: item.product, stock: { $gte: item.qty } },
        { $inc: { stock: -item.qty, sold: item.qty } }
      );
    }
    if (!result) {
      fulfilmentIssues.push({
        itemName: item.name || 'Item',
        productId: item.product,
        variantSku: (item.variant && item.variant.sku) || '',
        qtyRequested: item.qty,
        reason: 'insufficient_stock',
      });
      console.error(
        `[fulfil] Stock decrement failed for order ${paid.orderNumber} item ${item.name} (qty ${item.qty})`
      );
    }
  }

  // T89 — persist any shortfall alongside stockDeducted, in the SAME write. Two
  // writes would leave a window where the order reads as fully deducted with no
  // issues recorded, which is exactly the misleading state this exists to end.
  //
  // `$set`, not `$push`: the pending→paid guard above means a retried webhook
  // never reaches this loop twice, so there is nothing to append to — and if a
  // future path ever did re-run it, replacing keeps the record accurate instead
  // of duplicating every line.
  await Order.updateOne(
    { _id: paid._id },
    { $set: { stockDeducted: true, ...(fulfilmentIssues.length ? { fulfilmentIssues } : {}) } }
  );

  if (fulfilmentIssues.length) {
    paid.fulfilmentIssues = fulfilmentIssues;

    // Staff have to know NOW: the customer has paid for something that cannot
    // ship, and every hour it goes unnoticed is an hour of silence on their end.
    // Best-effort like every other notify here — a notification failure must not
    // break a fulfilment that has already taken the money.
    const lines = fulfilmentIssues
      .map((i) => `${i.itemName} x${i.qtyRequested}`)
      .join(', ');
    notifyRoles(['superadmin', 'admin', 'staff'], {
      type:  NOTIFICATION_TYPES.NEW_ORDER,
      title: `Order ${paid.orderNumber} is short on stock`,
      body:  `Paid, but could not fulfil: ${lines}. Contact the customer or restock.`,
      link:  `/dashboard/orders/${paid._id}`,
      resourceType: 'Order',
      resourceId:   paid.orderNumber,
    }).catch(() => {});

    log({
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: paid._id,
      resourceName: paid.orderNumber,
      description: `Order ${paid.orderNumber} paid but ${fulfilmentIssues.length} line(s) could not be fulfilled: ${lines}`,
      metadata: { fulfilmentIssues },
    }).catch(() => {});
  }

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
    // Nothing was ever deducted for an unreleased pre-order, so there is nothing
    // to give back — restocking it would invent inventory.
    if (item.isPreorder && !item.preorderReleasedAt) continue;

    if (item.part) {
      await Product.findByIdAndUpdate(item.part, { $inc: { stock: item.qty } });
      // Take the units back off `sold` too — clamped, since items sold before
      // the counter existed have no field to decrement.
      await Product.decrementSold(item.part, item.qty);
      continue;
    }

    if (item.variant && item.variant.sku) {
      await Product.findOneAndUpdate(
        { _id: item.product, variants: { $elemMatch: { sku: item.variant.sku } } },
        { $inc: { "variants.$.stock": item.qty } }
      );
      await syncVariantStock(item.product);
    } else if (item.product) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.qty } });
    }

    // Take the units back off `sold` (T48). Separate from the stock restore
    // above because it is clamped at zero and because `sold` is product-level,
    // shared by variant and plain lines alike.
    if (item.product) await Product.decrementSold(item.product, item.qty);
  }
}

module.exports = { fulfilShopOrder, restockOrderItems, PAYMENT_GUARD_CODES };