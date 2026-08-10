const mongoose = require('mongoose');

const posPaymentSchema = new mongoose.Schema(
  {
    job:        { type: mongoose.Schema.Types.ObjectId, ref: 'RepairJob', required: true },
    amount:     { type: Number, required: true, min: 0 },
    method:     { type: String, enum: ['cash', 'momo', 'card'], required: true },
    reference:  { type: String, trim: true, maxlength: 100 },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes:      { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PosPayment', posPaymentSchema);
