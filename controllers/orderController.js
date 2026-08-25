const crypto = require("crypto");
const Paystack = require("@paystack/paystack-sdk");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Part = require("../models/Part");
const DeliveryZone = require("../models/DeliveryZone");
const { fulfilShopOrder, restockOrderItems } = require("../utils/fulfilShopOrder");
const { generateTrackingNumber } = require("../utils/trackingNumber");
const { formatGhs } = require("../utils/money");
const { log, logFromRequest, ACTIONS, RESOURCES } = require("../services/activityLogService");
const { normalizePhone } = require("../utils/phone");
const { applyRefundOutcome, mapPaystackRefundStatus } = require("../utils/refunds");
const { sendPreorderReadyEmail } = require("../utils/email");
const { CUSTOMER_STAGES } = require("../models/Shipment");

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith("sk_")) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn(
    "⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for payments.",
  );
}

const FRONTEND_URL = require("../utils/frontendUrl")();

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `EZW-${ts}${rand}`;
}

/**
 * POST /api/v1/orders
 * Guest checkout — no auth required. Totals are always computed
 * server-side from the DB; client-submitted prices are never trusted.
 */
const createOrder = async (req, res, next) => {
  try {
    const { items, deliveryZoneId, customer } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Cart is empty" });
    }
    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({ success: false, error: "Name and phone are required" });
    }

    const orderItems = [];

    for (const item of items) {
      const slug = typeof item === "string" ? item : item.slug;
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));

      if (slug.startsWith("part-")) {
        const partId = slug.replace("part-", "");
        const part = await Part.findById(partId);
        if (!part) {
          return res.status(400).json({ success: false, error: `Part with id ${partId} not found.` });
        }
        if (!Number(part.sellingPrice) || part.sellingPrice <= 0) {
          return res.status(400).json({ success: false, error: `${part.name} is not available for ordering.` });
        }
        if (part.quantity < qty) {
          return res.status(400).json({ success: false, error: `${part.name} only has ${part.quantity} in stock.` });
        }
        orderItems.push({
          part: part._id,
          name: part.name,
          price: Math.round(Number(part.sellingPrice)),
          qty,
        });
        continue;
      }

      if (!slug) continue;

      const product = await Product.findOne({ slug, isActive: true });
      if (!product) {
        return res.status(400).json({ success: false, error: `Product "${slug}" not found.` });
      }

      // Structured variants (Decision #1): when a variant SKU is sent, stock is
      // checked against that variant, and the order line records which variant
      // was purchased. Products without variants keep the old single-SKU path.
      let variantInfo = null;
      // Variant price wins over base price when set; `null`/unset falls back
      // to product.price (see Product.js variants schema comment).
      let resolvedPrice = product.price;
      if (item.variant && item.variant.sku) {
        const variant = (product.variants || []).find(
          (v) => v.sku === item.variant.sku,
        );
        if (!variant) {
          return res.status(400).json({
            success: false,
            error: `Variant "${item.variant.sku}" not found for ${product.name}.`,
          });
        }
        if (variant.stock < qty && !product.preorder?.enabled) {
          const label = Object.values(variant.attributes || {}).join(" ");
          return res.status(400).json({
            success: false,
            error: `${product.name}${label ? ` (${label})` : ""} only has ${variant.stock} in stock.`,
          });
        }
        variantInfo = {
          sku: variant.sku,
          attributes:
            variant.attributes && typeof variant.attributes.toObject === "function"
              ? variant.attributes.toObject()
              : variant.attributes || {},
        };
        resolvedPrice = variant.price != null ? variant.price : product.price;
      }

      // T45: how much stock this line is actually drawing on — the variant's when
      // one was chosen, the product's otherwise.
      const availableStock = variantInfo
        ? (product.variants || []).find((v) => v.sku === variantInfo.sku)?.stock ?? 0
        : product.stock;

      // A line becomes a pre-order only when the stock genuinely isn't there AND
      // the product is marked for it. An in-stock product is never sold as a
      // pre-order, so enabling the flag cannot change how normal orders behave.
      const isPreorder = availableStock < qty && Boolean(product.preorder?.enabled);

      if (availableStock < qty && !isPreorder) {
        return res.status(400).json({ success: false, error: `${product.name} only has ${availableStock} in stock.` });
      }

      // The cap is supply-side, so it is enforced here rather than only hidden in
      // the storefront — a hand-rolled request must not be able to exceed it.
      const cap = product.preorder?.maxQty;
      if (isPreorder && cap != null && qty > cap) {
        return res.status(400).json({
          success: false,
          error: `${product.name} is limited to ${cap} per pre-order.`,
        });
      }

      orderItems.push({
        product: product._id,
        name: product.name,
        ...(variantInfo && { variant: variantInfo }),
        price: resolvedPrice,
        qty,
        ...(isPreorder && { isPreorder: true }),
      });
    }

    const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);

    let deliveryFee = 0;
    let deliveryZone = null;
    if (deliveryZoneId) {
      deliveryZone = await DeliveryZone.findOne({ _id: deliveryZoneId, isActive: true });
      if (!deliveryZone) {
        return res.status(400).json({ success: false, error: "Invalid delivery zone" });
      }
      deliveryFee = deliveryZone.fee;
    }

    const total = subtotal + deliveryFee;

    if (!paystack) {
      return res.status(500).json({ success: false, error: "Paystack not configured." });
    }

    const reference = `ORD_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const email = orderCustomerEmail(customer);

    const transaction = await paystack.transaction.initialize({
      email,
      amount: total,
      currency: "GHS",
      reference,
      channels: ["card", "mobile_money"],
      metadata: { type: "shop_order" },
      callback_url: `${FRONTEND_URL}/order-confirmation/${reference}`,
    });

    if (!transaction.status) {
      return res.status(500).json({ success: false, error: "Failed to initialize payment." });
    }

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      trackingNumber: generateTrackingNumber(),
      items: orderItems,
      subtotal,
      ...(deliveryZone && { deliveryZone: deliveryZone._id }),
      deliveryFee,
      total,
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        phoneDigits: normalizePhone(customer.phone),
        email: (customer.email || "").trim().toLowerCase(),
        address: (customer.address || "").trim(),
      },
      status: "pending",
      paystackReference: reference,
      trackingHistory: [{
        status: "pending",
        note: "Order placed — awaiting payment confirmation.",
        timestamp: new Date(),
      }],
    });

    await logOrderCreated(order);

    return res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        accessCode: transaction.data.access_code,
        reference: transaction.data.reference,
        orderId: order._id,
        orderNumber: order.orderNumber,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Log the shop order creation once it has been persisted (guest checkout — no
// authenticated actor, so the record carries the customer snapshot instead).
async function logOrderCreated(order) {
  await log({
    action: ACTIONS.ORDER_CREATED,
    resourceType: RESOURCES.ORDER,
    resourceId: order.orderNumber,
    resourceName: order.orderNumber,
    description: `Order ${order.orderNumber} placed (${order.items.length} item${order.items.length === 1 ? '' : 's'}, ${formatGhs(order.total)})`,
    metadata: {
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      reference: order.paystackReference,
      totalPesewas: order.total,
    },
  });
}

function orderCustomerEmail(customer) {
  const email = (customer.email || '').trim().toLowerCase();
  if (email) return email;
  const phone = (customer.phone || '').trim().replace(/\s+/g, '');
  return `${phone || 'guest'}@eazworld.com`;
}

/**
 * POST /api/v1/orders/track
 * Guest order tracking: orderNumber + phone. The order is only returned
 * when the submitted phone matches customer.phone — this prevents order
 * enumeration by guessing order numbers alone.
 */
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

    res.status(200).json({ success: true, data: order });
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
      .populate('items.shipment', 'stage expectedArrival')
      .lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Tracking number not found' });
    }

    // T45: where an unreleased pre-order line actually is. Eight operational
    // stages collapse to four the customer can act on, and nothing identifying
    // the supplier, the container or any internal note crosses this line — the
    // rest of this payload is deliberately minimal for the same reason.
    const waiting = (order.items || []).filter((i) => i.isPreorder && !i.preorderReleasedAt);
    const withShipment = waiting.find((i) => i.shipment?.stage);
    const preorder = waiting.length
      ? {
          items: waiting.map((i) => ({ name: i.name, qty: i.qty })),
          stage: withShipment ? CUSTOMER_STAGES[withShipment.shipment.stage]?.key || null : null,
          label: withShipment
            ? CUSTOMER_STAGES[withShipment.shipment.stage]?.label || null
            : 'Confirmed — awaiting shipment',
          expectedArrival: withShipment ? withShipment.shipment.expectedArrival || null : null,
        }
      : null;

    const history = (order.trackingHistory || [])
      .map((e) => ({
        status: e.status,
        note: e.note || '',
        location: e.location || '',
        timestamp: e.timestamp,
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.status(200).json({
      success: true,
      data: {
        trackingNumber: order.trackingNumber,
        orderNumber: order.orderNumber,
        status: order.status,
        destination: order.deliveryZone?.name || '',
        createdAt: order.createdAt,
        history,
        latestEvent: history.length ? history[history.length - 1] : null,
        // Null for an ordinary order, so existing clients are unaffected.
        preorder,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/orders/by-reference/:reference
 * Public lookup by Paystack reference for the order confirmation page.
 */
const getOrderByReference = async (req, res, next) => {
  try {
    const order = await Order.findOne({ paystackReference: req.params.reference });
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
          if (Number(tx.amount) === order.total && (!tx.currency || tx.currency === 'GHS')) {
            // Idempotent: no-op if a webhook already fulfilled it.
            const paid = await fulfilShopOrder(order.paystackReference);
            if (paid) order.status = 'paid';
          } else {
            console.error(
              `[verify] Amount/currency mismatch for order ${order.orderNumber}: ` +
              `expected ${order.total} GHS, Paystack reports ${tx.amount} ${tx.currency}`
            );
          }
        }
      } catch (e) {
        // Verification is best-effort here; the webhook remains authoritative.
        console.error(`[verify] Could not verify order ${order.orderNumber}:`, e.message);
      }
    }

    res.status(200).json({ success: true, data: order });
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
    const or = [];
    if (req.user?.email) {
      or.push({ 'customer.email': String(req.user.email).toLowerCase() });
    }
    if (req.user?.phone) {
      const digits = normalizePhone(req.user.phone);
      if (digits) {
        // New orders carry a normalized phoneDigits — the authoritative key.
        or.push({ 'customer.phoneDigits': digits });
        // Legacy orders only have the raw phone string; try common formats.
        const variants = new Set([req.user.phone, digits]);
        if (digits.startsWith('0')) {
          variants.add(`233${digits.slice(1)}`);
          variants.add(`+233${digits.slice(1)}`);
        }
        if (!/^0/.test(digits) && digits.startsWith('233')) {
          variants.add(`0${digits.slice(3)}`);
        }
        or.push({ 'customer.phone': { $in: [...variants] } });
      }
    }
    if (!or.length) return res.status(200).json({ success: true, count: 0, data: [] });

    const orders = await Order.find({ $or: or })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};

const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];

// Forward-only status flow. An order may move to any *later* stage (skips like
// paid → delivered are allowed), or be cancelled while still live. Same-status
// is a no-op. `delivered` and `cancelled` are terminal. This only blocks
// backward moves and changes out of a terminal state.
const STATUS_RANK = { pending: 0, paid: 1, processing: 2, shipped: 3, delivered: 4 };
function canTransition(from, to) {
  if (from === to) return true;                                   // no-op
  if (from === 'delivered' || from === 'cancelled') return false; // terminal
  if (to === 'cancelled') return true;                            // cancel any live order
  return (STATUS_RANK[to] ?? -1) > (STATUS_RANK[from] ?? -1);     // forward only
}

const getOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && ORDER_STATUSES.includes(status)) {
      query.status = status;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const orders = await Order.find(query)
      .populate('deliveryZone')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, count: orders.length, data: orders });
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
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
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
 * PATCH /api/v1/orders/:id/preorder-release — the stock has landed (admin/staff).
 *
 * This is the moment a pre-order becomes a normal line: stock moves, `sold`
 * counts it, and the customer is told. Deliberately manual — stock changes for
 * plenty of reasons (a correction, a return, a POS void) and none of those should
 * ship anything by themselves.
 */
const releasePreorder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
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

    const released = [];
    const short = [];

    for (const item of pending) {
      // The same guarded decrement fulfilment uses, for the same reason: never
      // oversell. If the stock is not actually there yet, this line stays queued
      // rather than being marked released against inventory that does not exist.
      const filter = item.variant?.sku
        ? { _id: item.product, variants: { $elemMatch: { sku: item.variant.sku, stock: { $gte: item.qty } } } }
        : { _id: item.product, stock: { $gte: item.qty } };
      const update = item.variant?.sku
        ? { $inc: { 'variants.$.stock': -item.qty, sold: item.qty } }
        : { $inc: { stock: -item.qty, sold: item.qty } };

      const result = await Product.findOneAndUpdate(filter, update);
      if (!result) {
        short.push(item.name);
        continue;
      }
      item.preorderReleasedAt = new Date();
      released.push(item);
    }

    if (!released.length) {
      return res.status(400).json({
        success: false,
        error: `Not enough stock to release: ${short.join(', ')}.`,
      });
    }

    order.trackingHistory.push({
      status: order.status,
      note: `Pre-order released: ${released.map((i) => i.name).join(', ')}.`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await order.save();

    // Best-effort: a mail failure must not undo a release that already moved stock.
    sendPreorderReadyEmail(order, released).catch(() => {});

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: `Pre-order released for ${order.orderNumber} — ${released.map((i) => i.name).join(', ')}`,
      metadata: { released: released.length, short },
    });

    res.status(200).json({
      success: true,
      data: order,
      // Named so the caller can tell a full release from a partial one.
      meta: { released: released.length, short },
    });
  } catch (error) {
    next(error);
  }
};

const getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('deliveryZone');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.status(200).json({ success: true, data: order });
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

    const order = await Order.findOne({ _id: req.params.id, $or: or }).populate('deliveryZone');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.status(200).json({ success: true, data: order });
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

    const prevStatus = order.status;
    order.status = status;
    if (status === 'paid' && !order.paidAt) {
      order.paidAt = new Date();
    }
    if (status === 'cancelled' && order.stockDeducted && !order.stockRestored) {
      await restockOrderItems(order);
      order.stockRestored = true;
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

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

// T15 — a refund is a payment outcome, not a fulfilment stage: no "refunded"
// value was added to ORDER_STATUSES. Eligibility mirrors canTransition's own
// definition of "live" (pending is excluded too — nothing's been paid yet).
const REFUND_ELIGIBLE_STATUSES = ['paid', 'processing', 'shipped'];

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

module.exports = {
  createOrder,
  getPreorders,
  releasePreorder,
  getMyOrders,
  getMyOrderById,
  getOrderByReference,
  trackOrder,
  getOrderTracking,
  getOrders,
  getOrder,
  updateOrderStatus,
  addTrackingEvent,
  refundOrder,
  syncRefund,
  normalizePhone
};
