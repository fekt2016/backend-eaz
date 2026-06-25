const mongoose = require("mongoose");

const domainOrderSchema = new mongoose.Schema(
  {
    // ── Owner reference ──────────────────────────────────────────────
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required"],
    },
    domain: {
      type: String,
      required: [true, "Domain name is required"],
      trim: true,
      lowercase: true,
    },
    tld: {
      type: String,
      required: [true, "TLD is required"],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price must be positive"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    customerName: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    registrantInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    years: {
      type: Number,
      default: 1,
      min: 1,
      max: 10,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    paymentId: {
      type: String,
      trim: true,
    },
    paystackReference: {
      type: String,
      trim: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    registrationError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

domainOrderSchema.index({ user: 1, createdAt: -1 });
domainOrderSchema.index({ email: 1, createdAt: -1 });
domainOrderSchema.index({ status: 1 });
domainOrderSchema.index({ paystackReference: 1 });
domainOrderSchema.index({ paymentId: 1 });

module.exports = mongoose.model("DomainOrder", domainOrderSchema);
