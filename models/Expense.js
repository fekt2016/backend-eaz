const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    amount:      { type: Number, required: true, min: 0 },
    category:    {
      type: String,
      enum: ['rent', 'utilities', 'tools', 'parts', 'salaries', 'marketing', 'transport', 'maintenance', 'other'],
      default: 'other',
    },
    description: { type: String, trim: true, maxlength: 500, required: true },
    date:        { type: Date, default: Date.now },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes:       { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
