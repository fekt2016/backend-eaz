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
    costPrice:         { type: Number, required: true, min: 0 },
    sellingPrice:      { type: Number, required: true, min: 0 },
    supplier:          { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    compatibleWith:    [{ type: String, trim: true, maxlength: 100 }],
    notes:             { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

partSchema.index({ barcode: 1 }, { sparse: true }); // fast barcode lookup
partSchema.index({ name: 'text', sku: 'text', barcode: 'text' });
partSchema.index({ isRetail: 1, quantity: 1 });

module.exports = mongoose.model('Part', partSchema);
