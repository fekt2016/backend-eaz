/**
 * What a customer may see about their own order — the public tracking number,
 * the order-number lookup, the confirmation page, and their own order list.
 *
 * Split out of controllers/orderController.js, which re-exports these so the
 * route files are unchanged. Moved verbatim — no logic was rewritten.
 */
const {
  Paystack, Order, fulfilShopOrder, normalizePhone,
  buildCustomerOrderFilter, paystack, buildPreorderTracking,
} = require("./common");


const trackOrder = async (req, res, next) => {
  try {
    const { orderNumber, phone } = req.body;

    if (!orderNumber || !phone) {
      return res.status(400).json({ success: false, error: 'Order number and phone are required' });
    }

    const order = await Order.findOne({
      orderNumber: String(orderNumber).trim().toUpperCase()
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (normalizePhone(phone) !== normalizePhone(order.customer.phone)) {
      return res.status(403).json({ success: false, error: 'Phone number does not match this order' });
    }

    // This is the tracking page reached from the site, so it needs the pre-order
    // position too — without it a customer who paid for goods still in China saw
    // a plain "Paid" and nothing about where their item is.
    await order.populate({ path: 'items.shipment', select: 'stage expectedArrival origin stageHistory' });
    const preorder = buildPreorderTracking(order);

    // The populated shipment must not ride along: its stageHistory carries
    // internal notes and the staff who entered them. Only the derived block goes.
    const data = order.toObject();
    data.items = (data.items || []).map(({ shipment, ...line }) => line);
    data.preorder = preorder;

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/v1/orders/track/:trackingNumber
 * Public — dedicated tracking detail for a shop order. Returns a minimal
 * payload: status, timeline history and delivery destination only. No
 * customer details, items, or money figures leak out, so this URL is safe
 * to share in order-confirmation emails and on dashboards.
 */
const getOrderTracking = async (req, res, next) => {
  try {
    const trackingNumber = String(req.params.trackingNumber || '').trim().toUpperCase();
    if (!trackingNumber) {
      return res.status(400).json({ success: false, error: 'Tracking number is required' });
    }

    const order = await Order.findOne({ trackingNumber })
      .populate('deliveryZone', 'name')
      .populate('items.shipment', 'stage expectedArrival origin stageHistory')
      .lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Tracking number not found' });
    }

    // T45: where an unreleased pre-order line actually is. Eight operational
    // stages collapse to four the customer can act on, and nothing identifying
    // the supplier, the container or any internal note crosses this line — the
    // rest of this payload is deliberately minimal for the same reason.
    const preorder = buildPreorderTracking(order);

    const history = (order.trackingHistory || [])
      .map((e) => ({
        status: e.status,
        note: e.note || '',
        location: e.location || '',
        timestamp: e.timestamp,
        // Which entries are the batch's journey rather than a fulfilment event,
        // so the timeline can mark them, and what staff wrote for the customer
        // alongside it. `updatedBy` still never crosses.
        preorderStage: e.preorderStage || '',
        detail: e.detail || '',
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.status(200).json({
      success: true,
      data: {
        trackingNumber: order.trackingNumber,
        orderNumber: order.orderNumber,
        status: order.status,
        destination: order.deliveryZone?.name || '',
        shippingMethod: order.shippingMethod || null,
        shippingSpeed: order.shippingSpeed || null,
        // The label the customer picked, snapshotted at order time.
        shippingMethodLabel: order.shippingMethodLabel || null,
        shippingFee: order.shippingFee || 0,
        shippingZoneCode: order.shippingZoneCode || null,
        shippingZoneName: order.shippingZoneName || null,
        shippingNeighborhood: order.shippingNeighborhood || null,
        createdAt: order.createdAt,
        history,
        latestEvent: history.length ? history[history.length - 1] : null,
        // Null for an ordinary order, so existing clients are unaffected.
        preorder,
        // T80 E2 — pickup-fulfilment snapshot. Null for home-delivery orders.
        // `pickupLocation` is shaped for direct display in the tracking UI;
        // it omits internal fields the public endpoint never exposes.
        pickup: order.shippingMethod === "bus_station_pickup"
          ? {
              name: order.pickupLocationName || null,
              address: null, // live address lookup is admin-only
              region: order.shippingRegion || null,
              readyForPickupAt: order.readyForPickupAt || null,
              pickedUpAt: order.pickedUpAt || null,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};


// ── Public order view (T86) ─────────────────────────────────────────────────
// What an unauthenticated holder of a payment reference may see: enough for the
// customer to recognise their own order, not enough to be worth stealing.

/** "Ama Owusu" -> "Ama O." — recognisable to its owner, not an identity to others. */
function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const [first, ...rest] = parts;
  return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : first;
}


/** Keeps the last 3 digits: "0244000111" -> "•••••••111". */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 3) return '•'.repeat(digits.length);
  return `${'•'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}


function publicOrderView(order) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    trackingNumber: order.trackingNumber || null,

    subtotal: order.subtotal,
    total: order.total,
    deliveryFee: order.deliveryFee,
    shippingFee: order.shippingFee,
    items: (order.items || []).map((i) => ({
      name: i.name,
      qty: i.qty,
      price: i.price,
      isPreorder: Boolean(i.isPreorder),
    })),

    // Area-level only — the same fields getOrderTracking already exposes
    // publicly. They say which neighbourhood, never which door.
    shippingMethod: order.shippingMethod || null,
    shippingMethodLabel: order.shippingMethodLabel || null,
    shippingSpeed: order.shippingSpeed || null,
    shippingRegion: order.shippingRegion || null,
    shippingNeighborhood: order.shippingNeighborhood || null,
    shippingZoneName: order.shippingZoneName || null,
    pickupLocationName: order.pickupLocationName || null,

    // Masked, so a leaked link cannot be used to contact or locate the
    // customer. No email and no street address at all.
    customer: {
      name: maskName(order.customer?.name),
      phone: maskPhone(order.customer?.phone),
    },

    // The confirmation page is where someone lands seconds after paying, which
    // for a pre-order is exactly when "where is my money going" is loudest.
    // Null for an ordinary order, so nothing changes for one.
    preorder: buildPreorderTracking(order),
  };
}


/**
 * GET /api/v1/orders/by-reference/:reference
 * Public lookup by Paystack reference for the order confirmation page.
 */
const getOrderByReference = async (req, res, next) => {
  try {
    const order = await Order.findOne({ paystackReference: req.params.reference })
      .populate('items.shipment', 'stage expectedArrival origin stageHistory');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Actively verify the payment with Paystack when the order is still
    // pending — the confirmation page should not depend on the webhook alone.
    if (order.status === 'pending' && paystack) {
      try {
        const verify = await paystack.transaction.verify({ reference: order.paystackReference });
        const tx = verify?.data || {};
        if (verify?.status && tx.status === 'success') {
          // Idempotent (no-op if a webhook already fulfilled it) and guarded —
          // fulfilShopOrder throws rather than fulfil a mismatched charge.
          const paid = await fulfilShopOrder(order.paystackReference, {
            amountPesewas: tx.amount,
            currency:      tx.currency,
          });
          if (paid) order.status = 'paid';
        }
      } catch (e) {
        // Verification is best-effort here; the webhook remains authoritative.
        console.error(`[verify] Could not verify order ${order.orderNumber}:`, e.message);
      }
    }

    // T86 — this route needs no auth, so the response is an explicit projection,
    // not the order document. A reference travels: shared confirmation links,
    // forwarded emails, browser history, referrer headers. Returning the whole
    // document handed anyone holding one the customer's full name, phone, email
    // and delivery address. getOrderTracking, the sibling public route, already
    // redacts the same fields — this brings the two into line.
    res.status(200).json({ success: true, data: publicOrderView(order) });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/v1/orders/mine
 * Shop orders for the logged-in customer. Orders are guest checkouts, so we
 * match them to the account by the customer's email and/or phone (several
 * common phone formats), never by a stored user id.
 */
const getMyOrders = async (req, res, next) => {
  try {
    // Shop orders are guest checkouts with no `user` ref, so they are linked to
    // an account by the contact details captured at checkout. That matcher now
    // lives in utils/customerOrderMatch so the admin user-detail page uses the
    // SAME rule — two copies would drift, and an admin would silently see a
    // different set of orders than the customer sees for themselves.
    const filter = buildCustomerOrderFilter({ email: req.user?.email, phone: req.user?.phone });
    if (!filter) return res.status(200).json({ success: true, count: 0, data: [] });

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/v1/orders/mine/:id
 * A logged-in customer's own order detail. Ownership is verified the same way
 * as getMyOrders — email and/or normalized phone must match — so a customer
 * can never view another account's order by id.
 */
const getMyOrderById = async (req, res, next) => {
  try {
    const or = [];
    if (req.user?.email) {
      or.push({ 'customer.email': String(req.user.email).toLowerCase() });
    }
    if (req.user?.phone) {
      const digits = normalizePhone(req.user.phone);
      if (digits) {
        or.push({ 'customer.phoneDigits': digits });
        or.push({ 'customer.phone': { $in: [req.user.phone, digits] } });
      }
    }
    if (!or.length) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const order = await Order.findOne({ _id: req.params.id, $or: or })
      .populate('deliveryZone')
      .populate('items.shipment', 'stage expectedArrival origin stageHistory');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Same block the tracking pages show. Without it a customer opening their own
    // pre-order saw a status and a price and nothing about where the goods are.
    const data = order.toObject();
    data.preorder = buildPreorderTracking(order);
    // stageHistory carries internal notes; only the derived block crosses.
    data.items = (data.items || []).map(({ shipment, ...line }) => line);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  trackOrder,
  getOrderTracking,
  getOrderByReference,
  getMyOrders,
  getMyOrderById,
};
