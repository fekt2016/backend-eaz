const Order = require('../models/Order');
const { customerStageHistory } = require('../models/Shipment');

/**
 * Fold the batch's journey into each waiting order's own tracking history.
 *
 * Customers read ONE history. A pre-order can spend months getting here, and if
 * that journey lives only in a separate widget, the tracking history — the place
 * every other fulfilment event appears — shows a payment and then nothing until
 * the goods land. So the batch writes into it, step by step.
 *
 * The CUSTOMER wording is what gets written, never the staff wording. The note
 * crosses too — it is the message staff write for the customer — but supplier
 * names, container numbers and staff identities never do.
 *
 * Written as a REWRITE rather than an append, which is what makes it safe to
 * call from anywhere — the batch moving, an order being attached, a staff
 * member moving one order onto a different batch, or a single order's own
 * stage being recorded: the tagged entries are replaced by the batch's current
 * journey every time. Advancing adds the new stage, stepping a batch back drops
 * the stages it never reached, attaching a late order backfills everything the
 * batch has already done — one function, no special cases. Untagged entries are
 * staff's and are never touched.
 */
async function syncPreorderJourney(stageHistory, filter) {
  // Takes the raw internal history rather than a batch, because a batch is not
  // the only thing that drives a pre-order: a single order not part of any
  // container records its stages on the line itself, in the same shape. Empty
  // or absent clears what a previous source wrote and leaves staff entries.
  const journey = customerStageHistory(stageHistory || []);

  // Lean + select: a batch can carry dozens of orders and the backend runs on a
  // 512MB heap. One bulkWrite rather than a save() per order, for the same reason.
  const orders = await Order.find(filter).select('status trackingHistory').lean();
  if (!orders.length) return 0;

  const ops = orders.map((order) => {
    const staffEntries = (order.trackingHistory || []).filter((e) => !e.preorderStage);
    const stageEntries = journey.map((s) => ({
      status: order.status,
      note: s.label,
      location: '',
      // No `updatedBy`: the batch moved, not a person. Naming the staff member
      // who clicked would put an internal identity on a customer-facing page.
      updatedBy: { name: '', role: '' },
      timestamp: s.date,
      preorderStage: s.stage,
      // Staff write this FOR the customer, so it crosses with the stage.
      detail: s.note || '',
    }));

    // Sorted, because a stage is routinely backdated ("it actually sailed on
    // Monday") and would otherwise land after events that happened later.
    const merged = [...staffEntries, ...stageEntries]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return { updateOne: { filter: { _id: order._id }, update: { $set: { trackingHistory: merged } } } };
  });

  await Order.bulkWrite(ops);
  return ops.length;
}

/**
 * The orders a batch's journey should appear on: lines still waiting on it.
 * A released line has been handed over — its history keeps the journey it
 * already has, but the batch stops writing to it.
 */
const waitingOn = (shipmentId) => ({
  items: { $elemMatch: { shipment: shipmentId, isPreorder: true, preorderReleasedAt: null } },
});

module.exports = { syncPreorderJourney, waitingOn };
