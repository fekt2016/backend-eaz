/**
 * Shared dependencies, config, constants and helpers for the POS controllers.
 *
 * posController.js was one 2,600-line file spanning nine domains. It is now split
 * into controllers/pos/<domain>Controller.js, each of which pulls everything it
 * needs from this module. `controllers/posController.js` re-exports all handlers
 * so the route files are unaffected.
 */
const mongoose    = require('mongoose');
const crypto      = require('crypto');
const Paystack    = require('@paystack/paystack-sdk');
const PosCustomer = require('../../models/PosCustomer');
const RepairJob   = require('../../models/RepairJob');
const Part        = require('../../models/Part');
const Product     = require('../../models/Product');
const PosPayment  = require('../../models/PosPayment');
const PartOrder   = require('../../models/PartOrder');
const RepairOrder = require('../../models/RepairOrder');
const Order       = require('../../models/Order');
const DeliveryZone = require('../../models/DeliveryZone');
const Sale        = require('../../models/Sale');
const User        = require('../../models/User');
const Expense     = require('../../models/Expense');
const Supplier    = require('../../models/Supplier');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText } = require('../../utils/sanitize');
const { deductPartStock } = require('../../utils/deductPartStock');
const { cloudinary } = require('../../config/cloudinary');
const streamifier    = require('streamifier');
const { notifyCustomer, sendCredentialsSms } = require('../../services/notify');
const { notify, NOTIFICATION_TYPES } = require('../../utils/notifications');
const { sendAccountCreatedEmail } = require('../../utils/email');
const { log, logFromRequest, buildChanges, ACTIONS, RESOURCES } = require('../../services/activityLogService');
const { escapeRegex }   = require('../../utils/regex');
const { normalizePhone } = require('../../utils/phone');
const { formatGhs }      = require('../../utils/money');

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
const paystack = (paystackSecret && paystackSecret.startsWith('sk_'))
  ? new Paystack(paystackSecret)
  : null;

const FRONTEND_URL = require('../../utils/frontendUrl')();

// ─── Constants ────────────────────────────────────────────────────────────────
const ACTIVE_JOB_STATUSES = ['received', 'diagnosing', 'waiting_for_parts', 'repairing', 'ready'];
const REVENUE_ORDER_STATUSES = ['paid', 'processing', 'shipped', 'delivered'];
const EXPENSE_CATEGORIES = ['rent','utilities','tools','parts','salaries','marketing','transport','maintenance','other'];
const MOMO_PROVIDERS = { mtn: 'mtn', vod: 'vod', atl: 'atl', tgo: 'tgo' };
const PART_REPAIR_ORDER_STATUSES = ['pending', 'paid', 'cancelled'];

// Shared by PartOrder/RepairOrder status updates (inventoryController.updatePartOrder,
// jobController.updateRepairOrder). Only `pending` may move — to `paid` (normally set by
// the Paystack webhook, but staff can also confirm manually) or `cancelled` (abandon an
// unpaid order). Once `paid` or `cancelled`, the order is terminal: no un-paying and no
// cancelling a paid order (that needs a refund process, out of scope here).
function canTransitionPartRepairOrder(from, to) {
  if (from === to) return true; // no-op
  return from === 'pending';
}

// Forward-only status flow for repair jobs (T53; mirrors orderController.canTransition).
// received → diagnosing → waiting_for_parts → repairing → ready → collected, skips
// allowed (e.g. received → ready). `collected` and `cancelled` are both terminal — no
// moves out of either, same precedent as orderController's delivered/cancelled (a
// mis-marked collection needs a new job, not a backward status flip). `cancelled` is
// reachable from any live status except `ready` (T18: once a job is staged for pickup
// it must be collected, not cancelled).
//
// One deliberate exception: waiting_for_parts → diagnosing. This is the manual
// correction path T58 relies on — cancelling a *paid* PartOrder/RepairOrder leaves the
// linked job stuck at `waiting_for_parts` (T58 explicitly stopped short of an automatic
// reset, since nothing on RepairJob distinguishes "webhook set this" from "staff set
// this for an unrelated reason"), so staff need a manual way back to `diagnosing`.
// Without this carve-out, T53's forward-only rule would silently close off that
// fallback along with the bug it's meant to fix.
const JOB_STATUS_RANK = { received: 0, diagnosing: 1, waiting_for_parts: 2, repairing: 3, ready: 4, collected: 5 };
function canTransitionJobStatus(from, to) {
  if (from === to) return true;                                     // no-op
  if (from === 'waiting_for_parts' && to === 'diagnosing') return true; // T58 manual-reset fallback
  if (from === 'collected' || from === 'cancelled') return false;   // terminal
  if (to === 'cancelled') return from !== 'ready';                  // T18 guard
  return (JOB_STATUS_RANK[to] ?? -1) > (JOB_STATUS_RANK[from] ?? -1); // forward only
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Outstanding balance for a job in pesewas, mirroring the staff POS invoice:
 *   total  = (requiresDiagnosis ? diagnosisFee : 0) + Σ(parts.priceAtTime × qty) + laborCost
 *   paid   = Σ(PosPayment.amount)
 * All monetary fields are already integer pesewas, so no conversion is needed.
 */
function computeJobBalancePesewas(job, payments = []) {
  const partsTotal = (job.parts || []).reduce(
    (s, p) => s + (p.priceAtTime || 0) * (p.quantity || 1),
    0
  );
  const total =
    (job.requiresDiagnosis ? Number(job.diagnosisFee) || 0 : 0) +
    partsTotal +
    (Number(job.laborCost) || 0);
  const paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  return Math.max(0, Math.round(total - paid));
}

/**
 * Deduct inventory for every inventory-linked job part that hasn't been deducted
 * yet, flagging each line so it's never double-counted. Guarded via
 * deductPartStock — stock never goes negative unless the Part opts in. Mutates
 * `job.parts[].stockDeducted`; the caller is responsible for saving the job.
 */
async function deductJobPartsOnce(job) {
  for (const p of job.parts) {
    if (p.part && !p.stockDeducted) {
      const res = await deductPartStock(p.part, p.quantity || 1);
      if (!res.ok) {
        console.error(`[stock] decrement skipped for part ${p.part} on job ${job.jobNumber} — insufficient stock.`);
      }
      p.stockDeducted = true;
    }
  }
}

/** Generate a cryptographically-strong password meeting validatePassword rules. */
function generatePassword(length = 12) {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghijkmnopqrstuvwxyz';
  const digits  = '23456789';
  const symbols = '@#$!%&*';
  const all     = upper + lower + digits + symbols;
  const pick    = (chars) => chars[crypto.randomInt(chars.length)];
  const chars   = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  for (let i = chars.length; i < length; i++) chars.push(pick(all));
  // Fisher–Yates shuffle so the required character classes aren't at fixed positions
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Pick the technician with the fewest active jobs (simple load balancing). */
async function findTechnicianToAssign() {
  const technicians = await User.find({ role: 'technician' }).select('_id name').lean();
  if (!technicians.length) return null;

  const activeCounts = await RepairJob.aggregate([
    { $match: { assignedTo: { $in: technicians.map(t => t._id) }, status: { $in: ACTIVE_JOB_STATUSES } } },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(activeCounts.map(c => [c._id.toString(), c.count]));

  technicians.sort((a, b) => (counts[a._id.toString()] || 0) - (counts[b._id.toString()] || 0));
  return technicians[0]._id;
}

/** Shape a shop Product like a POS Part so both flow through the scan/inventory UI. */
function normalizeProduct(product) {
  return {
    ...product,
    _kind: 'product',
    sellingPrice:  Number(product.price) || 0,
    quantity:      Number(product.stock) || 0,
    lowStockThreshold: 0,
    allowNegativeStock: false,
  };
}

/** Date → 'YYYY-MM-DD' (UTC; Ghana is UTC+0 so no DST drift). */
function formatDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

/** Percentage change current-vs-previous, rounded to 0.1%; null when no baseline. */
function pctChange(current, previous) {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

module.exports = {
  // deps
  mongoose, crypto, Paystack,
  PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder,
  Order, DeliveryZone, Sale, User, Expense, Supplier,
  sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText,
  deductPartStock, cloudinary, streamifier,
  notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail,
  notify, NOTIFICATION_TYPES,
  log, logFromRequest, buildChanges, ACTIONS, RESOURCES,
  escapeRegex, normalizePhone, formatGhs,
  paystack, FRONTEND_URL,
  // constants
  ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS,
  PART_REPAIR_ORDER_STATUSES,
  // helpers
  computeJobBalancePesewas, deductJobPartsOnce, generatePassword,
  findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange,
  canTransitionPartRepairOrder, canTransitionJobStatus,
};
