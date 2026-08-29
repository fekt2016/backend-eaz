const mongoose = require('mongoose');

/**
 * Customer-facing part order for a repair job.
 *
 * Money units: all three fields are integer pesewas (matches `subtotalPesewas`,
 * used for Paystack checks). `unitPricePesewas`/`amountPesewas` are separate
 * from `subtotalPesewas` only because the latter is the authoritative charge
 * amount sent to Paystack; the other two are a display-friendly breakdown.
 *
 * Created via the public /track/:token page; fulfilled idempotently by the
 * Paystack webhook, which records a PosPayment and flags the job as
 * waiting_for_parts.
 */
const partOrderSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairJob', required: true },

    // Inventory link is optional — a job may use a custom, non-stocked part.
    part:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    partName:    { type: String, required: true, trim: true, maxlength: 150 },

    quantity:         { type: Number, default: 1, min: 1, max: 10 },
    unitPricePesewas: { type: Number, required: true, min: 0 },
    subtotalPesewas:  { type: Number, required: true, min: 0 }, // == amountPesewas (Paystack charge amount)
    amountPesewas:    { type: Number, required: true, min: 0 }, // unitPricePesewas × qty

    customerName:  { type: String, trim: true, maxlength: 100 },
    customerPhone: { type: String, required: true, trim: true },

    status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },

    paystackReference: { type: String, trim: true, unique: true, sparse: true },
    paidAt:            { type: Date },
  },
  { timestamps: true }
);

partOrderSchema.index({ job: 1, status: 1 });

module.exports = mongoose.model('PartOrder', partOrderSchema);
