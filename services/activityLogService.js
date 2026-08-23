const ActivityLog = require('../models/ActivityLog');

// ─────────────────────────────────────────────────────────────────────────────
// Central activity logger. All meaningful business/security actions are recorded
// through this service so the write path stays in one place. Records are
// append-only — there is no update/delete API anywhere.
//
// The logger is deliberately non-fatal: a failure to persist an audit record
// must never break the business operation that triggered it (the operation
// already succeeded). Failures are logged loudly on the server console so an
// audit outage is visible to operators instead of being silently swallowed.
// ─────────────────────────────────────────────────────────────────────────────

// Consistent action vocabulary — reuse these constants at every call site.
const ACTIONS = {
  AUTH_LOGIN:             'AUTH_LOGIN',
  AUTH_LOGIN_FAILED:      'AUTH_LOGIN_FAILED',
  AUTH_LOGOUT:            'AUTH_LOGOUT',
  USER_CREATED:           'USER_CREATED',
  USER_UPDATED:           'USER_UPDATED',
  USER_ROLE_CHANGED:      'USER_ROLE_CHANGED',
  USER_BLOCKED:           'USER_BLOCKED',
  USER_UNBLOCKED:         'USER_UNBLOCKED',
  USER_PASSWORD_CHANGED:  'USER_PASSWORD_CHANGED',
  USER_REGISTERED:        'USER_REGISTERED',
  CUSTOMER_CREATED:       'CUSTOMER_CREATED',
  CUSTOMER_UPDATED:       'CUSTOMER_UPDATED',
  ORDER_CREATED:          'ORDER_CREATED',
  ORDER_PAID:             'ORDER_PAID',
  ORDER_UPDATED:          'ORDER_UPDATED',
  ORDER_STATUS_CHANGED:   'ORDER_STATUS_CHANGED',
  ORDER_CANCELLED:        'ORDER_CANCELLED',
  REFUND_INITIATED:       'REFUND_INITIATED',
  REFUND_COMPLETED:       'REFUND_COMPLETED',
  REFUND_FAILED:          'REFUND_FAILED',
  ORDER_TRACKING_UPDATED: 'ORDER_TRACKING_UPDATED',
  PAYMENT_VERIFIED:       'PAYMENT_VERIFIED',
  PAYMENT_FAILED:         'PAYMENT_FAILED',
  PRODUCT_CREATED:        'PRODUCT_CREATED',
  PRODUCT_UPDATED:        'PRODUCT_UPDATED',
  PRODUCT_DELETED:        'PRODUCT_DELETED',
  INVENTORY_CREATED:      'INVENTORY_CREATED',
  INVENTORY_UPDATED:      'INVENTORY_UPDATED',
  INVENTORY_DELETED:      'INVENTORY_DELETED',
  INVENTORY_STOCK_ADJUSTED: 'INVENTORY_STOCK_ADJUSTED',
  REPAIR_CREATED:         'REPAIR_CREATED',
  REPAIR_UPDATED:         'REPAIR_UPDATED',
  REPAIR_STATUS_CHANGED:  'REPAIR_STATUS_CHANGED',
  REPAIR_PAYMENT_ADDED:   'REPAIR_PAYMENT_ADDED',
  SALE_CREATED:           'SALE_CREATED',
  SALE_VOIDED:            'SALE_VOIDED',
  PART_ORDER_STATUS_CHANGED: 'PART_ORDER_STATUS_CHANGED',
  REPAIR_ORDER_STATUS_CHANGED: 'REPAIR_ORDER_STATUS_CHANGED',
  STAFF_CREATED:          'STAFF_CREATED',
  SETTINGS_UPDATED:       'SETTINGS_UPDATED',
  EXPENSE_CREATED:        'EXPENSE_CREATED',
  EXPENSE_UPDATED:        'EXPENSE_UPDATED',
  EXPENSE_DELETED:        'EXPENSE_DELETED',
  SUPPLIER_CREATED:       'SUPPLIER_CREATED',
  SUPPLIER_UPDATED:       'SUPPLIER_UPDATED',
  SUPPLIER_DELETED:       'SUPPLIER_DELETED',
};

const RESOURCES = {
  USER:      'USER',
  CUSTOMER:  'CUSTOMER',
  ORDER:     'ORDER',
  PAYMENT:   'PAYMENT',
  PRODUCT:   'PRODUCT',
  INVENTORY: 'INVENTORY',
  REPAIR:    'REPAIR',
  SALE:      'SALE',
  PART_ORDER: 'PART_ORDER',
  REPAIR_ORDER: 'REPAIR_ORDER',
  STAFF:     'STAFF',
  SETTINGS:  'SETTINGS',
  AUTH:      'AUTH',
  EXPENSE:   'EXPENSE',
  SUPPLIER:  'SUPPLIER',
};

// Flatten a user-like object (or raw actor fields) into the durable snapshot.
function actorSnapshot(actor) {
  if (!actor) {
    return { actorUser: null, actorName: 'System', actorEmail: '', actorRole: 'system' };
  }
  if (actor._id || actor.id) {
    return {
      actorUser: actor._id || actor.id || null,
      actorName: String(actor.name || ''),
      actorEmail: String(actor.email || ''),
      actorRole: String(actor.role || ''),
    };
  }
  // Plain object: { id, name, email, role }
  return {
    actorUser: actor.id || null,
    actorName: String(actor.name || ''),
    actorEmail: String(actor.email || ''),
    actorRole: String(actor.role || ''),
  };
}

// Diff two plain objects and keep only the changed scalar values. Arrays,
// objects, passwords, and tokens are intentionally excluded. `labels` maps a
// field key to a human label (e.g. { status: 'Order Status' }).
function buildChanges(before = {}, after = {}, labels = {}) {
  const changes = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (b === a) continue;
    // Skip objects/arrays (too large / not useful) and any secret-ish field.
    if (b != null && typeof b === 'object') continue;
    if (a != null && typeof a === 'object') continue;
    if (/password|token|secret|pin|cvv|card/i.test(key)) continue;
    changes.push({
      field: key,
      label: labels[key] || key,
      before: b == null ? null : String(b),
      after: a == null ? null : String(a),
    });
  }
  return changes;
}

/**
 * Write an activity log record.
 * @param {object} opts
 * @param {object} opts.actor       User doc, {id,name,email,role}, or null → 'System'
 * @param {string} opts.action      One of ACTIONS.*
 * @param {string} opts.resourceType One of RESOURCES.*
 * @param {string|number} [opts.resourceId]
 * @param {string} [opts.resourceName] Human label for the resource (order number, product name…)
 * @param {string} [opts.description]
 * @param {Array} [opts.changes]    Pre-built [{field,label,before,after}] array
 * @param {object} [opts.metadata]  Structured extra context (no secrets)
 * @param {'success'|'failure'} [opts.status]
 * @param {string} [opts.ip]
 * @param {string} [opts.userAgent]
 * @param {string} [opts.requestId] Correlation id (req.id)
 */
async function log(opts = {}) {
  try {
    const entry = {
      ...actorSnapshot(opts.actor),
      action: opts.action,
      resourceType: opts.resourceType || '',
      resourceId: opts.resourceId != null ? String(opts.resourceId) : '',
      resourceName: String(opts.resourceName || ''),
      description: String(opts.description || '').slice(0, 1000),
      changes: Array.isArray(opts.changes) ? opts.changes : [],
      metadata: opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {},
      status: opts.status === 'failure' ? 'failure' : 'success',
      ip: String(opts.ip || '').slice(0, 64),
      userAgent: String(opts.userAgent || '').slice(0, 500),
      requestId: String(opts.requestId || '').slice(0, 100),
    };
    if (!entry.action) {
      console.warn('[activity-log] skipped — no action supplied');
      return;
    }
    await ActivityLog.create(entry);
  } catch (err) {
    console.error('[activity-log] failed to write audit record:', err.message);
  }
}

// Convenience wrapper: pulls actor / ip / user-agent / correlation id from the
// Express request so controllers stay concise. Accepts the same payload as
// `log()` minus the request-derived fields.
function logFromRequest(req, opts = {}) {
  return log({
    actor: req.user || null,
    ip: req.ip,
    userAgent: req.get && typeof req.get === 'function' ? req.get('user-agent') || '' : '',
    requestId: req.id || '',
    ...opts,
  });
}

module.exports = {
  log,
  logFromRequest,
  buildChanges,
  ACTIONS,
  RESOURCES,
};
