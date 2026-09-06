/**
 * Shared dependencies, config, constants and helpers for the order controllers.
 *
 * orderController.js was one 2,150-line file spanning checkout, public tracking,
 * pre-orders and admin fulfilment. It is now split into
 * controllers/orders/<domain>Controller.js, each of which pulls what it needs
 * from here. `controllers/orderController.js` re-exports every handler so the
 * route files are unaffected — the same shape the POS split already uses.
 *
 * Nothing below was rewritten. The helpers are the originals, moved verbatim,
 * because a behaviour-preserving split is only worth trusting if the behaviour
 * was never retyped.
 */
const crypto = require("crypto");
const Paystack = require("@paystack/paystack-sdk");
const Order = require("../../models/Order");
const Product = require("../../models/Product");
const DeliveryZone = require("../../models/DeliveryZone");
const ShippingQuote = require("../../models/ShippingQuote");
const PickupLocation = require("../../models/PickupLocation");
const { quoteShipping, splitCourierMethodId } = require("../../services/shipping/shippingCalculator");
const { buildCartHash } = require("../../models/ShippingQuote");
const { fulfilShopOrder, restockOrderItems } = require("../../utils/fulfilShopOrder");
const { generateTrackingNumber } = require("../../utils/trackingNumber");
const { formatGhs } = require("../../utils/money");
const { syncVariantStock } = require("../../utils/syncVariantStock");
const { log, logFromRequest, ACTIONS, RESOURCES } = require("../../services/activityLogService");
const { normalizePhone } = require("../../utils/phone");
const { buildCustomerOrderFilter } = require("../../utils/customerOrderMatch");
const { applyRefundOutcome, mapPaystackRefundStatus } = require("../../utils/refunds");
const { sendPreorderReadyEmail, sendShopStatusEmail } = require("../../utils/email");
const {
  CUSTOMER_STAGES, CUSTOMER_STAGE_ORDER, STAGE_LABELS, customerStageHistory,
} = require("../../models/Shipment");
const Shipment = require("../../models/Shipment");
const { syncPreorderJourney } = require("../../utils/preorderJourney");

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith("sk_")) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn(
    "⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for payments.",
  );
}

const FRONTEND_URL = require("../../utils/frontendUrl")();
const { sanitizeName, sanitizeText, sanitizeEmail } = require("../../utils/sanitize");


/**
 * Resolve whether a variant line is a pre-order, and with what fields.
 *
 * Pre-order can live at two levels: on the product (`product.preorder`) and,
 * per variant, on the variant itself (`variant.preorder`). A variant that has
 * opted into pre-order supports it even when another variant of the same
 * product is in stock — the whole product is no longer a single on/off switch.
 *
 * Resolution rule: the variant's own flag wins (null = unset → fall through to
 * the product). Conversely a variant can be explicitly switched OFF (false)
 * even if the product-level flag is on. Returns `null` when the line cannot be
 * a pre-order at all.
 */
function resolveVariantPreorder(product, variant) {
  const variantPre = variant?.preorder;
  if (variantPre && typeof variantPre.enabled === "boolean") {
    if (!variantPre.enabled) return null;
    return {
      enabled: true,
      availableFrom: variantPre.availableFrom ?? null,
      note: variantPre.note || "",
      maxQty: variantPre.maxQty ?? null,
    };
  }
  if (product.preorder?.enabled) {
    return {
      enabled: true,
      availableFrom: product.preorder.availableFrom ?? null,
      note: product.preorder.note || "",
      maxQty: product.preorder.maxQty ?? null,
    };
  }
  return null;
}


/**
 * POST /api/v1/orders/track
 * Guest order tracking: orderNumber + phone. The order is only returned
 * when the submitted phone matches customer.phone — this prevents order
 * enumeration by guessing order numbers alone.
 */
/**
 * The pre-order block shown on every public view of an order, or null when the
 * order has no line still waiting on stock.
 *
 * Shared deliberately: the customer reaches their order three ways — the
 * order-number-and-phone lookup, the tracking-number page, and the confirmation
 * link — and a pre-order that appears on one but not the others reads as though
 * something went wrong. `order.items.shipment` must be populated by the caller.
 *
 * What crosses this line is only ever the derived block. The shipment document
 * behind it carries the supplier, the container number and staff notes, so no
 * caller may return it — see the strip in trackOrder.
 */
function buildPreorderTracking(order, { includeBatch = false } = {}) {
  const waiting = (order?.items || []).filter((i) => i.isPreorder && !i.preorderReleasedAt);
  if (!waiting.length) return null;

  // Exactly one thing drives a line: the batch it rides on, or — for a single
  // pre-order that is not part of any container — the line itself. A batch is
  // an efficiency, never a requirement, so staff can record a stage on an order
  // that will never be containerised.
  const onBatch = waiting.find((i) => i.shipment?.stage) || null;
  const onItsOwn = onBatch ? null : waiting.find((i) => i.preorderStage) || null;

  const shipment = onBatch?.shipment || null;
  const stageHistory = shipment ? shipment.stageHistory : (onItsOwn?.preorderStageHistory || []);
  const stage = shipment ? shipment.stage : (onItsOwn?.preorderStage || '');

  return {
    // Staff-only, and opt-in: the internal journey — every stage with its note,
    // its date and who entered it — plus which line to record the next stage on.
    // Someone answering "where is my phone?" needs the detail behind the public
    // wording, and the customer-facing callers do not even SELECT these fields.
    ...(includeBatch
      ? {
        journey: {
          // Where the next update has to be made. A line on a batch moves with
          // the batch; one on its own is recorded on the order.
          source: shipment ? 'batch' : 'order',
          itemId: String((onBatch || onItsOwn || waiting[0])._id || ''),
          stage,
          stageLabel: STAGE_LABELS[stage] || '',
          batch: shipment
            ? {
              id: String(shipment._id || ''),
              reference: shipment.reference || '',
              name: shipment.name || '',
              containerNumber: shipment.containerNumber || '',
            }
            : null,
          history: (stageHistory || []).map((e) => ({
            stage: e.stage,
            label: STAGE_LABELS[e.stage] || e.stage,
            note: e.note || '',
            date: e.date,
            updatedBy: e.updatedBy?.name || '',
            // What that stage actually said to the customer, so staff can see
            // both sides of their own update.
            customerLabel: CUSTOMER_STAGES[e.stage]?.label || '',
          })),
        },
      }
      : {}),
    items: waiting.map((i) => ({ name: i.name, qty: i.qty })),
    stage: stage ? CUSTOMER_STAGES[stage]?.key || null : null,
    label: stage
      ? CUSTOMER_STAGES[stage]?.label || null
      : 'Confirmed — awaiting shipment',
    expectedArrival: shipment ? shipment.expectedArrival || null : null,
    // Where the goods are coming from. The journey starts at the supplier, so
    // saying "China" is the difference between a customer knowing their item is
    // being made abroad and assuming we are sitting on it.
    origin: shipment?.origin || 'China',
    // The dated journey so far — a position alone cannot tell someone whether it
    // has been at sea for a week or a month.
    //
    // A batch's history comes off the Shipment, which customer endpoints
    // populate. An order's OWN history does not: that field is select:false so
    // it cannot ride out on the raw order, which means deriving from it here
    // would hand every customer an empty journey. The synced copy in
    // `trackingHistory` is the customer-safe one and is kept in step by
    // syncPreorderJourney, so read that instead.
    history: shipment
      ? customerStageHistory(stageHistory)
      : (order.trackingHistory || [])
        .filter((e) => e.preorderStage)
        .map((e) => ({
          stage: e.preorderStage,
          label: e.note || '',
          date: e.timestamp,
          note: e.detail || '',
        })),
  };
}


const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];


// Forward-only status flow. An order may move to any *later* stage (skips like
// paid → delivered are allowed), or be cancelled while still live. Same-status
// is a no-op. `delivered` and `cancelled` are terminal. This only blocks
// backward moves and changes out of a terminal state.
const STATUS_RANK = { pending: 0, paid: 1, processing: 2, shipped: 3, delivered: 4 };

function canTransition(from, to) {
  if (from === to) return true;                                   // no-op
  if (from === 'delivered' || from === 'cancelled') return false; // terminal
  if (to === 'cancelled') return true;                            // cancel any live order
  return (STATUS_RANK[to] ?? -1) > (STATUS_RANK[from] ?? -1);     // forward only
}


/**
 * Pre-order lines waiting on stock. The same shape /orders/preorders returns,
 * expressed as a filter so the release queue can be a view of the one order
 * list rather than a second page listing orders its own way.
 *
 * Unpaid orders are excluded deliberately: nothing is owed until the money has
 * landed, and releasing one would move stock for an order that may never be paid.
 */
const PENDING_PREORDER = {
  status: { $in: ['paid', 'processing'] },
  items: { $elemMatch: { isPreorder: true, preorderReleasedAt: null } },
};


/**
 * T45 — fulfilment stages an order may not reach while a pre-order line on it is
 * still waiting on stock.
 *
 * `paid` and `cancelled` are deliberately absent. Money lands long before the
 * goods do — that is what a pre-order IS — and a customer must be able to walk
 * away while the container is still at sea. Everything after that describes work
 * on physical stock the shop does not have yet.
 */
const PREORDER_HELD_STATUSES = ['processing', 'shipped', 'delivered'];


/** The lines on this order still waiting for their batch to land. */
function pendingPreorderItems(order) {
  return (order?.items || []).filter((i) => i.isPreorder && !i.preorderReleasedAt);
}


/**
 * Why this status move is refused, or null if it is allowed.
 *
 * Both staff doors — PATCH /:id and POST /:id/tracking — call this, because a
 * guard on one is not a guard at all: the tracking endpoint moves status too.
 * Releasing is what lifts the hold, and release itself checks stock, so "the
 * goods are here" is proved once, in one place.
 */
function preorderHold(order, status) {
  if (!status || status === order.status) return null;
  if (!PREORDER_HELD_STATUSES.includes(status)) return null;

  const waiting = pendingPreorderItems(order);
  if (!waiting.length) return null;

  return `This order is waiting on pre-order stock: ${waiting.map((i) => i.name).join(', ')}. `
    + `Release the pre-order once the batch has reached the shop, then set it to "${status}".`;
}

module.exports = {
  // deps
  crypto, Paystack,
  Order, Product, DeliveryZone, ShippingQuote, PickupLocation, Shipment,
  quoteShipping, splitCourierMethodId, buildCartHash,
  fulfilShopOrder, restockOrderItems, generateTrackingNumber,
  formatGhs, syncVariantStock, normalizePhone, buildCustomerOrderFilter,
  applyRefundOutcome, mapPaystackRefundStatus,
  sendPreorderReadyEmail, sendShopStatusEmail,
  CUSTOMER_STAGES, CUSTOMER_STAGE_ORDER, STAGE_LABELS, customerStageHistory,
  syncPreorderJourney,
  log, logFromRequest, ACTIONS, RESOURCES,
  paystack, FRONTEND_URL,
  sanitizeName, sanitizeText, sanitizeEmail,
  // shared helpers and constants
  resolveVariantPreorder, buildPreorderTracking,
  ORDER_STATUSES, STATUS_RANK, canTransition,
  PENDING_PREORDER, PREORDER_HELD_STATUSES, pendingPreorderItems, preorderHold,
};
