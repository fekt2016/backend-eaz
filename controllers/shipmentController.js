const mongoose = require('mongoose');
const Shipment = require('../models/Shipment');
const { SHIPMENT_STAGES } = require('../models/Shipment');
const { syncPreorderJourney, waitingOn } = require('../utils/preorderJourney');
const Order = require('../models/Order');
const { logFromRequest, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { sanitizeText } = require('../utils/sanitize');

/** POST /api/v1/shipments — start tracking an incoming batch (admin/staff). */
const createShipment = async (req, res, next) => {
  try {
    const { name, supplier, origin, containerNumber, expectedArrival, note } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Shipment name is required.' });
    }

    // Prepare the reference counter before the insert, for the reason spelled out
    // in Sale.ensureNumberCounter (T47): an upsert of a missing counter row races.
    await Shipment.ensureReferenceCounter();

    const shipment = await Shipment.create({
      name: sanitizeText(name, 120),
      supplier: supplier || undefined,
      origin: origin ? sanitizeText(origin, 60) : 'China',
      containerNumber: containerNumber ? sanitizeText(containerNumber, 40) : undefined,
      expectedArrival: expectedArrival || null,
      stage: SHIPMENT_STAGES[0],
      stageHistory: [{
        stage: SHIPMENT_STAGES[0],
        note: note ? sanitizeText(note, 300) : '',
        date: new Date(),
        updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      }],
      createdBy: req.user?._id,
    });

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: shipment.reference,
      resourceName: shipment.name,
      description: `Shipment ${shipment.reference} created — ${shipment.name}`,
    });

    res.status(201).json({ success: true, data: shipment });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/shipments — batches in flight, plus how many lines ride on each. */
const getShipments = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const query = {};
    if (req.query.stage && SHIPMENT_STAGES.includes(req.query.stage)) {
      query.stage = req.query.stage;
    }

    const shipments = await Shipment.find(query)
      .populate('supplier', 'name')
      .sort({ expectedArrival: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    // How many pre-order lines are riding on each, so staff can see at a glance
    // which batch matters most.
    const counts = await Order.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.shipment': { $ne: null }, 'items.preorderReleasedAt': null } },
      { $group: { _id: '$items.shipment', lines: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.lines]));

    res.status(200).json({
      success: true,
      count: shipments.length,
      data: shipments.map((s) => ({ ...s, waitingLines: byId.get(String(s._id)) || 0 })),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/shipments/:id — one batch, with the orders waiting on it. */
const getShipment = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id).populate('supplier', 'name phone wechat');
    if (!shipment) {
      return res.status(404).json({ success: false, error: 'Shipment not found' });
    }

    const orders = await Order.find({ 'items.shipment': shipment._id })
      .select('orderNumber status createdAt customer.name items trackingNumber')
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({ success: true, data: { shipment, orders } });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/shipments/:id/stage — move the batch along.
 *
 * One update here is the whole point: every pre-order line attached to this
 * shipment reflects the new position immediately, with no per-order work.
 */
const advanceShipmentStage = async (req, res, next) => {
  try {
    const { stage, note, date } = req.body;
    if (!SHIPMENT_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: `Stage must be one of: ${SHIPMENT_STAGES.join(', ')}.`,
      });
    }

    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) {
      return res.status(404).json({ success: false, error: 'Shipment not found' });
    }
    // Re-recording the stage a batch is already on is a CORRECTION, not a move:
    // the date or the note was wrong. Refusing it would leave the opening stage
    // permanently stamped with the day the batch row was created, which is
    // rarely the day the goods actually went into production — and that stamp is
    // the date the customer is shown.
    if (shipment.stage === stage) {
      const entry = [...shipment.stageHistory].reverse().find((e) => e.stage === stage);
      if (!entry) {
        return res.status(400).json({ success: false, error: 'The shipment is already at that stage.' });
      }
      if (date) entry.date = new Date(date);
      if (note !== undefined) entry.note = note ? sanitizeText(note, 300) : '';
      entry.updatedBy = { name: req.user?.name || '', role: req.user?.role || '' };
      await shipment.save();

      const corrected = await syncPreorderJourney(shipment, waitingOn(shipment._id));
      await logFromRequest(req, {
        action: ACTIONS.ORDER_UPDATED,
        resourceType: RESOURCES.ORDER,
        resourceId: shipment.reference,
        resourceName: shipment.name,
        description: `Shipment ${shipment.reference} — ${stage} corrected`,
        metadata: { stage, note: note || '', orders: corrected },
      });

      return res.status(200).json({ success: true, data: shipment });
    }

    // Moving BACK is a correction, not a move: someone clicked one stage too far,
    // or the goods genuinely turned around. The customer's dated journey reads
    // straight off this array, so entries beyond the corrected position have to
    // go — otherwise their tracking page keeps claiming the batch reached Ghana.
    // The activity log below retains the full audit trail either way.
    const from = SHIPMENT_STAGES.indexOf(shipment.stage);
    const to = SHIPMENT_STAGES.indexOf(stage);
    if (to < from) {
      // `<= to` rather than `< to`: an earlier genuine visit to this stage keeps
      // its original date, which is the one the customer should see.
      shipment.stageHistory = shipment.stageHistory.filter(
        (e) => SHIPMENT_STAGES.indexOf(e.stage) <= to,
      );
    }

    shipment.stage = stage;
    shipment.stageHistory.push({
      stage,
      note: note ? sanitizeText(note, 300) : '',
      // A stage is often entered after the fact ("it actually sailed on Monday"),
      // so the date is the caller's to set.
      date: date ? new Date(date) : new Date(),
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
    });
    await shipment.save();

    // The move is the batch's; the history belongs to each customer's order.
    const orderCount = await syncPreorderJourney(shipment, waitingOn(shipment._id));

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: shipment.reference,
      resourceName: shipment.name,
      description: `Shipment ${shipment.reference} → ${stage}`,
      metadata: { stage, note: note || '', orders: orderCount },
    });

    res.status(200).json({ success: true, data: shipment });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/shipments/:id/orders — attach pre-order lines to this batch.
 *
 * Only lines that are actually waiting: a released line has already been handed
 * over, and attaching it would tell that customer their delivered order is still
 * at sea.
 */
const attachOrdersToShipment = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) {
      return res.status(404).json({ success: false, error: 'Shipment not found' });
    }

    const orderIds = Array.isArray(req.body.orderIds) ? req.body.orderIds : [];
    if (!orderIds.length) {
      return res.status(400).json({ success: false, error: 'No orders given to attach.' });
    }

    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { 'items.$[line].shipment': shipment._id } },
      { arrayFilters: [{ 'line.isPreorder': true, 'line.preorderReleasedAt': null }] },
    );

    // A batch is often half way to Ghana before someone remembers to attach an
    // order to it. Backfilling here is what stops that customer's history
    // starting mid-voyage — the rewrite makes it the batch's journey either way.
    await syncPreorderJourney(shipment, {
      _id: { $in: orderIds },
      ...waitingOn(shipment._id),
    });

    // Count the lines that actually carry this shipment now, rather than trusting
    // `modifiedCount`: Mongo reports a document as modified even when the array
    // filter matched nothing, because writing schema defaults counts as a change.
    // The caller wants to know how many customers this attached, not how many
    // documents were touched.
    const counted = await Order.aggregate([
      { $match: { _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
      { $unwind: '$items' },
      { $match: { 'items.shipment': shipment._id } },
      { $count: 'lines' },
    ]);

    res.status(200).json({
      success: true,
      data: { attached: counted[0]?.lines || 0 },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createShipment,
  getShipments,
  getShipment,
  advanceShipmentStage,
  attachOrdersToShipment,
};
