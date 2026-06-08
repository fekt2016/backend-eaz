const mongoose = require('mongoose');

const posCustomerSchema = new mongoose.Schema(
  {
    name:    { type: String, trim: true, maxlength: 100 },
    phone:   { type: String, required: true, trim: true, maxlength: 20, unique: true },
    email:   { type: String, trim: true, lowercase: true, maxlength: 254 },
    address: { type: String, trim: true, maxlength: 200 },
    notes:   { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

posCustomerSchema.index({ name: 'text', phone: 'text', email: 'text' });

module.exports = mongoose.model('PosCustomer', posCustomerSchema);
