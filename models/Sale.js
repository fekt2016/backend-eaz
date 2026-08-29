const mongoose = require('mongoose');
const Counter  = require('./Counter');

const saleItemSchema = new mongoose.Schema({
  part:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name:        { type: String, required: true },      // snapshot — never changes
  barcode:     { type: String },
  sku:         { type: String },
  quantity:    { type: Number, required: true, min: 1 },
  unitPrice:   { type: Number, required: true, min: 0 },
  subtotal:    { type: Number, required: true, min: 0 },
}, { _id: false });

const saleSchema = new mongoose.Schema(
  {
    saleNumber:    { type: String, unique: true },
    items:         [saleItemSchema],
    subtotal:      { type: Number, required: true, min: 0 },
    discount:      { type: Number, default: 0, min: 0 },
    total:         { type: Number, required: true, min: 0 },

    paymentMethod: { type: String, enum: ['cash', 'momo', 'card', 'split'], required: true },
    amountPaid:    { type: Number, required: true, min: 0 },
    changeDue:     { type: Number, default: 0, min: 0 },
    momoReference: { type: String, trim: true, maxlength: 100 },

    // Optional customer link (walk-in or registered)
    customer:      { type: mongoose.Schema.Types.ObjectId, ref: 'PosCustomer' },
    customerName:  { type: String, trim: true, maxlength: 100 },

    cashier:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Receipt metadata — stored so receipt can be reprinted any time
    receiptPrinted:{ type: Boolean, default: false },
    notes:         { type: String, trim: true, maxlength: 300 },

    // Void support
    voided:        { type: Boolean, default: false },
    voidedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    voidedAt:      { type: Date },
    voidReason:    { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true }
);

// 'YYYYMM' — the period a sale number belongs to, and the counter key behind it.
function periodOf(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Prepare this month's counter. Must run OUTSIDE the sale transaction (see
// Counter.ensure), so createSale calls it before opening one. Seeds from the
// highest number already issued this month, so sales numbered under the old
// countDocuments() scheme never get a number handed out a second time.
saleSchema.statics.ensureNumberCounter = async function (date = new Date()) {
  const period = periodOf(date);
  const key    = `sale:${period}`;
  if (await Counter.exists({ _id: key })) return;

  const last = await this.findOne({ saleNumber: new RegExp(`^SAL-${period}-\\d+$`) })
    .sort({ saleNumber: -1 })
    .select('saleNumber')
    .lean();

  await Counter.ensure(key, last ? Number(last.saleNumber.split('-').pop()) || 0 : 0);
};

// Auto-generate sale number before save. The number comes from an atomic
// counter, not a document count: a count is read-modify-write, so two cashiers
// checking out at the same moment produced the same number and the unique index
// rejected one of them with E11000 (T47). A counter also never reissues a number
// after a sale is deleted, and never reuses a voided sale's.
saleSchema.pre('save', async function (next) {
  if (!this.isNew || this.saleNumber) return next();

  const period = periodOf();
  // $session() carries createSale's transaction, so the counter and the sale
  // commit together — or neither does, leaving no gap in the numbering.
  const seq = await Counter.next(`sale:${period}`, this.$session());
  this.saleNumber = `SAL-${period}-${String(seq).padStart(5, '0')}`;
  next();
});

saleSchema.index({ createdAt: -1 });
saleSchema.index({ cashier: 1, createdAt: -1 });
saleSchema.index({ 'items.part': 1 });

module.exports = mongoose.model('Sale', saleSchema);
