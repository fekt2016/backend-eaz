const mongoose = require('mongoose');

const partSchema = new mongoose.Schema(
  {
    name:              { type: String, required: true, trim: true, maxlength: 150 },
    sku:               { type: String, trim: true, maxlength: 50 },
    barcode:           { type: String, trim: true, maxlength: 100 },
    category: {
      type: String,
      enum: ['Screen', 'Battery', 'Charging Port', 'Speaker', 'Camera', 'Button',
             'Housing', 'Board', 'Accessory', 'Cable', 'IC / Chip', 'Other'],
      default: 'Other',
    },
    isRetail:          { type: Boolean, default: false }, // true = sellable over counter
    quantity:          { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 3, min: 0 },
    allowNegativeStock:{ type: Boolean, default: false }, // admin override
    // Prices are stored as integer minor units (pesewas): GH₵1.00 = 100.
    costPrice:         {
      type: Number, required: true, min: 0,
      validate: { validator: (v) => Number.isInteger(v), message: 'Cost price must be a whole number of pesewas' },
    },
    sellingPrice:      {
      type: Number, required: true, min: 0,
      validate: { validator: (v) => Number.isInteger(v), message: 'Selling price must be a whole number of pesewas' },
    },
    supplier:          { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    compatibleWith:    [{ type: String, trim: true, maxlength: 100 }],
    description:       { type: String, trim: true, maxlength: 1000, default: '' },
    images:            [{ type: String, trim: true }],
    notes:             { type: String, trim: true, maxlength: 500 },
    // T48 popularity counters, mirroring models/Product.js — a retail part is
    // listed in the shop next to products, so it needs the same figures or its
    // card reads blank beside theirs. Server-owned: bumped by the view endpoint
    // and by the same update that deducts stock on a sale, never read off a
    // client payload. `min` is documentation — $inc skips validators, so the
    // decrement path clamps instead.
    views:             { type: Number, default: 0, min: [0, 'Views cannot be negative'] },
    sold:              { type: Number, default: 0, min: [0, 'Sold cannot be negative'] },
  },
  { timestamps: true }
);

// Give a unit back to `sold` when a sale is reversed (order cancelled, POS sale
// voided). Pipeline update so the clamp is atomic: parts sold before these
// counters existed have no `sold` field at all, and a plain $inc of -qty would
// drive them negative.
partSchema.statics.decrementSold = function (partId, qty, session) {
  return this.updateOne(
    { _id: partId },
    [{ $set: { sold: { $max: [0, { $subtract: [{ $ifNull: ['$sold', 0] }, qty] }] } } }],
    session ? { session } : {},
  );
};

partSchema.index({ barcode: 1 }, { sparse: true }); // fast barcode lookup
partSchema.index({ name: 'text', sku: 'text', barcode: 'text' });
partSchema.index({ isRetail: 1, quantity: 1 });
// Unique SKU — but only for non-empty SKUs (many parts have no SKU). Run
// `npm run check:duplicate-skus` before deploying so this index can build.
partSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $gt: '' } } });

module.exports = mongoose.model('Part', partSchema);
