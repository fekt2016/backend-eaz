const crypto = require('crypto');
const Paystack = require('@paystack/paystack-sdk');
const streamifier = require('streamifier');
const HostingOrder = require('../models/HostingOrder');
const { getPlanPrice, HOSTING_PLANS } = require('../config/hostingPlans');
const { cloudinary } = require('../config/cloudinary');
const { sendOrderConfirmation, sendPaymentReceived } = require('../utils/hostingEmail');
const { buildInvoiceBuffer } = require('../utils/hostingInvoice');

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith('sk_')) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn('⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for Card/Mobile Money.');
}

const FRONTEND_URL = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';

function computeAddonsTotal(addons) {
  if (!Array.isArray(addons)) return 0;
  return addons.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
}

/**
 * GET /api/v1/hosting/plans
 * Return plan config (public, no auth).
 */
const getPlans = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: HOSTING_PLANS });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/hosting/orders
 * Create a hosting order and optionally initialize Paystack payment.
 */
const createOrder = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { planType, tier, billingCycle, addons = [], customer, paymentMethod, mobileNumber, network } = req.body;

    if (!planType || !tier || !billingCycle || !customer?.name || !customer?.email) {
      return res.status(400).json({
        success: false,
        error: 'planType, tier, billingCycle, and customer (name, email) are required'
      });
    }

    const { basePrice, discountAmount, total: planTotal } = getPlanPrice(planType, tier, billingCycle);
    if (planTotal == null) {
      return res.status(400).json({ success: false, error: 'Invalid plan or tier' });
    }

    const addonsTotal = computeAddonsTotal(addons);
    const totalAmount = planTotal + addonsTotal;

    const orderPayload = {
      user: userId,
      planType,
      tier,
      billingCycle,
      addons: addons.map(a => ({ id: a.id, name: a.name, price: a.price || 0 })),
      customer: {
        name: customer.name.trim(),
        email: customer.email.trim().toLowerCase(),
        phone: (customer.phone || '').trim(),
        address: (customer.address || '').trim(),
        city: (customer.city || '').trim(),
        country: (customer.country || 'Ghana').trim()
      },
      amount: totalAmount,
      currency: 'GHS',
      status: 'pending',
      paymentMethod: paymentMethod || 'bank_transfer'
    };

    const isPaystack = paymentMethod === 'paystack_card' || paymentMethod === 'mobile_money';

    if (isPaystack && paystack) {
      const reference = `HOST_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const amountInPesewas = Math.round(totalAmount * 100);

      const transaction = await paystack.transaction.initialize({
        email: orderPayload.customer.email,
        amount: amountInPesewas,
        currency: 'GHS',
        reference,
        channels: paymentMethod === 'mobile_money' ? ['mobile_money'] : ['card', 'mobile_money'],
        metadata: {
          type: 'hosting_order',
          planType,
          tier,
          billingCycle: billingCycle
        },
        callback_url: `${FRONTEND_URL}/hosting/order-confirmation`,
        ...(paymentMethod === 'mobile_money' && mobileNumber && { mobile_money: { phone: mobileNumber, provider: network || 'mtn' } })
      });

      if (!transaction.status) {
        return res.status(500).json({
          success: false,
          error: 'Failed to initialize payment'
        });
      }

      orderPayload.paystackReference = reference;
      const order = await HostingOrder.create(orderPayload);
      sendOrderConfirmation(order).catch(() => {});

      return res.status(200).json({
        success: true,
        data: {
          authorizationUrl: transaction.data.authorization_url,
          accessCode: transaction.data.access_code,
          reference: transaction.data.reference,
          orderId: order._id
        }
      });
    }

    // Bank transfer: create order only, no Paystack
    const order = await HostingOrder.create(orderPayload);
    sendOrderConfirmation(order).catch(() => {});
    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders
 * List orders for the current user (or all for admin).
 */
const getOrders = async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const filter = isAdmin ? {} : { user: req.user._id };
    const orders = await HostingOrder.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders/by-reference/:reference
 * Get order by Paystack reference (owner only). For payment callback page.
 */
const getOrderByReference = async (req, res, next) => {
  try {
    const order = await HostingOrder.findOne({
      paystackReference: req.params.reference,
      user: req.user._id
    }).lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    return res.status(200).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders/:id
 * Get one order (owner or admin).
 */
const getOrder = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const isOwner = order.user && order.user.toString() === req.user._id.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not allowed to view this order' });
    }
    return res.status(200).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders/:id/invoice
 * Download invoice PDF (owner or admin).
 */
const getInvoice = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const isOwner = order.user && order.user.toString() === req.user._id.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not allowed to view this order' });
    }
    const buffer = await buildInvoiceBuffer(order);
    const filename = `invoice-${String(order._id).slice(-8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/hosting/orders/:id/proof
 * Upload bank transfer proof (order owner only, bank_transfer + pending).
 */
const uploadOrderProof = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not allowed to update this order' });
    }
    if (order.paymentMethod !== 'bank_transfer' || order.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending bank transfer orders can have proof uploaded' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No file provided. Upload an image or PDF (max 5MB).' });
    }
    const uploadPromise = new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'eazworld/hosting-proofs', resource_type: 'auto' },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });
    const result = await uploadPromise;
    order.proofUploadUrl = result.secure_url;
    order.proofUploadedAt = new Date();
    await order.save();
    return res.status(200).json({ success: true, data: { proofUploadUrl: order.proofUploadUrl } });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/hosting/orders/:id
 * Update order status (admin only). Used to mark bank transfer orders as paid.
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const { status } = req.body;
    const allowed = ['pending', 'paid', 'active', 'cancelled', 'failed'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status required: ' + allowed.join(', ') });
    }
    order.status = status;
    if (status === 'paid' && order.paymentMethod === 'bank_transfer') {
      order.bankTransferVerifiedAt = new Date();
      if (!order.paidAt) order.paidAt = new Date();
    }
    await order.save();
    if (status === 'paid') {
      sendPaymentReceived(order).catch(() => {});
    }
    return res.status(200).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPlans,
  createOrder,
  getOrders,
  getOrder,
  getOrderByReference,
  getInvoice,
  updateOrderStatus,
  uploadOrderProof
};
