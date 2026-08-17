const mongoose = require("mongoose");

const productReviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product is required"],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    comment: {
      type: String,
      required: [true, "Review comment is required"],
      trim: true,
      minlength: [10, "Review must be at least 10 characters"],
      maxlength: [2000, "Review cannot exceed 2000 characters"],
    },
    approved: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// One review per user per product — the unique index backstops the
// controller-level pre-check against a race where two POSTs land at once.
productReviewSchema.index({ product: 1, user: 1 }, { unique: true });
// Public list reads approved reviews newest-first per product.
productReviewSchema.index({ product: 1, approved: 1, createdAt: -1 });

module.exports = mongoose.model("ProductReview", productReviewSchema);
