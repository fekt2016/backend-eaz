/**
 * What a customer may see and do with their own order and the live account
 * behind it — their list, one order, its invoice, cPanel access, service
 * status and the hosting password.
 *
 * Split out of controllers/hostingOrderController.js, which re-exports these
 * so the route file is unchanged. Moved verbatim.
 */
const {
  mongoose, Paystack, HostingOrder, buildInvoiceBuffer, escapeRegex, whm,
} = require("./common");


/**
 * GET /api/v1/hosting/orders
 * List orders for the current user (or all for admin).
 * Admin-only: optional `q` (search), `limit` (default 200, max 500).
 */
const getOrders = async (req, res, next) => {
  try {
    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
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
    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
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
    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
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
    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
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
    if (!isOwner && !['admin', 'superadmin'].includes(req.user?.role)) {
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
    if (!isOwner && !['admin', 'superadmin'].includes(req.user?.role)) {
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

module.exports = {
  getOrders,
  getOrderByReference,
  getOrder,
  getInvoice,
  getCpanelLoginUrl,
  getServiceStatus,
  changeHostingPassword,
};
