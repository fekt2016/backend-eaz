const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    lineId: { type: String, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },      // pesewas at time of add
    image: { type: String, default: '' },
    category: { type: String, default: '' },
    stock: { type: Number, default: 0 },
    qty: { type: Number, default: 1, min: 1 },
    variant: {
      sku: String,
      attributes: mongoose.Schema.Types.Mixed,
      _id: false,
    },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,                    // one cart per user
    },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
