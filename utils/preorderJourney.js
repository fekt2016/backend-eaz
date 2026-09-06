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
 * The CUSTOMER wording is what gets written, never the staff wording, and this
 * history is returned to customers by both tracking endpoints — so supplier
 * names, container numbers, staff notes and staff identities must not reach it.
 *
 * Written as a REWRITE rather than an append, which is what makes it safe to
 * call from anywhere — the batch moving, an order being attached, or a staff
 * member moving one order onto a different batch: the tagged entries are replaced by the batch's current
 * journey every time. Advancing adds the new stage, stepping a batch back drops
 * the stages it never reached, attaching a late order backfills everything the
 * batch has already done — one function, no special cases. Untagged entries are
 * staff's and are never touched.
 */
async function syncPreorderJourney(shipment, filter) {
  // A null shipment means the line rides on no batch: the journey is empty, so
  // the rewrite clears what a previous batch wrote and leaves staff entries.
  const journey = shipment ? customerStageHistory(shipment.stageHistory) : [];

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
