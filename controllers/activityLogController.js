const ActivityLog = require('../models/ActivityLog');
// escapeRegex: match user-supplied search text literally (prevents ReDoS /
// unintended metacharacter matching).
const { escapeRegex } = require('../utils/regex');

// Parse a YYYY-MM-DD date as UTC boundaries (Ghana is UTC+0, so a calendar day
// in Accra is exactly one UTC day — no DST offset drift).
function dayRange(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str))) return null;
  const from = new Date(`${str}T00:00:00.000Z`);
  const to = new Date(`${str}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

/**
 * GET /api/v1/activity-logs
 * Admin + SuperAdmin only (route-level restrictTo('admin')). Read-only.
 *
 * Query params:
 *   page, limit        pagination (limit clamped to 1–100, default 25)
 *   q                  search across actor name/email, description, resourceId/resourceName
 *   action             exact action
 *   resourceType       exact resource type
 *   actor              actor user id
 *   role               actor role
 *   status             success | failure
 *   resourceId         resource id / order number / tracking number
 *   from, to           YYYY-MM-DD date range (inclusive, UTC)
 *   sort               createdAt|createdAt_asc (default newest first)
 */
const getActivityLogs = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.action) filter.action = req.query.action;
    if (req.query.resourceType) filter.resourceType = req.query.resourceType;
    if (req.query.status && ['success', 'failure'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.role) filter.actorRole = req.query.role;
    if (req.query.resourceId) filter.resourceId = String(req.query.resourceId).trim();

    // Actor filter by user id (validated against a Mongo id shape to avoid a
    // CastError bubbling up as a 500).
    if (req.query.actor) {
      const actor = String(req.query.actor).trim();
      if (/^[0-9a-fA-F]{24}$/.test(actor)) filter.actorUser = actor;
    }

    // Date range (inclusive). Also supports a single `from` or `to`.
    const range = {};
    if (req.query.from) {
      const d = dayRange(req.query.from);
      if (d) range.$gte = d.from;
    }
    if (req.query.to) {
      const d = dayRange(req.query.to);
      if (d) range.$lte = d.to;
    }
    if (Object.keys(range).length) filter.createdAt = range;

    // Free-text search — backend-side, never client-side filtering.
    if (req.query.q && String(req.query.q).trim()) {
      const safe = escapeRegex(String(req.query.q).trim());
      filter.$or = [
        { actorName:    { $regex: safe, $options: 'i' } },
        { actorEmail:   { $regex: safe, $options: 'i' } },
        { description:  { $regex: safe, $options: 'i' } },
        { resourceId:   { $regex: safe, $options: 'i' } },
        { resourceName: { $regex: safe, $options: 'i' } },
        { action:       { $regex: safe, $options: 'i' } },
      ];
    }

    const sort = {};
    if (req.query.sort === 'createdAt_asc') sort.createdAt = 1;
    else sort.createdAt = -1; // newest → oldest by default

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: logs,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getActivityLogs };
