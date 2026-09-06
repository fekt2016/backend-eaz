const mongoose = require('mongoose');
const Counter = require('./Counter');

/**
 * A batch of stock coming in from a supplier — typically a container from China
 * carrying pre-ordered goods for many customers at once.
 *
 * Tracking lives here rather than on each order on purpose: one container serves
 * twenty customers, so staff move the shipment through its stages ONCE and every
 * pre-order attached to it reflects the new position.
 */

// The journey, in order — the five milestones staff drive and customers see.
// One list, not an operational list collapsing into a public one: staff record
// the stage the customer is waiting to hear about, and the nuance behind it
// ("cleared customs, awaiting release") belongs in that stage's note.
//
// Kept as a fixed list so a shipment's position is comparable across batches —
// free text could not tell you which shipments are late.
const SHIPMENT_STAGES = [
  'production',           // being made by the supplier
  'container_warehouse',  // made, at the container warehouse awaiting a container
  'shipped',              // sailing
  'port_ghana',           // landed at the port in Ghana (Tema), incl. customs
  'at_shop',              // received at our warehouse — pre-orders can now be released
];

const STAGE_LABELS = {
  production:          'In production',
  container_warehouse: 'At the container warehouse',
  shipped:             'Shipped',
  port_ghana:          'Arrived at the port in Ghana',
  at_shop:             'Arrived at our warehouse',
};

/**
 * What a customer is shown for each stage — the same five, in warmer words.
 *
 * The map stays even though the keys now match one-to-one: it is the boundary
 * that supplier names, container numbers, staff notes and staff identities do
 * not cross, and the place to change the customer's wording without touching
 * what staff work with.
 *
 * `at_shop` is the end of this road, not of the order — releasing the pre-order
 * there is what starts the ordinary local delivery tracking.
 */
const CUSTOMER_STAGES = {
  production:          { key: 'production',          label: 'In production' },
  container_warehouse: { key: 'container_warehouse', label: 'At the container warehouse' },
  shipped:             { key: 'shipped',             label: 'Shipped — on its way to Ghana' },
  port_ghana:          { key: 'port_ghana',          label: 'Arrived at the port in Ghana' },
  at_shop:             { key: 'at_shop',             label: 'At our warehouse — preparing your order' },
};

// The five customer stages in order, so a position is comparable to a step index
// and a history can be sorted by where it sits on the journey rather than by the
// eight-stage detail behind it.
const CUSTOMER_STAGE_ORDER = [
  'production', 'container_warehouse', 'shipped', 'port_ghana', 'at_shop',
];

/**
 * The dated journey a customer may see, built from the staff `stageHistory`.
 *
 * Stages map one-to-one now, so this mostly relabels — but it still keeps the
 * EARLIEST date per stage, which is what makes a corrected batch honest: if a
 * stage is recorded twice, the customer keeps the date they were first told.
 *
 * The note DOES cross: it is the message staff write for the customer ("held at
 * customs, expect three more days"), which is the most useful thing on the page.
 * `updatedBy` does not — who moved the batch is nobody's business but ours, and
 * neither the supplier nor the container number is anywhere near this function.
 */
function customerStageHistory(stageHistory = []) {
  const earliest = new Map();
  for (const entry of stageHistory || []) {
    const mapped = CUSTOMER_STAGES[entry?.stage];
    if (!mapped || !entry.date) continue;
    const seen = earliest.get(mapped.key);
    if (!seen || new Date(entry.date) < new Date(seen.date)) {
      earliest.set(mapped.key, {
        stage: mapped.key,
        label: mapped.label,
        date: entry.date,
        note: entry.note || '',
      });
    }
  }
  return CUSTOMER_STAGE_ORDER.filter((key) => earliest.has(key)).map((key) => earliest.get(key));
}

const shipmentSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true },
    name:      { type: String, required: [true, 'Shipment name is required'], trim: true, maxlength: 120 },
    supplier:  { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    origin:    { type: String, trim: true, maxlength: 60, default: 'China' },
    // Internal logistics detail — never shown to customers.
    containerNumber: { type: String, trim: true, maxlength: 40, uppercase: true },
    expectedArrival: { type: Date, default: null },

    stage: { type: String, enum: SHIPMENT_STAGES, default: SHIPMENT_STAGES[0] },
    stageHistory: [{
      _id:   false,
      stage: { type: String, enum: SHIPMENT_STAGES, required: true },
      note:  { type: String, trim: true, maxlength: 300, default: '' },
      date:  { type: Date, default: Date.now },
      updatedBy: {
        name: { type: String, trim: true, default: '' },
        role: { type: String, trim: true, default: '' },
      },
    }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Same atomic-counter approach as Sale.saleNumber (T47) — a count-based reference
// collides the moment two people create a shipment at once.
shipmentSchema.statics.ensureReferenceCounter = async function (date = new Date()) {
  const period = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const key = `shipment:${period}`;
  if (await Counter.exists({ _id: key })) return;

  const last = await this.findOne({ reference: new RegExp(`^SHP-${period}-\\d+$`) })
    .sort({ reference: -1 })
    .select('reference')
    .lean();
  await Counter.ensure(key, last ? Number(last.reference.split('-').pop()) || 0 : 0);
};

shipmentSchema.pre('save', async function (next) {
  if (!this.isNew || this.reference) return next();
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seq = await Counter.next(`shipment:${period}`, this.$session());
  this.reference = `SHP-${period}-${String(seq).padStart(5, '0')}`;
  next();
});

shipmentSchema.index({ stage: 1, expectedArrival: 1 });
shipmentSchema.index({ createdAt: -1 });

const Shipment = mongoose.model('Shipment', shipmentSchema);

module.exports = Shipment;
module.exports.SHIPMENT_STAGES = SHIPMENT_STAGES;
module.exports.STAGE_LABELS = STAGE_LABELS;
module.exports.CUSTOMER_STAGES = CUSTOMER_STAGES;
module.exports.CUSTOMER_STAGE_ORDER = CUSTOMER_STAGE_ORDER;
module.exports.customerStageHistory = customerStageHistory;
