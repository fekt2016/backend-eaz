const mongoose = require("mongoose");

const deliveryZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Zone name is required"],
      unique: true,
      trim: true,
    },
    fee: {
      type: Number,
      required: [true, "Delivery fee is required"],
      min: [0, "Delivery fee cannot be negative"],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Delivery fee must be a whole number in pesewas",
      },
    },
    estimatedDays: {
      type: Number,
      required: [true, "Estimated delivery days are required"],
      min: [1, "Estimated delivery days must be at least 1"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

deliveryZoneSchema.index({ isActive: 1 });

module.exports = mongoose.model("DeliveryZone", deliveryZoneSchema);
