/**
 * Staff and admin order management: the list, one order, status and tracking
 * events, refunds, and address changes.
 *
 * Split out of controllers/orderController.js, which re-exports these so the
 * route files are unchanged. Moved verbatim — no logic was rewritten.
 */
const {
  Paystack, Order, PickupLocation, quoteShipping, splitCourierMethodId,
  restockOrderItems, formatGhs, logFromRequest, ACTIONS, RESOURCES,
  applyRefundOutcome, mapPaystackRefundStatus, sendShopStatusEmail,
  paystack, buildPreorderTracking, ORDER_STATUSES, canTransition,
  PENDING_PREORDER, preorderHold,
} = require("./common");


const getOrders = async (req, res, next) => {
  try {
    const { status, preorder } = req.query;
    const query = {};
    if (status && ORDER_STATUSES.includes(status)) {
      query.status = status;
    }

    // `preorder=pending` is the release queue; `preorder=any` is every order
    // that has ever carried a pre-order line, released or not.
    let sort = { createdAt: -1 };
    if (preorder === 'pending') {
      Object.assign(query, PENDING_PREORDER);
      // Oldest first: the customer who has waited longest is the one to serve.
      // Newest-first is right for browsing and wrong for a queue.
      sort = { createdAt: 1 };
    } else if (preorder === 'any') {
      query['items.isPreorder'] = true;
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const orders = await Order.find(query)
      .populate('deliveryZone')
      .sort(sort)
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};


const getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .select('+items.preorderStageHistory')
      .populate('deliveryZone')
      .populate('items.shipment', 'stage expectedArrival origin stageHistory reference name containerNumber');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Staff see the batch identity too — it is the first thing support reaches
    // for when a customer asks where their pre-order is.
    const data = order.toObject();
    data.preorder = buildPreorderTracking(order, { includeBatch: true });
    data.items = (data.items || []).map((line) => ({
      ...line,
      shipment: line.shipment?._id || line.shipment || null,
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};


const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Valid status required: ${ORDER_STATUSES.join(', ')}`
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (!canTransition(order.status, status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot change order from "${order.status}" to "${status}".`,
      });
    }

    const held = preorderHold(order, status);
    if (held) {
      return res.status(400).json({ success: false, error: held });
    }

    const prevStatus = order.status;
    order.status = status;
    if (status === 'paid' && !order.paidAt) {
      order.paidAt = new Date();
    }
    if (status === 'cancelled' && order.stockDeducted && !order.stockRestored) {
      await restockOrderItems(order);
      order.stockRestored = true;
    }
    // T80 E2 — pickup lifecycle markers. For bus-station-pickup orders:
    //   `shipped`   → readyForPickupAt (parcel reached the chosen station)
    //   `delivered` → pickedUpAt      (customer collected the parcel)
    // We deliberately reuse the existing 'shipped' / 'delivered' status values
    // (no new enum) so reports and forward-only transitions keep working.
    if (order.shippingMethod === "bus_station_pickup") {
      if (status === "shipped" && !order.readyForPickupAt) {
        order.readyForPickupAt = new Date();
      }
      if (status === "delivered" && !order.pickedUpAt) {
        order.pickedUpAt = new Date();
      }
    }
    order.trackingHistory.push({
      status,
      note: `Status updated to ${status}.`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await order.save();

    if (prevStatus !== status) {
      await logFromRequest(req, {
        action: status === 'cancelled' ? ACTIONS.ORDER_CANCELLED : ACTIONS.ORDER_STATUS_CHANGED,
        resourceType: RESOURCES.ORDER,
        resourceId: order.orderNumber,
        resourceName: order.orderNumber,
        description: status === 'cancelled'
          ? `Order ${order.orderNumber} cancelled`
          : `Order ${order.orderNumber} status changed ${prevStatus} → ${status}`,
        changes: [{ field: 'status', label: 'Order Status', before: prevStatus, after: status }],
      });

    // T78 — when an order reaches delivered, settle the courier payout.
    // Best-effort: a settlement failure must not block the status update.
    if (status === "delivered" && prevStatus !== "delivered") {
      const { settleDeliveryCharge } = require("../../services/shipping/settleDeliveryCharge");
      settleDeliveryCharge(order).catch((err) => {
        console.error("[settle] delivery charge settlement failed:", err.message);
      });
    }

    // T62 — the customer hears about meaningful moves, like repair jobs already
    // do. Best-effort: never let a mail problem fail a status change.
    sendShopStatusEmail(order).catch(() => {});
  }

  res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};


/**
 * POST /api/v1/orders/:id/tracking  (staff/admin)
 * Append a tracking event — status change and/or a staff note with an
 * optional location. When `status` is supplied and valid it also advances
 * the order status, so the order and its history never drift apart.
 */
const addTrackingEvent = async (req, res, next) => {
  try {
    const { status, note, location } = req.body;

    if (status && !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Valid status required: ${ORDER_STATUSES.join(', ')}`
      });
    }
    if (!status && !note) {
      return res.status(400).json({ success: false, error: 'A status or note is required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (status && !canTransition(order.status, status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot change order from "${order.status}" to "${status}".`,
      });
    }

    // A note-only event stays open on purpose: "customer called about the ETA"
    // is the most useful thing staff can record during the months a pre-order
    // spends waiting, and it moves nothing.
    const held = preorderHold(order, status);
    if (held) {
      return res.status(400).json({ success: false, error: held });
    }

    const prevStatus = order.status;
    if (status) {
      order.status = status;
      if (status === 'paid' && !order.paidAt) {
        order.paidAt = new Date();
      }
      if (status === 'cancelled' && order.stockDeducted && !order.stockRestored) {
        await restockOrderItems(order);
        order.stockRestored = true;
      }
      // T80 E2 — pickup lifecycle markers (see updateOrderStatus for the
      // rationale — same rules apply on this door).
      if (order.shippingMethod === "bus_station_pickup") {
        if (status === "shipped" && !order.readyForPickupAt) {
          order.readyForPickupAt = new Date();
        }
        if (status === "delivered" && !order.pickedUpAt) {
          order.pickedUpAt = new Date();
        }
      }
    }

    order.trackingHistory.push({
      status: status || order.status,
      note: note ? String(note).trim() : `Status updated to ${status}.`,
      location: location ? String(location).trim() : '',
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await order.save();

    const statusChanged = status && status !== prevStatus;
    const changes = [];
    if (statusChanged) {
      changes.push({ field: 'status', label: 'Order Status', before: prevStatus, after: status });
    }
    if (note) {
      changes.push({ field: 'note', label: 'Tracking Note', before: null, after: String(note).trim() });
    }
    if (location) {
      changes.push({ field: 'location', label: 'Location', before: null, after: String(location).trim() });
    }
    await logFromRequest(req, {
      action: statusChanged
        ? (status === 'cancelled' ? ACTIONS.ORDER_CANCELLED : ACTIONS.ORDER_STATUS_CHANGED)
        : ACTIONS.ORDER_TRACKING_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: statusChanged
        ? `Order ${order.orderNumber} status changed ${prevStatus} → ${status}`
        : `Tracking updated for order ${order.orderNumber}`,
      changes,
    });

    // T62 — the tracking endpoint is the other door status changes walk through.
    // Notes-only updates don't email; only a real status move does.
    if (statusChanged) sendShopStatusEmail(order).catch(() => {});

    // T78 — settle courier payout on delivered (same as updateOrderStatus).
    if (status === "delivered" && statusChanged) {
      const { settleDeliveryCharge } = require("../../services/shipping/settleDeliveryCharge");
      settleDeliveryCharge(order).catch((err) => {
        console.error("[settle] delivery charge settlement failed:", err.message);
      });
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};


// T15 — a refund is a payment outcome, not a fulfilment stage: no "refunded"
// value was added to ORDER_STATUSES. T78 — delivered orders are now eligible
// too (refund the shipping charge after settlement).
const REFUND_ELIGIBLE_STATUSES = ['paid', 'processing', 'shipped', 'delivered'];


/**
 * POST /api/v1/orders/:id/refund  (admin only)
 * Full-order refund via Paystack. Claim-then-call: the atomic write below
 * flips refund.status 'none' -> 'processing' *before* the Paystack API call
 * fires, so (a) two simultaneous requests can't both proceed — the second
 * gets no match and 409s — and (b) a crash between the claim and the
 * Paystack call fails safe: a stuck 'processing' record with no money moved,
 * recoverable via /refund/sync or the reconcile job, rather than risking a
 * duplicate refund attempt. See backend-eaz/tasks.md T15 for the full design
 * writeup, including why call-then-claim was rejected.
 */
const refundOrder = async (req, res, next) => {
  try {
    if (!paystack) {
      return res.status(500).json({ success: false, error: 'Paystack not configured.' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (!order.paystackReference) {
      return res.status(400).json({ success: false, error: 'Order has no Paystack payment to refund.' });
    }
    if (!REFUND_ELIGIBLE_STATUSES.includes(order.status)) {
      return res.status(400).json({ success: false, error: `Cannot refund an order with status "${order.status}".` });
    }

    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : '';

    // Atomic claim. Re-checks the same conditions as above so a race between
    // the reads and this write can't slip a second refund through.
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, 'refund.status': 'none', status: { $in: REFUND_ELIGIBLE_STATUSES } },
      {
        $set: {
          'refund.status': 'processing',
          'refund.amount': order.total,
          'refund.reason': reason,
          'refund.requestedBy': req.user._id,
          'refund.requestedAt': new Date(),
        },
      },
      { new: true }
    );
    if (!claimed) {
      return res.status(409).json({ success: false, error: 'A refund is already in progress or completed for this order.' });
    }

    await logFromRequest(req, {
      action: ACTIONS.REFUND_INITIATED,
      resourceType: RESOURCES.PAYMENT,
      resourceId: claimed.orderNumber,
      resourceName: `Order ${claimed.orderNumber}`,
      description: `Refund initiated for order ${claimed.orderNumber} (${formatGhs(claimed.total)})`,
      metadata: { reason },
    });

    let refundResponse;
    try {
      refundResponse = await paystack.refund.create({
        transaction: claimed.paystackReference,
        amount: claimed.total,
        currency: 'GHS',
        merchant_note: reason || undefined,
      });
    } catch (err) {
      // The claim already flipped refund.status to 'processing'. We don't
      // know whether Paystack received the request before this error, so we
      // don't guess — leave it in 'processing' and let /refund/sync or the
      // reconcile job ask Paystack directly, rather than risk a duplicate
      // refund by blindly retrying create() here.
      console.error(`[refund] paystack.refund.create threw for order ${claimed.orderNumber}:`, err.message);
      return res.status(202).json({
        success: true,
        data: claimed,
        warning: 'Refund request sent but not yet confirmed. Status will update automatically, or use /refund/sync to check now.',
      });
    }

    if (!refundResponse?.status) {
      // Paystack responded and rejected the request outright — this is a
      // confirmed failure, not an ambiguous one, so mark it now.
      await applyRefundOutcome(claimed, 'failed', req.user);
      return res.status(502).json({
        success: false,
        error: refundResponse?.message || 'Paystack rejected the refund request.',
        data: claimed,
      });
    }

    claimed.refund.reference = refundResponse.data?.id != null ? String(refundResponse.data.id) : null;
    // Reuse the exact cancellation transition + T2 restock the rest of this
    // app already uses — a refund IS a cancellation, plus payment detail.
    claimed.status = 'cancelled';
    if (claimed.stockDeducted && !claimed.stockRestored) {
      await restockOrderItems(claimed);
      claimed.stockRestored = true;
    }
    claimed.trackingHistory.push({
      status: 'cancelled',
      note: `Order cancelled — refund initiated (${formatGhs(claimed.total)}).`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await claimed.save();

    // T78 — if a delivery charge was settled, mark it refunded so the summary
    // reports don't double-count. Best-effort: a DeliveryCharge write failure
    // must not block the order refund.
    const DeliveryCharge = require("../../models/DeliveryCharge");
    DeliveryCharge.findOneAndUpdate(
      { orderId: claimed._id, refunded: false },
      { $set: { refunded: true, refundedAt: new Date() } },
    ).catch(() => {});

    res.status(200).json({ success: true, data: claimed });
  } catch (error) {
    next(error);
  }
};


/**
 * POST /api/v1/orders/:id/refund/sync  (admin only)
 * Manual reconciliation — asks Paystack directly what a refund's real status
 * is. Fallback for when the refund.processed/refund.failed webhook doesn't
 * arrive; Paystack webhook delivery has never been live-verified in this
 * project (see backend-eaz/tasks.md T3b — still blocked). Read-only against
 * Paystack (refund.fetch), safe to call repeatedly.
 */
const syncRefund = async (req, res, next) => {
  try {
    if (!paystack) {
      return res.status(500).json({ success: false, error: 'Paystack not configured.' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (!order.refund?.reference) {
      return res.status(400).json({ success: false, error: 'No refund reference to check for this order.' });
    }
    if (['completed', 'failed'].includes(order.refund.status)) {
      return res.status(200).json({ success: true, data: order }); // already settled
    }

    const result = await paystack.refund.fetch({ id: order.refund.reference });
    const outcome = mapPaystackRefundStatus(result?.data?.status);
    if (outcome) await applyRefundOutcome(order, outcome, req.user);
    // else: still in-flight at Paystack's end — leave as 'processing'.

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};


/**
 * PATCH /api/v1/orders/:id/address  (admin/staff)
 * Change the delivery address and recalculate the shipping fee. Blocked once
 * the order reaches "shipped" status — the goods are already on the way.
 *
 * The old address + fee + zone are pushed onto `addressHistory` so the
 * complete trail is auditable. If the fee changes, the order total is
 * adjusted accordingly and the delta is surfaced in the response.
 *
 * T80 E2: accepts `region` + `pickupLocationId` so an address change can
 * also move a customer between delivery zones (e.g. East Legon → Kumasi
 * switches fulfilment from in-house to bus-station pickup). Pickup
 * location id is validated live; the snapshot name is preserved.
 *
 * NOTE: this does NOT re-authorize a Paystack payment. If the new total is
 * higher the customer must pay the difference separately (Phase 5 settle
 * endpoint); if lower the delta is a credit. The webhook handler must be
 * aware of this.
 */
const changeOrderAddress = async (req, res, next) => {
  try {
    let { address, neighborhood, city, method, deliverySpeed, region, pickupLocationId } = req.body;

    // Decompose compound courier method IDs.
    ({ method, deliverySpeed } = splitCourierMethodId(method, deliverySpeed));

    if (!neighborhood || !city || !method) {
      return res.status(400).json({
        success: false,
        error: "neighborhood, city, and method are required.",
      });
    }

    // T80 E2 — bus-station pickup on an address change must still name a
    // real, active station in the destination city.
    let pickupLocationName = null;
    if (method === "bus_station_pickup") {
      if (!pickupLocationId) {
        return res.status(400).json({
          success: false,
          error: "A pickup location is required for bus-station pickup.",
        });
      }
      const pickup = await PickupLocation.findOne({
        _id: pickupLocationId,
        kind: "bus_station",
        isActive: true,
        ...(city ? { city } : {}),
      }).lean();
      if (!pickup) {
        return res.status(400).json({
          success: false,
          error: "The selected pickup location is not available.",
        });
      }
      pickupLocationName = pickup.name;
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found." });
    }
    if (["shipped", "delivered", "cancelled"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot change address for an order with status "${order.status}".`,
      });
    }

    // Build order-like items the calculator can consume.
    const quoteItems = order.items.map((item) => ({
      product: {
        _id: item.product || item.part,
        name: item.name,
        price: item.price,
        weight: 0,
        weightUnit: "kg",
        isFragile: false,
        category: "",
      },
      quantity: item.qty,
    }));

    let newShippingFee = 0;
    let newZoneCode = null;
    let newWeightKg = 0;
    let newTierLevel = 0;
    let newRegion = null;

    try {
      const quote = await quoteShipping({
        city,
        neighborhood: neighborhood || "",
        address: address || "",
        method,
        deliverySpeed: deliverySpeed || order.shippingSpeed || "standard",
        items: quoteItems,
        subtotal: order.subtotal,
        ...(region ? { region } : {}),
        ...(pickupLocationId ? { pickupLocationId } : {}),
      });
      newShippingFee = quote.shippingFee;
      newZoneCode = quote.zoneCode;
      newWeightKg = quote.totalWeightKg || 0;
      newTierLevel = quote.tierLevel || 0;
      newRegion = quote.region || region || null;
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: err.message,
      });
    }

    // Record the change in addressHistory.
    order.addressHistory.push({
      address: order.customer.address,
      shippingFee: order.shippingFee,
      zoneCode: order.shippingZoneCode,
      changedBy: req.user?.name || "staff",
      changedAt: new Date(),
    });

    const oldFee = order.shippingFee;
    const oldTotal = order.total;

    // Update order fields.
    order.customer.address = String(address || "").trim();
    order.shippingFee = newShippingFee;
    order.shippingZoneCode = newZoneCode;
    order.shippingMethod = method;
    order.shippingSpeed = deliverySpeed || order.shippingSpeed || "standard";
    order.shippingWeightKg = newWeightKg;
    order.shippingTierLevel = newTierLevel;
    // T80 E2 — region + pickup live with the order so the historical
    // record shows the new fulfilment context, not a re-query.
    order.shippingRegion = newRegion;
    order.pickupLocationId = method === "bus_station_pickup" ? pickupLocationId : null;
    order.pickupLocationName = method === "bus_station_pickup" ? pickupLocationName : null;
    order.total = Math.max(0, order.subtotal + newShippingFee);

    await order.save();

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: `Address changed for ${order.orderNumber}: fee ${formatGhs(oldFee)} → ${formatGhs(newShippingFee)}`,
      changes: [
        { field: "customer.address", label: "Address", before: "(previous)", after: address },
        { field: "shippingFee", label: "Shipping Fee", before: oldFee, after: newShippingFee },
      ],
    });

    res.status(200).json({
      success: true,
      data: order,
      meta: {
        oldShippingFee: oldFee,
        newShippingFee,
        feeDifference: newShippingFee - oldFee,
        oldTotal,
        newTotal: order.total,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOrders,
  getOrder,
  updateOrderStatus,
  addTrackingEvent,
  refundOrder,
  syncRefund,
  changeOrderAddress,
};
