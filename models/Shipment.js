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

// The staff-facing journey, in order. Kept as a fixed list so a shipment's
// position is comparable across batches — free text could not tell you which
// shipments are late.
const SHIPMENT_STAGES = [
  'ordered',         // order placed with the supplier
  'production',      // supplier is making/assembling it
  'ready_supplier',  // finished, sitting at the supplier's warehouse
  'at_port_origin',  // delivered to the origin port, awaiting a container
  'in_transit',      // sailing
  'arrived_port',    // landed at the destination port (Tema)
  'customs',         // clearing customs / duties
  'at_shop',         // received at the shop — pre-orders can now be released
];

const STAGE_LABELS = {
  ordered:        'Ordered with supplier',
  production:     'In production',
  ready_supplier: 'Ready at supplier',
  at_port_origin: 'At origin port',
  in_transit:     'In transit',
  arrived_port:   'Arrived at port',
  customs:        'Clearing customs',
  at_shop:        'Received at shop',
};

/**
 * What a customer is shown. Eight operational stages collapse into four that mean
 * something to someone waiting: supplier detail, container numbers and internal
 * notes never cross this line.
 */
const CUSTOMER_STAGES = {
  ordered:        { key: 'preparing', label: 'Preparing with our supplier' },
  production:     { key: 'preparing', label: 'Preparing with our supplier' },
  ready_supplier: { key: 'preparing', label: 'Preparing with our supplier' },
  at_port_origin: { key: 'on_the_way', label: 'On its way' },
  in_transit:     { key: 'on_the_way', label: 'On its way' },
  arrived_port:   { key: 'in_ghana',   label: 'Arrived in Ghana — clearing customs' },
  customs:        { key: 'in_ghana',   label: 'Arrived in Ghana — clearing customs' },
  at_shop:        { key: 'at_shop',    label: 'At our shop — preparing your order' },
};

const shipmentSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true },
    name:      { type: String, required: [true, 'Shipment name is required'], trim: true, maxlength: 120 },
    supplier:  { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    origin:    { type: String, trim: true, maxlength: 60, default: 'China' },
    // Internal logistics detail — never shown to customers.
    containerNumber: { type: String, trim: true, maxlength: 40, uppercase: true },
    expectedArrival: { type: Date, default: null },

    stage: { type: String, enum: SHIPMENT_STAGES, default: 'ordered' },
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
