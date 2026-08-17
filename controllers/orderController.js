const crypto = require("crypto");
const Paystack = require("@paystack/paystack-sdk");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Part = require("../models/Part");
const DeliveryZone = require("../models/DeliveryZone");
const { fulfilShopOrder } = require("../utils/fulfilShopOrder");

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

function generateTrackingNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `EZWTRK-${ts}${rand}`;
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
        if (variant.stock < qty) {
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
      }

      if (product.stock < qty && !variantInfo) {
        return res.status(400).json({ success: false, error: `${product.name} only has ${product.stock} in stock.` });
      }
      orderItems.push({
        product: product._id,
        name: product.name,
        ...(variantInfo && { variant: variantInfo }),
        price: product.price,
        qty,
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

function orderCustomerEmail(customer) {
  const email = (customer.email || '').trim().toLowerCase();
  if (email) return email;
  const phone = (customer.phone || '').trim().replace(/\s+/g, '');
  return `${phone || 'guest'}@eazworld.com`;
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.startsWith('233')) digits = `0${digits.slice(3)}`;
  return digits;
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
      .lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Tracking number not found' });
    }

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

    order.status = status;
    if (status === 'paid' && !order.paidAt) {
      order.paidAt = new Date();
    }
    order.trackingHistory.push({
      status,
      note: `Status updated to ${status}.`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await order.save();

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

    if (status) {
      order.status = status;
      if (status === 'paid' && !order.paidAt) {
        order.paidAt = new Date();
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

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getMyOrderById,
  getOrderByReference,
  trackOrder,
  getOrderTracking,
  getOrders,
  getOrder,
  updateOrderStatus,
  addTrackingEvent
};
