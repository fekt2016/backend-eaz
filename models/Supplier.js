const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true, maxlength: 100 },
    contactPerson: { type: String, trim: true, maxlength: 100 },
    phone:         { type: String, trim: true, maxlength: 30 },
    email:         { type: String, trim: true, lowercase: true, maxlength: 100 },
    address:       { type: String, trim: true, maxlength: 300 },
    notes:         { type: String, trim: true, maxlength: 500 },
    isActive:      { type: Boolean, default: true },
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

supplierSchema.index({ name: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);
