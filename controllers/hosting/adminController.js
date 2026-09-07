/**
 * Admin and staff: the overviews, status transitions, the provisioning queue,
 * lifecycle actions, and creating an account on a customer's behalf.
 *
 * Split out of controllers/hostingOrderController.js, which re-exports these
 * so the route file is unchanged. Moved verbatim.
 */
const {
  crypto, Paystack, HostingOrder, sanitizeName, sanitizeEmail,
  sanitizePhone, sanitizeText, sanitizeDomain, getPlanPrice, namecheap,
  sendOrderConfirmation, sendPaymentReceived, sendHostingCredentials,
  provisionHostingAccount, extractTLD, whm, logFromRequest, ACTIONS,
  RESOURCES, paystack, FRONTEND_URL, computeAddonsTotal,
} = require("./common");


/**
 * GET /api/v1/hosting/orders/admin-overview
 * Full overview for admin home: revenue, orders, users, domains (admin only).
 */
const getAdminOverview = async (req, res, next) => {
  try {
    const User = require('../../models/User');
    const DomainOrder = require('../../models/DomainOrder');

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
    const User = require('../../models/User');
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
    // getPricing() keys are dot-prefixed (e.g. ".com") and already in GHS
    // (rate + markup applied) — see services/namecheap.js's usdToGhs.
    let domainFee = 0;
    if (domainMode === 'new' && domain_s) {
      try {
        const tld = extractTLD(domain_s);
        const prices = await namecheap.getPricing();
        const priceGHS = prices[tld] ?? null;
        if (priceGHS != null) {
          const years = Math.min(10, Math.max(1, Number(domainRegistrationYears) || 1));
          domainFee = Math.round(priceGHS * years * 100) / 100;
        }
      } catch { /* Namecheap unavailable — no domain fee added */ }
    }
    const totalAmount = price.total + addonsTotal + domainFee;
    const totalAmountPesewas = Math.round(totalAmount * 100);

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
      amountPesewas: totalAmountPesewas,
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
        amount: totalAmountPesewas,
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


// ─── T68 — manual provisioning queue ─────────────────────────────────────────
// VPS / Cloud / Email orders auto-provision nothing (provisionHostingAccount
// marks them 'skipped' — VPS/Cloud/Email plans have no provisioning API),
// so a customer could pay GH₵950/month and hear silence. These two endpoints
// are the chase: a list of what's owed, and the moment staff say it's built.

/**
 * GET /api/v1/hosting/orders/awaiting-provisioning — the build queue (admin/staff).
 *
 * Paid orders whose plan cannot self-provision sit at provisioningStatus 'skipped'
 * forever. Oldest first, because that customer has been waiting longest. Unpaid
 * orders are excluded, same reasoning as the pre-order queue: nobody builds a
 * server for money that has not landed.
 *
 * 'failed' belongs here too, and its absence was a real hole: a paid order whose
 * WHM build errored — a missing package, an unreachable host, a transient 500 —
 * was counted in the admin overview (`getAdminOverview`) and listed NOWHERE. The
 * count told an admin something was wrong without giving them a single row to act
 * on, so the customer waited unseen. Both states mean the same thing operationally:
 * money has landed and no server exists yet. `provisioningError` distinguishes them
 * for whoever picks the order up.
 */
const getAwaitingProvisioning = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const orders = await HostingOrder.find({
      status: 'paid',
      provisioningStatus: { $in: ['skipped', 'failed'] },
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
 * PATCH /api/v1/hosting/orders/:id/mark-provisioned — the server was built by
 * hand in Starlight Manager (admin/staff).
 *
 * Staff paste the username/password they created; the order goes active with its
 * expiry stamped by billing cycle, and the same credentials email that
 * auto-provisioned accounts receive is sent. Idempotent: marking an order that is
 * already active is a calm no-op that does not re-email. The password goes
 * straight to the email and is never stored — the schema deliberately has no
 * field for it.
 */
const markProvisioned = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // A second click, or a retry after a network blip, after the account already
    // went active must change nothing and must not send a second email.
    if (order.status === 'active' && order.provisioningStatus === 'provisioned') {
      return res.status(200).json({ success: true, data: order, meta: { alreadyProvisioned: true } });
    }

    // Money first, like the pre-order release: nothing is built until payment landed.
    if (order.status !== 'paid') {
      return res.status(400).json({
        success: false,
        error: 'Only a paid order can be marked provisioned.',
      });
    }

    const username = sanitizeText(req.body.username, 64)?.trim();
    const password = typeof req.body.password === 'string' ? req.body.password.trim() : '';
    const domain = sanitizeDomain(req.body.domain) || null;

    if (!username || username.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'The account username from Starlight Manager is required (min 3 characters).',
      });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'The account password is required (min 8 characters).',
      });
    }

    const prevStatus = order.status;
    order.cpanelUsername = username;
    order.provisioningStatus = 'provisioned';
    order.provisionedAt = new Date();
    order.provisioningError = null;
    order.status = 'active';

    // Same expiry rule the auto-provisioner applies: a month, or a year on annual.
    const expiresAt = new Date();
    if (order.billingCycle === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }
    order.expiresAt = expiresAt;

    await order.save({ validateBeforeSave: false });

    // Best-effort: a mail failure must not undo a provisioning that already happened.
    sendHostingCredentials(order, {
      username,
      password,
      domain: domain || order.domain || `${username}.eazworld.com`,
    }).catch(() => {});

    await logFromRequest(req, {
      action: ACTIONS.ORDER_STATUS_CHANGED,
      resourceType: RESOURCES.ORDER,
      resourceId: order._id,
      resourceName: order.domain || `Hosting order ${order._id}`,
      description: `Hosting order ${order._id} manually provisioned (${order.planType} ${order.tier})`,
      changes: [{ field: 'status', label: 'Hosting Status', before: prevStatus, after: 'active' }],
      metadata: { type: 'hosting', cpanelUsername: username },
    });

    res.status(200).json({ success: true, data: order, meta: { alreadyProvisioned: false } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminOverview,
  getHostingOrdersAdminSummary,
  updateOrderStatus,
  deleteOrder,
  staffCreateHostingAccount,
  getAwaitingProvisioning,
  markProvisioned,
  // adminLifecycleAction is a factory; the routes want the three it produces.
  suspendService: adminLifecycleAction('suspend'),
  unsuspendService: adminLifecycleAction('unsuspend'),
  terminateService: adminLifecycleAction('terminate'),
};
