const crypto = require('crypto');
const mongoose = require('mongoose');
const Paystack = require('@paystack/paystack-sdk');
const streamifier = require('streamifier');
const HostingOrder = require('../models/HostingOrder');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, sanitizeDomain } = require('../utils/sanitize');
const { getPlanPrice, HOSTING_PLANS } = require('../config/hostingPlans');
const namecheap = require('../services/namecheap');
const { cloudinary } = require('../config/cloudinary');
const { sendOrderConfirmation, sendPaymentReceived } = require('../utils/hostingEmail');
const { provisionHostingAccount } = require('../utils/provisionHosting');
const { buildInvoiceBuffer } = require('../utils/hostingInvoice');
const { escapeRegex } = require('../utils/regex');
const whm = require('../services/whm');
const { logFromRequest, ACTIONS, RESOURCES } = require('../services/activityLogService');

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith('sk_')) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn('⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for Card/Mobile Money.');
}

const FRONTEND_URL = require("../utils/frontendUrl")();

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

    const {
      planType, tier, billingCycle, addons = [], customer,
      paymentMethod, mobileNumber, network,
      domainMode = 'skip', domainRegistrationFee = 0, domainRegistrationYears = 1
    } = req.body;

    // Sanitize customer fields
    const customerName    = sanitizeName(customer?.name);
    const customerEmail   = sanitizeEmail(customer?.email);
    const customerPhone   = sanitizePhone(customer?.phone);
    const customerAddress = sanitizeText(customer?.address, 200);
    const customerCity    = sanitizeText(customer?.city, 100);
    const mobileNumber_s  = sanitizePhone(mobileNumber);
    const domain_s        = sanitizeDomain(req.body.domain);

    if (!planType || !tier || !billingCycle || !customerName || !customerEmail) {
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

    // Re-compute domain fee server-side — never trust client-supplied price
    let domainFee = 0;
    if (domainMode === 'new' && domain_s) {
      try {
        const tld = domain_s.split('.').slice(1).join('.');
        const prices = await namecheap.getPricing();
        const priceUSD = prices[tld] ?? null;
        if (priceUSD != null) {
          const usdRate = parseFloat(process.env.USD_TO_GHS_RATE) || 15.5;
          const markup  = parseFloat(process.env.DOMAIN_MARKUP)   || 1.2;
          const years   = Math.min(10, Math.max(1, Number(domainRegistrationYears) || 1));
          domainFee = Math.round(priceUSD * usdRate * markup * years * 100) / 100;
        } else {
          // Unknown TLD — use client value with sanity cap (≤ GHS 500)
          domainFee = Math.min(Number(domainRegistrationFee) || 0, 500);
        }
      } catch {
        // Namecheap unavailable — fall back to client value with sanity cap
        domainFee = Math.min(Number(domainRegistrationFee) || 0, 500);
      }
    }

    const totalAmount = planTotal + addonsTotal + domainFee;

    const cleanDomain = domain_s || null;

    const orderPayload = {
      user: userId,
      planType,
      tier,
      billingCycle,
      addons: addons.map(a => ({ id: a.id, name: a.name, price: a.price || 0 })),
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone || '',
        address: customerAddress || '',
        city: customerCity || '',
        country: (customer?.country || 'Ghana').trim()
      },
      amount: totalAmount,
      currency: 'GHS',
      status: 'pending',
      provisioningStatus: 'not_started',
      provisioningStartedAt: null,
      paymentMethod: paymentMethod || 'bank_transfer',
      ...(cleanDomain && { domain: cleanDomain }),
      domainMode: ['new', 'own', 'skip'].includes(domainMode) ? domainMode : 'skip',
      ...(domainMode === 'new' && cleanDomain && {
        domainRegistrationFee: domainFee,
        domainRegistrationYears: Math.min(10, Math.max(1, Number(domainRegistrationYears) || 1)),
        domainRegistered: false,
      }),
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
        ...(paymentMethod === 'mobile_money' && mobileNumber_s && { mobile_money: { phone: mobileNumber_s, provider: network || 'mtn' } })
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
 * Admin-only: optional `q` (search), `limit` (default 200, max 500).
 */
const getOrders = async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const filter = isAdmin ? {} : { user: req.user._id };
    if (req.query?.status) {
      filter.status = req.query.status;
    }
    if (isAdmin && typeof req.query?.q === 'string' && req.query.q.trim()) {
      const qraw = req.query.q.trim().slice(0, 200);
      const rx = new RegExp(escapeRegex(qraw), 'i');
      const or = [
        { 'customer.email': rx },
        { 'customer.name': rx },
        { domain: rx },
        { cpanelUsername: rx },
        { paystackReference: rx }
      ];
      if (mongoose.Types.ObjectId.isValid(qraw) && String(new mongoose.Types.ObjectId(qraw)) === qraw) {
        or.unshift({ _id: qraw });
      }
      filter.$or = or;
    }

    let q = HostingOrder.find(filter).sort({ createdAt: -1 });
    if (isAdmin) {
      const n = parseInt(req.query?.limit, 10);
      const lim = Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 200;
      q = q.limit(lim);
    }
    const orders = await q.lean();
    return res.status(200).json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders/admin-overview
 * Full overview for admin home: revenue, orders, users, domains (admin only).
 */
const getAdminOverview = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const DomainOrder = require('../models/DomainOrder');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      // Hosting
      hostingTotal,
      hostingActive,
      hostingPending,
      hostingThisMonth,
      hostingLastMonth,
      revenueAgg,
      revenueThisMonthAgg,
      revenueLastMonthAgg,
      expiringIn7Days,
      // Domains
      domainTotal,
      domainThisMonth,
      domainRevenueAgg,
      // Users
      userTotal,
      userThisMonth,
    ] = await Promise.all([
      HostingOrder.countDocuments({}),
      HostingOrder.countDocuments({ status: 'active' }),
      HostingOrder.countDocuments({ status: 'pending' }),
      HostingOrder.countDocuments({ createdAt: { $gte: startOfMonth } }),
      HostingOrder.countDocuments({ createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } }),
      HostingOrder.aggregate([{ $match: { status: { $in: ['paid', 'active'] } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      HostingOrder.aggregate([{ $match: { status: { $in: ['paid', 'active'] }, paidAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      HostingOrder.aggregate([{ $match: { status: { $in: ['paid', 'active'] }, paidAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      HostingOrder.countDocuments({ status: 'active', expiresAt: { $gt: now, $lt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } }),
      DomainOrder.countDocuments({}),
      DomainOrder.countDocuments({ createdAt: { $gte: startOfMonth } }),
      DomainOrder.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$price' } } }]),
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: startOfMonth } }),
    ]);

    const hostingRevenue = revenueAgg[0]?.total || 0;
    const hostingRevenueThisMonth = revenueThisMonthAgg[0]?.total || 0;
    const hostingRevenueLastMonth = revenueLastMonthAgg[0]?.total || 0;
    const domainRevenue = domainRevenueAgg[0]?.total || 0;
    const totalRevenue = hostingRevenue + domainRevenue;
    const revenueGrowth = hostingRevenueLastMonth > 0
      ? Math.round(((hostingRevenueThisMonth - hostingRevenueLastMonth) / hostingRevenueLastMonth) * 100)
      : null;

    // Recent 5 hosting orders
    const recentHostingOrders = await HostingOrder.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // Recent 5 domain orders
    const recentDomainOrders = await DomainOrder.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        revenue: {
          total: totalRevenue,
          hosting: hostingRevenue,
          domains: domainRevenue,
          thisMonth: hostingRevenueThisMonth,
          lastMonth: hostingRevenueLastMonth,
          growth: revenueGrowth,
        },
        hosting: {
          total: hostingTotal,
          active: hostingActive,
          pending: hostingPending,
          thisMonth: hostingThisMonth,
          lastMonth: hostingLastMonth,
          expiringIn7Days,
        },
        domains: {
          total: domainTotal,
          thisMonth: domainThisMonth,
        },
        users: {
          total: userTotal,
          thisMonth: userThisMonth,
        },
        recentHostingOrders,
        recentDomainOrders,
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders/admin-summary
 * Lightweight counts for the admin dashboard (admin only).
 */
const getHostingOrdersAdminSummary = async (req, res, next) => {
  try {
    const [
      total,
      byStatusAgg,
      provisioningFailed,
      pendingBankWithProof,
      paidProvisioningSkipped,
      stuckProvisioning
    ] = await Promise.all([
      HostingOrder.countDocuments({}),
      HostingOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      HostingOrder.countDocuments({ status: 'paid', provisioningStatus: 'failed' }),
      HostingOrder.countDocuments({
        status: 'pending',
        paymentMethod: 'bank_transfer',
        proofUploadUrl: { $nin: [null, ''] }
      }),
      HostingOrder.countDocuments({ status: 'paid', provisioningStatus: 'skipped' }),
      HostingOrder.countDocuments({
        status: 'paid',
        provisioningStatus: 'pending'
      })
    ]);

    const byStatus = Object.fromEntries(byStatusAgg.map((x) => [x._id, x.count]));

    return res.status(200).json({
      success: true,
      data: {
        total,
        pending: byStatus.pending || 0,
        paid: byStatus.paid || 0,
        active: byStatus.active || 0,
        cancelled: byStatus.cancelled || 0,
        failed: byStatus.failed || 0,
        provisioningFailed,
        pendingBankTransfersWithProof: pendingBankWithProof,
        paidProvisioningSkippedNeedsManualFulfillment: paidProvisioningSkipped,
        paidProvisioningInProgress: stuckProvisioning
      }
    });
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
    const allowed = ['pending', 'paid', 'cancelled', 'failed'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status required: ' + allowed.join(', ') });
    }

    const prevStatus = order.status;

    // Active orders are fulfilled; do not allow reverting to paid/pending (avoids accidental re-provisioning states).
    if (prevStatus === 'active') {
      if (!['cancelled', 'failed'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Active hosting orders can only be moved to cancelled or failed'
        });
      }
    }

    order.status = status;

    if (status === 'paid') {
      if (!order.paidAt) order.paidAt = new Date();

      if (order.paymentMethod === 'bank_transfer') {
        order.bankTransferVerifiedAt = new Date();
      }

      // Queue provisioning if not already fulfilled.
      if (prevStatus !== 'active' && order.provisioningStatus !== 'provisioned') {
        order.provisioningStatus = 'pending';
        order.provisioningError = null;
      }
    }

    await order.save({ validateBeforeSave: false });

    if (prevStatus !== status) {
      await logFromRequest(req, {
        action: ACTIONS.ORDER_STATUS_CHANGED,
        resourceType: RESOURCES.ORDER,
        resourceId: order._id,
        resourceName: order.domain || `Hosting order ${order._id}`,
        description: `Hosting order ${order._id} status changed ${prevStatus} → ${status}`,
        changes: [{ field: 'status', label: 'Hosting Status', before: prevStatus, after: status }],
        metadata: { type: 'hosting' },
      });
    }

    if (status === 'paid') {
      // Only send the "payment received" email the first time we transition into paid.
      if (prevStatus !== 'paid' && prevStatus !== 'active') {
        sendPaymentReceived(order).catch(() => {});
      }
      provisionHostingAccount(order).catch(() => {});
    }

    return res.status(200).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders/:id/cpanel-login
 * Generate an SSO URL for cPanel (owner or admin).
 */
const getCpanelLoginUrl = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const isOwner = order.user && order.user.toString() === req.user._id.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }

    if (order.status !== 'active' || !order.cpanelUsername) {
      return res.status(400).json({ success: false, error: 'Hosting is not active yet' });
    }

    const session = await whm.createSession(order.cpanelUsername);
    if (!session.success) {
      return res.status(500).json({ success: false, error: session.error });
    }

    return res.status(200).json({ success: true, data: { url: session.url } });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/hosting/orders/:id/renew
 * Create a renewal payment for an existing hosting order (owner only).
 * On payment success the webhook extends expiresAt on the parent order.
 */
const renewOrder = async (req, res, next) => {
  try {
    const original = await HostingOrder.findById(req.params.id);
    if (!original) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (original.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    if (!['active', 'cancelled'].includes(original.status)) {
      return res.status(400).json({ success: false, error: 'Only active or expired orders can be renewed' });
    }

    const { paymentMethod, mobileNumber, network } = req.body;
    if (!paymentMethod) {
      return res.status(400).json({ success: false, error: 'paymentMethod is required' });
    }

    // Price is the same plan — no domain fee on renewal
    const { total: planTotal } = getPlanPrice(original.planType, original.tier, original.billingCycle);
    if (planTotal == null) {
      return res.status(400).json({ success: false, error: 'Could not determine renewal price' });
    }

    const renewalPayload = {
      user: original.user,
      planType: original.planType,
      tier: original.tier,
      billingCycle: original.billingCycle,
      addons: original.addons || [],
      customer: original.customer,
      amount: planTotal,
      currency: 'GHS',
      status: 'pending',
      provisioningStatus: 'not_started',
      paymentMethod,
      domain: original.domain || null,
      domainMode: 'skip', // domain already set up, no re-registration
      parentOrderId: original._id,
    };

    const isPaystack = paymentMethod === 'paystack_card' || paymentMethod === 'mobile_money';

    if (isPaystack && paystack) {
      const reference = `RENEW_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const amountInPesewas = Math.round(planTotal * 100);

      const transaction = await paystack.transaction.initialize({
        email: original.customer.email,
        amount: amountInPesewas,
        currency: 'GHS',
        reference,
        channels: paymentMethod === 'mobile_money' ? ['mobile_money'] : ['card', 'mobile_money'],
        metadata: {
          type: 'hosting_renewal',
          planType: original.planType,
          tier: original.tier,
          billingCycle: original.billingCycle,
          parentOrderId: String(original._id),
        },
        callback_url: `${FRONTEND_URL}/hosting/order-confirmation`,
        ...(paymentMethod === 'mobile_money' && mobileNumber && { mobile_money: { phone: mobileNumber, provider: network || 'mtn' } })
      });

      if (!transaction.status) {
        return res.status(500).json({ success: false, error: 'Failed to initialize renewal payment' });
      }

      renewalPayload.paystackReference = reference;
      const renewalOrder = await HostingOrder.create(renewalPayload);

      return res.status(200).json({
        success: true,
        data: {
          authorizationUrl: transaction.data.authorization_url,
          accessCode: transaction.data.access_code,
          reference: transaction.data.reference,
          orderId: renewalOrder._id,
          renewalAmount: planTotal,
        }
      });
    }

    // Bank transfer renewal
    const renewalOrder = await HostingOrder.create(renewalPayload);
    return res.status(200).json({
      success: true,
      data: {
        orderId: renewalOrder._id,
        renewalAmount: planTotal,
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/hosting/orders/:id
 * Delete a hosting order (admin only).
 */
const deleteOrder = async (req, res, next) => {
  try {
    const order = await HostingOrder.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order._id,
      resourceName: order.domain || `Hosting order ${order._id}`,
      description: `Deleted hosting order ${order._id}${order.domain ? ` (${order.domain})` : ''}`,
      metadata: { type: 'hosting', deleted: true, amount: order.amount },
    });
    return res.status(200).json({ success: true, message: 'Order deleted from system' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/hosting/orders/:id/status
 * Live cPanel account status from WHM (owner or admin).
 */
const getServiceStatus = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const isOwner = order.user && order.user.toString() === req.user._id.toString();
    if (!isOwner && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    if (!order.cpanelUsername) {
      return res.status(200).json({ success: true, data: { provisioned: false, status: order.status } });
    }
    const live = await whm.getAccountStatus(order.cpanelUsername);
    if (!live.success) {
      // Don't leak raw WHM errors — return the stored status instead.
      return res.status(200).json({ success: true, data: { provisioned: true, status: order.status, live: null } });
    }
    return res.status(200).json({
      success: true,
      data: {
        provisioned: true,
        status: order.status,
        suspended: live.suspended,
        domain: live.domain,
        ip: live.ip,
        diskUsed: live.diskUsed,
        diskLimit: live.diskLimit,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/hosting/orders/:id/password
 * Reset the cPanel password (owner or admin). Returns the new password ONCE to
 * the authorized caller; it is never logged.
 */
const changeHostingPassword = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const isOwner = order.user && order.user.toString() === req.user._id.toString();
    if (!isOwner && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    if (order.status !== 'active' || !order.cpanelUsername) {
      return res.status(400).json({ success: false, error: 'Hosting is not active' });
    }
    const newPassword = whm.generatePassword();
    const result = await whm.changePassword(order.cpanelUsername, newPassword);
    if (!result.success) {
      return res.status(502).json({ success: false, error: 'Could not update the hosting password. Please try again later.' });
    }
    return res.status(200).json({
      success: true,
      data: { username: order.cpanelUsername, password: newPassword },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin lifecycle action helper: suspend | unsuspend | terminate (admin only).
 */
function adminLifecycleAction(action) {
  return async (req, res, next) => {
    try {
      const order = await HostingOrder.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }
      if (!order.cpanelUsername) {
        return res.status(400).json({ success: false, error: 'No provisioned cPanel account for this order' });
      }
      if (!whm.hasConfig()) {
        return res.status(503).json({ success: false, error: 'Hosting server is not configured' });
      }

      let result;
      if (action === 'suspend') {
        result = await whm.suspendAccount(order.cpanelUsername, req.body?.reason || 'Suspended by admin');
        if (result.success) { order.status = 'suspended'; order.suspendedAt = new Date(); }
      } else if (action === 'unsuspend') {
        result = await whm.unsuspendAccount(order.cpanelUsername);
        if (result.success) { order.status = 'active'; order.suspendedAt = null; }
      } else if (action === 'terminate') {
        if (req.body?.confirm !== true) {
          return res.status(400).json({ success: false, error: 'Termination requires { "confirm": true }' });
        }
        result = await whm.terminateAccount(order.cpanelUsername);
        if (result.success) { order.status = 'terminated'; order.terminatedAt = new Date(); }
      }

      if (!result || !result.success) {
        return res.status(502).json({ success: false, error: `Hosting ${action} failed. Please try again.` });
      }
      await order.save({ validateBeforeSave: false });
      return res.status(200).json({ success: true, data: order });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * POST /api/v1/hosting/orders/staff-create   (staff / admin)
 * Create a cPanel hosting account for a customer in-store.
 *   - paymentMethod 'cash'  → order marked paid + provisioned immediately via WHM.
 *   - paymentMethod 'paystack_card' | 'mobile_money' → payment initialized; the
 *     Paystack webhook provisions once the charge succeeds (same path as online orders).
 * The customer's cPanel username/password are auto-generated and emailed on success.
 */
const staffCreateHostingAccount = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const {
      planType, tier, billingCycle, addons = [], customer,
      paymentMethod = 'cash', mobileNumber, network,
      domainMode = 'skip', domain, domainRegistrationYears = 1,
    } = req.body;

    const method = ['cash', 'paystack_card', 'mobile_money'].includes(paymentMethod) ? paymentMethod : null;
    if (!method) {
      return res.status(400).json({ success: false, error: "paymentMethod must be 'cash', 'paystack_card', or 'mobile_money'." });
    }

    const customerName  = sanitizeName(customer?.name);
    const customerEmail = sanitizeEmail(customer?.email);
    const customerPhone = sanitizePhone(customer?.phone);
    const domain_s      = sanitizeDomain(domain);

    if (!planType || !tier || !billingCycle || !customerName || !customerEmail) {
      return res.status(400).json({ success: false, error: 'planType, tier, billingCycle, and customer (name, email) are required' });
    }

    const price = getPlanPrice(planType, tier, billingCycle);
    if (!price || price.total == null) {
      return res.status(400).json({ success: false, error: 'Invalid plan or tier' });
    }
    const addonsTotal = computeAddonsTotal(addons);

    // Domain fee (register-new mode) — recomputed server-side, never trusted from the client.
    let domainFee = 0;
    if (domainMode === 'new' && domain_s) {
      try {
        const tld = domain_s.split('.').slice(1).join('.');
        const prices = await namecheap.getPricing();
        const priceUSD = prices[tld] ?? null;
        if (priceUSD != null) {
          const usdRate = parseFloat(process.env.USD_TO_GHS_RATE) || 15.5;
          const markup  = parseFloat(process.env.DOMAIN_MARKUP)   || 1.2;
          const years   = Math.min(10, Math.max(1, Number(domainRegistrationYears) || 1));
          domainFee = Math.round(priceUSD * usdRate * markup * years * 100) / 100;
        }
      } catch { /* Namecheap unavailable — no domain fee added */ }
    }
    const totalAmount = price.total + addonsTotal + domainFee;

    // Find-or-create the customer's user account so the order shows in their dashboard.
    let customerUser = await User.findOne({ email: customerEmail });
    if (!customerUser) {
      customerUser = await User.create({
        name: customerName,
        email: customerEmail,
        ...(customerPhone && { phone: customerPhone }),
        password: whm.generatePassword(),
        role: 'user',
      });
    }

    const orderPayload = {
      user: customerUser._id,
      createdByStaff: req.user._id,
      planType, tier, billingCycle,
      addons: addons.map(a => ({ id: a.id, name: a.name, price: a.price || 0 })),
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone || '',
        country: (customer?.country || 'Ghana').trim(),
      },
      amount: totalAmount,
      currency: 'GHS',
      status: 'pending',
      provisioningStatus: 'not_started',
      paymentMethod: method,
      ...(domain_s && { domain: domain_s }),
      domainMode: ['new', 'own', 'skip'].includes(domainMode) ? domainMode : 'skip',
      ...(domainMode === 'new' && domain_s && {
        domainRegistrationFee: domainFee,
        domainRegistrationYears: Math.min(10, Math.max(1, Number(domainRegistrationYears) || 1)),
        domainRegistered: false,
      }),
    };

    // ── Paystack: create the order, initialize payment, let the webhook provision ──
    if (method === 'paystack_card' || method === 'mobile_money') {
      if (!paystack) {
        return res.status(503).json({ success: false, error: 'Paystack is not configured.' });
      }
      const reference = `HOST_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const mobile_s = sanitizePhone(mobileNumber);
      const transaction = await paystack.transaction.initialize({
        email: customerEmail,
        amount: Math.round(totalAmount * 100),
        currency: 'GHS',
        reference,
        channels: method === 'mobile_money' ? ['mobile_money'] : ['card', 'mobile_money'],
        metadata: { type: 'hosting_order', planType, tier, billingCycle, staffCreated: true },
        callback_url: `${FRONTEND_URL}/hosting/order-confirmation`,
        ...(method === 'mobile_money' && mobile_s && { mobile_money: { phone: mobile_s, provider: network || 'mtn' } }),
      });
      if (!transaction.status) {
        return res.status(502).json({ success: false, error: 'Failed to initialize payment' });
      }
      orderPayload.paystackReference = reference;
      const order = await HostingOrder.create(orderPayload);
      sendOrderConfirmation(order).catch(() => {});
      await logFromRequest(req, {
        action: ACTIONS.ORDER_CREATED,
        resourceType: RESOURCES.ORDER,
        resourceId: order._id,
        resourceName: order.domain || `Hosting order ${order._id}`,
        description: `Staff created hosting order ${order._id} for ${customerEmail} (Paystack, pending payment)`,
        metadata: { type: 'hosting', staffCreated: true, paymentMethod: method },
      }).catch(() => {});
      return res.status(200).json({
        success: true,
        data: {
          orderId: order._id,
          paymentMethod: method,
          authorizationUrl: transaction.data.authorization_url,
          reference,
        },
      });
    }

    // ── Cash: mark paid and provision immediately ──
    orderPayload.status = 'paid';
    orderPayload.paidAt = new Date();
    const order = await HostingOrder.create(orderPayload);
    await provisionHostingAccount(order); // awaited so we can report the outcome to staff
    const fresh = await HostingOrder.findById(order._id);
    sendOrderConfirmation(order).catch(() => {});
    await logFromRequest(req, {
      action: ACTIONS.ORDER_CREATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order._id,
      resourceName: fresh.domain || `Hosting order ${order._id}`,
      description: `Staff created + cash-provisioned hosting order ${order._id} for ${customerEmail} (${fresh.provisioningStatus})`,
      metadata: { type: 'hosting', staffCreated: true, paymentMethod: 'cash' },
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      data: {
        orderId: fresh._id,
        status: fresh.status,
        provisioningStatus: fresh.provisioningStatus,
        provisioningError: fresh.provisioningError || null,
        cpanelUsername: fresh.cpanelUsername || null,
        domain: fresh.domain || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPlans,
  createOrder,
  staffCreateHostingAccount,
  getOrders,
  getAdminOverview,
  getHostingOrdersAdminSummary,
  getOrder,
  getOrderByReference,
  getInvoice,
  updateOrderStatus,
  uploadOrderProof,
  getCpanelLoginUrl,
  renewOrder,
  deleteOrder,
  getServiceStatus,
  changeHostingPassword,
  suspendService: adminLifecycleAction('suspend'),
  unsuspendService: adminLifecycleAction('unsuspend'),
  terminateService: adminLifecycleAction('terminate'),
};
