const mongoose = require('mongoose');

/**
 * Customer-facing order placed on the public /track/:token page for a repair
 * job that has no payment yet. Groups one or more parts the customer chooses
 * from the shop's inventory, plus an optional rider shipping fee when the
 * device is being collected/delivered by a rider (job.dropoff === 'rider').
 *
 * Money units:
 *   - item.unitPriceGhs      → Part.sellingPrice (major GHS)
 *   - item.subtotalPesewas   → unitPriceGhs × qty × 100
 *   - subtotalPesewas        → sum of item subtotals
 *   - shippingFeePesewas     → DeliveryZone.fee (already in pesewas)
 *   - totalPesewas           → subtotal + shipping (Paystack amount)
 *
 * Created via POST /track/:token/orders; fulfilled idempotently by the
 * Paystack webhook, which adds the paid parts to the job, records a
 * PosPayment, and flags the job as waiting_for_parts.
 */
const repairOrderSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'RepairJob', required: true },

    items: [
      {
        part:        { type: mongoose.Schema.Types.ObjectId, ref: 'Part' },
        partName:    { type: String, required: true, trim: true, maxlength: 150 },
        quantity:    { type: Number, default: 1, min: 1, max: 10 },
        unitPriceGhs:{ type: Number, required: true, min: 0 },
        subtotalPesewas: { type: Number, required: true, min: 0 },
      },
    ],

    deliveryZone:    { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryZone' },
    shippingFeePesewas: { type: Number, default: 0, min: 0 },
    subtotalPesewas:    { type: Number, required: true, min: 0 },
    totalPesewas:       { type: Number, required: true, min: 0 },

    customerName:  { type: String, trim: true, maxlength: 100 },
    customerPhone: { type: String, required: true, trim: true },

    status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },

    paystackReference: { type: String, trim: true, unique: true, sparse: true },
    paidAt:            { type: Date },
  },
  { timestamps: true }
);

repairOrderSchema.index({ job: 1, status: 1 });

module.exports = mongoose.model('RepairOrder', repairOrderSchema);