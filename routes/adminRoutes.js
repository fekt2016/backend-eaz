const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const EmailLog = require('../models/EmailLog');
const Order = require('../models/Order');
const Address = require('../models/Address');
const User = require('../models/User');
const { buildCustomerOrderFilter } = require('../utils/customerOrderMatch');
const { getGhanaCardForReview, reviewGhanaCard, getGhanaCardImageUrl } = require('../controllers/accountController');
const { paginate } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(protect, restrictTo('admin'));

// GET /api/v1/admin/email-logs
// Query params: ?type=&status=&q=email&page=1&limit=50
router.get('/email-logs', async (req, res, next) => {
  try {
    const { type, status, q } = req.query;
    // T87 — clamped: an unbounded limit pulls the whole collection into a 512MB heap.
    const { page, limit, skip } = paginate(req.query);

    const filter = {};
    if (type && type !== 'all') filter.type = type;
    if (status && status !== 'all') filter.status = status;
    // T93 — escape before it reaches the regex engine. Unescaped, an admin could
    // stall the event loop with a catastrophic-backtracking pattern such as
    // `(a+)+$`. Every other $regex site in the codebase already does this; this
    // one was the only exception.
    if (q && q.trim()) filter.to = { $regex: escapeRegex(q.trim()), $options: 'i' };

    const [logs, total] = await Promise.all([
      EmailLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      EmailLog.countDocuments(filter),
    ]);

    // Summary counts (ignoring current filter for the type/status breakdown)
    const [summary] = await EmailLog.aggregate([
      {
        $facet: {
          total:  [{ $count: 'n' }],
          sent:   [{ $match: { status: 'sent' } }, { $count: 'n' }],
          failed: [{ $match: { status: 'failed' } }, { $count: 'n' }],
          today:  [
            { $match: { createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } } },
            { $count: 'n' },
          ],
        },
      },
    ]);

    res.json({
      logs,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      summary: {
        total:  summary?.total?.[0]?.n  ?? 0,
        sent:   summary?.sent?.[0]?.n   ?? 0,
        failed: summary?.failed?.[0]?.n ?? 0,
        today:  summary?.today?.[0]?.n  ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Admin user-detail: a customer's orders ────────────────────────────────
// GET /api/v1/admin/users/:id/orders
//
// Shop orders are guest checkouts with no `user` ref, so they are matched by the
// contact details captured at checkout — the SAME rule getMyOrders uses, shared
// via utils/customerOrderMatch so an admin can never see a different set than
// the customer sees for themselves.
//
// Paginated and lean: this runs on a 512MB heap, and a customer with a long
// history should not be able to pull their whole order list into one response.
router.get('/users/:id/orders', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('email phone').lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const filter = buildCustomerOrderFilter({ email: user.email, phone: user.phone });
    // No contact details to match on means no orders — never an unfiltered find.
    if (!filter) {
      return res.status(200).json({ success: true, data: { orders: [], total: 0, page: 1 } });
    }

    const { page, limit, skip } = paginate(req.query);
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .select('orderNumber status total createdAt items paystackReference')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.status(200).json({ success: true, data: { orders, total, page, limit } });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    next(error);
  }
});

// ── Admin user-detail: a customer's saved addresses ───────────────────────
// GET /api/v1/admin/users/:id/addresses
//
// Deliberately NOT on /api/v1/addresses. That router is the customer's OWN
// address book and now denies every staff-side role, because a personal
// delivery address book has no meaning on a staff account. Reading a CUSTOMER's
// addresses is a different question with a different answer, so it lives here,
// behind this router's protect + restrictTo('admin').
//
// No pagination: addressController caps a customer at MAX_ADDRESSES (3).
router.get('/users/:id/addresses', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('_id').lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const addresses = await Address.find({ user: user._id })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: addresses });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    next(error);
  }
});

// ── Ghana Card review (manual identity verification) ──────────────────────
// Approve or reject a pending submission.
router.get('/users/:id/ghana-card', getGhanaCardForReview);
router.patch('/users/:id/ghana-card', reviewGhanaCard);

// Mint a SHORT-LIVED signed URL for one side of the card. The images are stored
// with Cloudinary `type: 'authenticated'`, so the stored public_id cannot be
// fetched on its own — unlike every other upload in this app, which is
// world-readable to anyone holding the link. Each view is logged.
router.get('/users/:id/ghana-card/image/:side', getGhanaCardImageUrl);

module.exports = router;
