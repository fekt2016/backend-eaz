/**
 * Pre-orders (T45): the release queue, the stage a line has reached, and the
 * release that hands the goods over.
 *
 * Split out of controllers/orderController.js, which re-exports these so the
 * route files are unchanged. Moved verbatim — no logic was rewritten.
 */
const {
  Order, Product, syncVariantStock, log, logFromRequest, ACTIONS,
  RESOURCES, sendPreorderReadyEmail, CUSTOMER_STAGE_ORDER, STAGE_LABELS,
  Shipment, syncPreorderJourney, sanitizeText, resolveVariantPreorder,
  buildPreorderTracking, PENDING_PREORDER,
} = require("./common");


/**
 * GET /api/v1/orders/preorders/count — how many orders are waiting on stock.
 *
 * Feeds the badge on the Orders nav item. A queue nobody remembers to open is a
 * customer who paid weeks ago and heard nothing, so the count has to come to
 * staff rather than waiting to be looked for.
 */
const getPreorderCount = async (req, res, next) => {
  try {
    const count = await Order.countDocuments(PENDING_PREORDER);
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/v1/orders/preorders — the release queue (admin/staff).
 *
 * Paid orders carrying at least one pre-order line that has not been released.
 * Unpaid ones are excluded: nothing is owed to the customer until the money has
 * actually landed, and releasing one would move stock for an order that may never
 * be paid.
 */
const getPreorders = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const orders = await Order.find({
      status: { $in: ['paid', 'processing'] },
      items: { $elemMatch: { isPreorder: true, preorderReleasedAt: null } },
    })
      .sort({ createdAt: 1 }) // oldest first — longest-waiting customer at the top
      .limit(limit)
      .lean();

    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};


/**
 * PATCH /api/v1/orders/:id/preorder-stage — record where this pre-order has got
 * to (admin/staff), without any container batch.
 *
 * A batch is an efficiency for the case where one container carries twenty
 * customers' goods: staff move it once and everyone follows. It was never meant
 * to be the price of recording a stage at all, and making it mandatory left a
 * single pre-order with five stages on the customer's page and no way to update
 * any of them.
 *
 * A line that IS on a batch is refused here on purpose: two sources writing one
 * journey is how a customer ends up being told two different things. Move the
 * batch, or take the line off it first.
 *
 * Re-recording the current stage corrects its date or note; picking an earlier
 * one moves the journey back and drops the stages it never reached — the same
 * rules the batch works to.
 */
const updatePreorderStage = async (req, res, next) => {
  try {
    const { stage, date, note } = req.body;
    if (!CUSTOMER_STAGE_ORDER.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: `Stage must be one of: ${CUSTOMER_STAGE_ORDER.join(', ')}.`,
      });
    }

    // Opt in: the internal history is select:false so it cannot ride out on a
    // customer payload, and this is one of the few places that must read it.
    const order = await Order.findById(req.params.id).select('+items.preorderStageHistory');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const waiting = order.items.filter((i) => i.isPreorder && !i.preorderReleasedAt);
    if (!waiting.length) {
      return res.status(400).json({
        success: false,
        error: 'This order has no pre-order lines waiting on stock.',
      });
    }

    const onBatch = waiting.find((i) => i.shipment);
    if (onBatch) {
      return res.status(400).json({
        success: false,
        error: 'This pre-order rides on a shipment batch — move the batch, or take the line off it first.',
      });
    }

    const when = date ? new Date(date) : new Date();
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ success: false, error: 'That date is not valid.' });
    }
    const cleanNote = note ? sanitizeText(note, 300) : '';
    const to = CUSTOMER_STAGE_ORDER.indexOf(stage);

    for (const item of waiting) {
      const from = CUSTOMER_STAGE_ORDER.indexOf(item.preorderStage || '');

      if (to < from) {
        // Moving back is a correction: the stages it never reached have to go,
        // or the customer's page keeps claiming the goods are further along.
        item.preorderStageHistory = item.preorderStageHistory.filter(
          (e) => CUSTOMER_STAGE_ORDER.indexOf(e.stage) <= to,
        );
      }

      const existing = [...item.preorderStageHistory].reverse().find((e) => e.stage === stage);
      if (existing) {
        // Same stage again: the date or the note was wrong.
        existing.date = when;
        if (note !== undefined) existing.note = cleanNote;
        existing.updatedBy = { name: req.user?.name || '', role: req.user?.role || '' };
      } else {
        item.preorderStageHistory.push({
          stage,
          note: cleanNote,
          date: when,
          updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
        });
      }

      item.preorderStage = stage;
    }

    // "Arrived at our warehouse" IS the release: the goods are physically here
    // and going straight back out to the customer who paid for them. Making
    // staff record the stage and then press Release was two clicks for one
    // event, and the second was easy to forget — leaving a customer told their
    // order had landed while the order itself still sat in the waiting queue.
    let filled = { released: [], fromStock: [], receivedDirect: [] };
    if (stage === 'at_shop') {
      filled = await fillWaitingPreorderLines(order, req.user || {});
    }

    await order.save();

    // The customer reads one history, so the stage lands there too.
    const driver = waiting[0];
    await syncPreorderJourney(driver.preorderStageHistory, { _id: order._id });

    // Same mail the manual release sends, and best-effort for the same reason:
    // a mail failure must not undo a release that has already moved stock.
    if (filled.released.length) {
      sendPreorderReadyEmail(order, filled.released).catch(() => {});
    }

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: `Pre-order stage on ${order.orderNumber} → ${STAGE_LABELS[stage] || stage}`
        + (filled.released.length ? ` (auto-released ${filled.released.length})` : ''),
      metadata: { stage, note: cleanNote, released: filled.released.length },
    });

    const fresh = await Order.findById(order._id)
      .select('+items.preorderStageHistory')
      .populate('items.shipment', 'stage expectedArrival origin stageHistory reference name containerNumber');
    const data = fresh.toObject();
    data.preorder = buildPreorderTracking(fresh, { includeBatch: true });
    data.items = (data.items || []).map((line) => ({
      ...line,
      shipment: line.shipment?._id || line.shipment || null,
    }));

    res.status(200).json({
      success: true,
      data,
      // So the UI can say the stage was recorded AND the order released.
      meta: {
        released: filled.released.length,
        fromStock: filled.fromStock.map((i) => i.name),
        receivedDirect: filled.receivedDirect.map((i) => i.name),
      },
    });
  } catch (error) {
    next(error);
  }
};


/**
 * PATCH /api/v1/orders/:id/preorder-line — correct one waiting pre-order line
 * (admin/staff): how many, and which batch it rides on.
 *
 * The batch list moves a whole container at once. This is the other half: the
 * one customer who ordered two instead of three, or whose line went onto the
 * wrong container and needs moving — including off a batch entirely, which
 * nothing could do before.
 *
 * ⚠️ Quantity is money. A pre-order is paid in full up front, so changing it
 * changes what is owed, and this endpoint does NOT move money — the same rule
 * changeOrderAddress works to. The order's totals are recomputed and the
 * difference is returned in `meta` so staff can settle it deliberately: a
 * refund through the refund endpoint, or a top-up collected separately.
 *
 * A released line is out of scope on purpose. Once released it is ordinary
 * stock that has been handed over, and changing it is a refund or a return,
 * not an edit.
 */
const updatePreorderLine = async (req, res, next) => {
  try {
    const { itemId, qty, shipment: shipmentId } = req.body;
    if (!itemId) {
      return res.status(400).json({ success: false, error: 'itemId is required.' });
    }

    // Taking a line off a batch hands the journey back to the line's own
    // history, so this path needs it too.
    const order = await Order.findById(req.params.id).select('+items.preorderStageHistory');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const item = order.items.id(itemId);
    if (!item) {
      return res.status(404).json({ success: false, error: 'That line is not on this order.' });
    }
    if (!item.isPreorder) {
      return res.status(400).json({ success: false, error: 'That line is not a pre-order.' });
    }
    if (item.preorderReleasedAt) {
      return res.status(400).json({
        success: false,
        error: 'That pre-order has already been released. Use a refund or a return instead.',
      });
    }

    const changes = [];
    const oldTotal = order.total;

    // ── Quantity ─────────────────────────────────────────────────────────
    if (qty !== undefined) {
      const next = Number(qty);
      if (!Number.isInteger(next) || next < 1) {
        return res.status(400).json({ success: false, error: 'Quantity must be a whole number of 1 or more.' });
      }

      // The same per-product/variant cap checkout enforces — raising a line
      // here must not get round a supply limit the storefront respects.
      const product = await Product.findById(item.product).select('name preorder variants').lean();
      if (product) {
        const variant = item.variant?.sku
          ? (product.variants || []).find((v) => v.sku === item.variant.sku)
          : null;
        const cap = resolveVariantPreorder(product, variant)?.maxQty;
        if (cap != null && next > cap) {
          return res.status(400).json({
            success: false,
            error: `${product.name} is limited to ${cap} per pre-order.`,
          });
        }
      }

      if (next !== item.qty) {
        changes.push({ field: 'qty', label: 'Quantity', before: item.qty, after: next });
        item.qty = next;
      }
    }

    // ── Which batch it rides on ──────────────────────────────────────────
    let batch = null;
    let batchChanged = false;
    if (shipmentId !== undefined) {
      const before = item.shipment ? String(item.shipment) : null;

      if (shipmentId) {
        batch = await Shipment.findById(shipmentId);
        if (!batch) {
          return res.status(404).json({ success: false, error: 'Shipment not found' });
        }
        item.shipment = batch._id;
      } else {
        item.shipment = null;
      }

      const after = item.shipment ? String(item.shipment) : null;
      if (before !== after) {
        batchChanged = true;
        changes.push({
          field: 'shipment',
          label: 'Shipment batch',
          before: before || '(none)',
          after: batch ? batch.reference : '(none)',
        });
      }
    }

    if (!changes.length) {
      return res.status(400).json({ success: false, error: 'Nothing to change.' });
    }

    // Totals are always recomputed server-side from the lines, the same way
    // checkout builds them — never adjusted by a delta the client sent.
    order.subtotal = order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
    order.total = Math.max(0, order.subtotal + (order.shippingFee || 0));

    order.trackingHistory.push({
      status: order.status,
      note: `Pre-order updated: ${item.name} — ${changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join(', ')}.`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });

    await order.save();

    // The order's history shows the batch's journey, so moving it between
    // batches (or off one) has to rewrite what the old batch wrote.
    if (batchChanged) {
      await syncPreorderJourney(
        batch ? batch.stageHistory : item.preorderStageHistory,
        { _id: order._id },
      );
    }

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: `Pre-order line updated on ${order.orderNumber} (${item.name})`,
      changes,
    });

    const fresh = await Order.findById(order._id)
      .select('+items.preorderStageHistory')
      .populate('items.shipment', 'stage expectedArrival origin stageHistory reference name containerNumber');
    const data = fresh.toObject();
    data.preorder = buildPreorderTracking(fresh, { includeBatch: true });
    data.items = (data.items || []).map((line) => ({
      ...line,
      shipment: line.shipment?._id || line.shipment || null,
    }));

    res.status(200).json({
      success: true,
      data,
      // What the change did to the money. Nothing has moved — a positive figure
      // is owed by the customer, a negative one is owed back to them.
      meta: { oldTotal, newTotal: order.total, difference: order.total - oldTotal },
    });
  } catch (error) {
    next(error);
  }
};


// Releasing hands goods over, so it may not happen before they are in the
// country. Both stages that mean "in Ghana" qualify — at the port and at our
// warehouse — because a customer collecting from us the day it clears customs
// is a real thing the shop does.
const IN_GHANA_STAGES = ['port_ghana', 'at_shop'];


/**
 * Where this order's waiting pre-order actually is, from whichever source
 * drives it: the batch it rides on, or the line's own recorded stage.
 */
function currentPreorderStage(order) {
  const waiting = (order?.items || []).filter((i) => i.isPreorder && !i.preorderReleasedAt);
  const onBatch = waiting.find((i) => i.shipment?.stage);
  if (onBatch) return onBatch.shipment.stage;
  return waiting.find((i) => i.preorderStage)?.preorderStage || '';
}


/**
 * Fill every waiting pre-order line on this order: move what stock there is to
 * move, mark the lines released, and record it on the order. Does NOT save,
 * email, or log — the callers differ on those.
 *
 * Shared because releasing happens two ways now: staff pressing Release, and a
 * pre-order reaching "Arrived at our warehouse", which means the same thing.
 */
async function fillWaitingPreorderLines(order, actor = {}) {
  const pending = order.items.filter((i) => i.isPreorder && !i.preorderReleasedAt);
  const released = [];
  const fromStock = [];
  const receivedDirect = [];

  for (const item of pending) {
    // Two honest ways a pre-order gets filled, and the shop uses both.
    //
    // 1. The container was received into stock first — twenty units on the
    //    shelf, fifteen of them spoken for. Releasing takes one off, exactly
    //    as fulfilment does, and the guard makes sure it is really there.
    const filter = item.variant?.sku
      ? { _id: item.product, variants: { $elemMatch: { sku: item.variant.sku, stock: { $gte: item.qty } } } }
      : { _id: item.product, stock: { $gte: item.qty } };
    const update = item.variant?.sku
      ? { $inc: { 'variants.$.stock': -item.qty, sold: item.qty } }
      : { $inc: { stock: -item.qty, sold: item.qty } };

    const result = await Product.findOneAndUpdate(filter, update);
    if (result) {
      // Releasing moves variant stock the same way fulfilment does, so the
      // top-level field needs the same correction.
      if (item.variant?.sku) await syncVariantStock(item.product);
      fromStock.push(item);
    } else {
      // 2. The goods arrived FOR this customer and go straight back out —
      //    nothing is kept. A pre-ordered unit was never in stock, which is
      //    what made it a pre-order, so there is nothing to take off. It counts
      //    as sold, and stock is left alone rather than driven negative.
      //    Refusing here demanded stock the shop had correctly never recorded.
      await Product.updateOne({ _id: item.product }, { $inc: { sold: item.qty } });
      receivedDirect.push(item);
    }

    item.preorderReleasedAt = new Date();
    released.push(item);
  }

  if (released.length) {
    order.trackingHistory.push({
      status: order.status,
      note: `Pre-order released: ${released.map((i) => i.name).join(', ')}.`
        + (receivedDirect.length
          ? ` Received directly against this order: ${receivedDirect.map((i) => i.name).join(', ')}.`
          : ''),
      updatedBy: { name: actor.name || '', role: actor.role || '' },
      timestamp: new Date(),
    });
  }

  return { released, fromStock, receivedDirect };
}


/**
 * PATCH /api/v1/orders/:id/preorder-release — the stock has landed (admin/staff).
 *
 * This is the moment a pre-order becomes a normal line: stock moves, `sold`
 * counts it, and the customer is told. Deliberately manual — stock changes for
 * plenty of reasons (a correction, a return, a POS void) and none of those should
 * ship anything by themselves.
 */
const releasePreorder = async (req, res, next) => {
  try {
    // The batch's stage decides whether this may be released, so it has to come
    // along — for a line riding on one, the batch is where the position lives.
    const order = await Order.findById(req.params.id).populate('items.shipment', 'stage');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (!['paid', 'processing'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: 'Only a paid order can have its pre-order released.',
      });
    }

    const pending = order.items.filter((i) => i.isPreorder && !i.preorderReleasedAt);
    if (!pending.length) {
      return res.status(400).json({
        success: false,
        error: 'This order has no pre-order lines waiting to be released.',
      });
    }

    // Goods still abroad cannot be handed to anyone. Releasing moves stock,
    // counts the sale and tells the customer their item has arrived — all three
    // are wrong while it is still on the water.
    const stage = currentPreorderStage(order);
    if (!IN_GHANA_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: stage
          ? `This pre-order has not reached Ghana yet — it is "${STAGE_LABELS[stage] || stage}". `
            + 'Record it as arrived at the port, or at our warehouse, first.'
          : 'This pre-order has no stage recorded yet, so nothing says the goods have arrived. '
            + 'Record where it has got to first.',
      });
    }

    const { released, fromStock, receivedDirect } = await fillWaitingPreorderLines(order, req.user || {});

    await order.save();

    // Best-effort: a mail failure must not undo a release that already moved stock.
    sendPreorderReadyEmail(order, released).catch(() => {});

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: `Pre-order released for ${order.orderNumber} — ${released.map((i) => i.name).join(', ')}`,
      metadata: {
        released: released.length,
        fromStock: fromStock.length,
        receivedDirect: receivedDirect.length,
      },
    });

    res.status(200).json({
      success: true,
      data: order,
      // Named so the caller can tell a full release from a partial one.
      // How each line was filled: off the shelf, or received against this
      // order because the goods arrived with nothing spare.
      meta: {
        released: released.length,
        fromStock: fromStock.map((i) => i.name),
        receivedDirect: receivedDirect.map((i) => i.name),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPreorderCount,
  getPreorders,
  updatePreorderStage,
  updatePreorderLine,
  releasePreorder,
};
