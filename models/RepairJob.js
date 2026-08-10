const mongoose = require('mongoose');
const crypto   = require('crypto');

const repairJobSchema = new mongoose.Schema(
  {
    jobNumber: { type: String, unique: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'PosCustomer', required: true },

    deviceType:  { type: String, enum: ['Phone', 'Tablet', 'Laptop', 'Smartwatch', 'Other'], default: 'Phone' },
    deviceBrand: { type: String, trim: true, maxlength: 60 },
    deviceModel: { type: String, trim: true, maxlength: 100 },
    imei:        { type: String, trim: true, maxlength: 20 },
    color:       { type: String, trim: true, maxlength: 40 },

    faultDescription:  { type: String, required: true, trim: true, maxlength: 1000 },
    requiresDiagnosis: { type: Boolean, default: false },
    diagnosisFee:      { type: Number, default: 0, min: 0 },
    diagnosis:         { type: String, trim: true, maxlength: 1000 },
    repairWork:        { type: String, trim: true, maxlength: 1000 }, // what was / will be done

    parts: [
      {
        part:        { type: mongoose.Schema.Types.ObjectId, ref: 'Part' }, // optional inventory link
        name:        { type: String, required: true },
        quantity:    { type: Number, default: 1, min: 1 },
        priceAtTime: { type: Number, default: 0, min: 0 }, // selling price
        costAtTime:  { type: Number, default: 0, min: 0 }, // cost price at time of job
      },
    ],

    laborCost:    { type: Number, default: 0, min: 0 },
    depositPaid:  { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ['received', 'diagnosing', 'waiting_for_parts', 'repairing', 'ready', 'collected', 'cancelled'],
      default: 'received',
    },

    priority:   { type: String, enum: ['normal', 'urgent'], default: 'normal' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    notes:               { type: String, trim: true, maxlength: 1000 },
    estimatedCompletion: { type: Date },
    completedAt:         { type: Date },
    stockDeducted:       { type: Boolean, default: false },

    // ── Warranty ──────────────────────────────────────────
    warrantyDays:    { type: Number, default: 0, min: 0 },
    warrantyExpires: { type: Date },
    warrantyNotes:   { type: String, trim: true, maxlength: 500 },

    // ── Customer tracking link ─────────────────────────
    trackingToken: { type: String, unique: true, sparse: true },

    // ── Uncollected reminders ───────────────────────────
    remindersSent:   { type: Number, default: 0 },       // how many reminders sent so far
    lastReminderAt:  { type: Date },                      // when last reminder was sent

    // ── Device intake photos ────────────────────────────
    photos: [
      {
        url:       { type: String, required: true },
        publicId:  { type: String },
        caption:   { type: String, trim: true, maxlength: 100 },
        uploadedAt:{ type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Auto-generate job number before save
repairJobSchema.pre('save', async function (next) {
  if (this.isNew) {
    const count = await mongoose.model('RepairJob').countDocuments();
    const pad   = String(count + 1).padStart(4, '0');
    const year  = new Date().getFullYear();
    this.jobNumber    = `REP-${year}-${pad}`;
    this.trackingToken = crypto.randomBytes(20).toString('hex');
  }
  next();
});

// 'active' | 'expiring_soon' (≤7 days) | 'expired' | 'none'
repairJobSchema.virtual('warrantyStatus').get(function () {
  if (!this.warrantyDays || !this.warrantyExpires) return 'none';
  const now  = Date.now();
  const exp  = new Date(this.warrantyExpires).getTime();
  if (exp < now) return 'expired';
  if (exp - now <= 7 * 24 * 60 * 60 * 1000) return 'expiring_soon';
  return 'active';
});

repairJobSchema.virtual('totalPartsAmount').get(function () {
  return this.parts.reduce((sum, p) => sum + (p.priceAtTime || 0) * (p.quantity || 1), 0);
});

repairJobSchema.virtual('totalPartsCost').get(function () {
  return this.parts.reduce((sum, p) => sum + (p.costAtTime || 0) * (p.quantity || 1), 0);
});

repairJobSchema.virtual('totalAmount').get(function () {
  return (this.diagnosisFee || 0) + this.laborCost + this.totalPartsAmount;
});

repairJobSchema.virtual('balanceDue').get(function () {
  return Math.max(0, this.totalAmount - this.depositPaid);
});

// Gross profit = revenue (totalAmount) - cost of parts
// Labour is pure profit (no per-job wage cost tracked)
repairJobSchema.virtual('grossProfit').get(function () {
  return this.totalAmount - this.totalPartsCost;
});

repairJobSchema.virtual('profitMarginPct').get(function () {
  if (!this.totalAmount) return 0;
  return Math.round((this.grossProfit / this.totalAmount) * 100);
});

repairJobSchema.index({ status: 1, createdAt: -1 });
repairJobSchema.index({ customer: 1 });
// jobNumber: unique index already created by unique:true on the field
repairJobSchema.index({ imei: 1 }, { sparse: true }); // fast IMEI lookup

module.exports = mongoose.model('RepairJob', repairJobSchema);
