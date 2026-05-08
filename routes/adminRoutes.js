const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const EmailLog = require('../models/EmailLog');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(protect, restrictTo('admin'));

// GET /api/v1/admin/email-logs
// Query params: ?type=&status=&q=email&page=1&limit=50
router.get('/email-logs', async (req, res) => {
  try {
    const { type, status, q, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (type && type !== 'all') filter.type = type;
    if (status && status !== 'all') filter.status = status;
    if (q && q.trim()) filter.to = { $regex: q.trim(), $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      EmailLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
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
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
