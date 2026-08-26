const { log, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { sendRefundOutcomeEmail } = require('./email');

// T15 — refund status is server-owned truth, never trusted from a client.
// Only Paystack itself (via the refund.processed/refund.failed webhook, the
// manual /refund/sync endpoint, or the periodic reconcile job — see
// services/refundReconcileJob.js) can move a refund out of 'processing'.

/**
 * Move an order's refund from 'processing' to a terminal outcome
 * ('completed'|'failed'), idempotently — a no-op once already settled — and
 * log it. Shared by the three places that can learn a refund's real outcome
 * from Paystack: the webhook branch, the manual sync endpoint, and the
 * reconcile job. `actor` is a User doc/plain object for an admin-triggered
 * sync, or null for a system-triggered webhook/reconcile update.
 */
async function applyRefundOutcome(order, outcome, actor = null) {
  if (['completed', 'failed'].includes(order.refund.status)) return order; // already settled

  order.refund.status = outcome;
  if (outcome === 'completed') order.refund.completedAt = new Date();
  await order.save({ validateBeforeSave: false });

  // T62 — the customer is told the outcome, whichever path learned it first
  // (refund webhook, manual /refund/sync, or the reconcile job). Best-effort:
  // a mail failure must not disturb a settled refund.
  sendRefundOutcomeEmail(order).catch(() => {});

  await log({
    actor,
    action: outcome === 'completed' ? ACTIONS.REFUND_COMPLETED : ACTIONS.REFUND_FAILED,
    resourceType: RESOURCES.PAYMENT,
    resourceId: order.orderNumber,
    resourceName: `Order ${order.orderNumber}`,
    description: `Refund ${outcome} for order ${order.orderNumber}`,
    metadata: { reference: order.refund.reference },
    status: outcome === 'completed' ? 'success' : 'failure',
  });

  return order;
}

// Map a Paystack refund status string (from a webhook payload or
// refund.fetch()) to our terminal outcome. Returns null while still
// in-flight at Paystack's end (e.g. 'pending') — caller should leave the
// order untouched in that case, not guess.
function mapPaystackRefundStatus(paystackStatus) {
  const s = String(paystackStatus || '').toLowerCase();
  if (['processed', 'success', 'successful'].includes(s)) return 'completed';
  if (['failed', 'reversed'].includes(s)) return 'failed';
  return null;
}

module.exports = { applyRefundOutcome, mapPaystackRefundStatus };
