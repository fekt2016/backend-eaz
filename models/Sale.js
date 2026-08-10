const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  part:        { type: mongoose.Schema.Types.ObjectId, ref: 'Part' },
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

// Auto-generate sale number before save
saleSchema.pre('save', async function (next) {
  if (this.isNew) {
    const count = await mongoose.model('Sale').countDocuments();
    const pad   = String(count + 1).padStart(5, '0');
    const year  = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    this.saleNumber = `SAL-${year}${month}-${pad}`;
  }
  next();
});

saleSchema.index({ createdAt: -1 });
saleSchema.index({ cashier: 1, createdAt: -1 });
saleSchema.index({ 'items.part': 1 });

module.exports = mongoose.model('Sale', saleSchema);
