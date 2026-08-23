/**
 * EazWorld — Refund Reconciliation Job (T15)
 *
 * Paystack webhook delivery has never been live-verified in this project
 * (see backend-eaz/tasks.md T3b — still blocked, no public callback URL
 * reachable from this environment). A refund whose refund.processed /
 * refund.failed webhook never arrives would otherwise sit at
 * refund.status: 'processing' forever. This job finds any refund stuck in
 * 'processing' past the threshold and asks Paystack directly (read-only
 * refund.fetch — safe to call repeatedly) what its real status is.
 *
 * Known gap (documented, not silently swallowed): if paystack.refund.create()
 * itself threw before a refund id was captured, there is no reference to
 * fetch and no way to filter Paystack's refund.list() by transaction — that
 * narrow case is skipped here and needs manual investigation via the
 * Paystack dashboard. It only affects a create() call that failed to even
 * return a response, not the (more common) case this job actually covers:
 * create() succeeded, the webhook confirming it just never arrived.
 *
 * Live-verified against the real Paystack sandbox (2026-08-23, see
 * backend-eaz/tasks.md T15): a refund's initial status is 'pending', not
 * settled synchronously, and Paystack's own `expected_at` for an MTN GHA
 * mobile money refund was ~9 days out — refunds are genuinely slow to
 * settle, not just slow to webhook. The server.js interval this job runs on
 * is deliberately coarse (hours, not minutes) to match that real timeline
 * instead of hammering Paystack's API for over a week per stuck refund.
 *
 * Config (via .env):
 *   REFUND_RECONCILE_AFTER_MINUTES — minutes a refund can sit in
 *                                    'processing' before this job checks it
 *                                    (default: 60)
 */
const Paystack = require('@paystack/paystack-sdk');
const Order = require('../models/Order');
const { applyRefundOutcome, mapPaystackRefundStatus } = require('../utils/refunds');
const logger = require('../utils/logger');

const STUCK_AFTER_MS =
  parseInt(process.env.REFUND_RECONCILE_AFTER_MINUTES || '60', 10) * 60 * 1000;

async function runRefundReconcileJob() {
  try {
    const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
    if (!paystackSecret || !paystackSecret.startsWith('sk_')) return; // not configured
    const paystack = new Paystack(paystackSecret);

    const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
    const stuck = await Order.find({
      'refund.status': 'processing',
      'refund.requestedAt': { $lte: cutoff },
    }).select('_id orderNumber refund');

    if (!stuck.length) return;
    logger.info(`[refund-reconcile] Checking ${stuck.length} stuck refund(s)...`);

    for (const order of stuck) {
      if (!order.refund.reference) continue; // see "Known gap" above — nothing to look up yet
      try {
        const result = await paystack.refund.fetch({ id: order.refund.reference });
        const outcome = mapPaystackRefundStatus(result?.data?.status);
        if (outcome) {
          await applyRefundOutcome(order, outcome, null);
          logger.info(`[refund-reconcile] Order ${order.orderNumber} refund resolved: ${outcome}`);
        }
        // else: still in-flight at Paystack's end — leave as 'processing', check again next run.
      } catch (err) {
        logger.error(`[refund-reconcile] Failed to check order ${order.orderNumber}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('[refund-reconcile] Job error:', err.message);
  }
}

module.exports = { runRefundReconcileJob };
