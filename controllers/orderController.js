const crypto = require("crypto");
const Paystack = require("@paystack/paystack-sdk");
const Order = require("../models/Order");
const Product = require("../models/Product");
const DeliveryZone = require("../models/DeliveryZone");

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith("sk_")) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn(
    "⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for payments.",
  );
}

const FRONTEND_URL =
  process.env.FRONTEND_URL || process.env.CLIENT_URL || "http://localhost:3000";

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
      return res
        .status(400)
        .json({ success: false, error: "Name and phone are required" });
    }

    const qtyBySlug = {};
    for (const item of items) {
      const slug = typeof item === "string" ? item : item.slug;
      if (!slug) continue;
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      qtyBySlug[slug] = (qtyBySlug[slug] || 0) + qty;
    }
    const slugs = Object.keys(qtyBySlug);
    if (slugs.length === 0) {
      return res.status(400).json({ success: false, error: "Cart is empty" });
    }

    const products = await Product.find({
      slug: { $in: slugs },
      isActive: true,
    });
    if (products.length !== slugs.length) {
      const found = new Set(products.map((p) => p.slug));
      const missing = slugs.filter((s) => !found.has(s));
      return res.status(400).json({
        success: false,
        error: `Some products are no longer available: ${missing.join(", ")}`,
      });
    }

    const orderItems = products.map((product) => ({
      product: product._id,
      name: product.name,
      price: product.price,
      qty: qtyBySlug[product.slug],
    }));

    for (const item of orderItems) {
      const product = products.find(
        (p) => p._id.toString() === item.product.toString(),
      );
      if (item.qty > product.stock) {
        return res.status(400).json({
          success: false,
          error: `${product.name} only has ${product.stock} in stock`,
        });
      }
    }

    const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);

    let deliveryFee = 0;
    let deliveryZone = null;
    if (deliveryZoneId) {
      deliveryZone = await DeliveryZone.findOne({
        _id: deliveryZoneId,
        isActive: true,
      });
      if (!deliveryZone) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid delivery zone" });
      }
      deliveryFee = deliveryZone.fee;
    }

    const total = subtotal + deliveryFee;

    if (!paystack) {
      return res.status(500).json({
        success: false,
        error:
          "Paystack is not configured. Please add PAYSTACK_SECRET to your environment variables.",
      });
    }

    const reference = `ORD_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const email = orderCustomerEmail(customer);

    const transaction = await paystack.transaction.initialize({
      email,
      amount: total,
      currency: "GHS",
      reference,
      channels: ["card", "mobile_money"],
      metadata: {
        type: "shop_order",
      },
      callback_url: `${FRONTEND_URL}/order-confirmation/${reference}`,
    });

    if (!transaction.status) {
      return res
        .status(500)
        .json({ success: false, error: "Failed to initialize payment" });
    }

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      items: orderItems,
      subtotal,
      ...(deliveryZone && { deliveryZone: deliveryZone._id }),
      deliveryFee,
      total,
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: (customer.email || "").trim().toLowerCase(),
        address: (customer.address || "").trim(),
      },
      status: "pending",
      paystackReference: reference,
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
  return `${phone || 'guest'}@eazworld.local`;
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
 * GET /api/v1/orders/by-reference/:reference
 * Public lookup by Paystack reference for the order confirmation page.
 */
const getOrderByReference = async (req, res, next) => {
  try {
    const order = await Order.findOne({ paystackReference: req.params.reference });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];

const getOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && ORDER_STATUSES.includes(status)) {
      query.status = status;
    }
    const orders = await Order.find(query)
      .populate('deliveryZone')
      .sort({ createdAt: -1 });
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

    order.status = status;
    if (status === 'paid' && !order.paidAt) {
      order.paidAt = new Date();
    }
    await order.save();

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getOrderByReference,
  trackOrder,
  getOrders,
  getOrder,
  updateOrderStatus
};
