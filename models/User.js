const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: ["superadmin", "admin", "user", "staff", "cashier", "technician"],
      default: "user",
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verifyPin: {
      type: String,
      select: false,
    },
    verifyPinExpires: {
      type: Date,
      select: false,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorPin: {
      type: String,
      select: false,
    },
    twoFactorPinExpires: {
      type: Date,
      select: false,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockedReason: {
      type: String,
      default: "",
    },
    // ── Registered domains ───────────────────────────────────────────
    domains: [
      {
        domain: {
          type: String,
          required: true,
          trim: true,
          lowercase: true,
        },
        orderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DomainOrder",
        },
        years: {
          type: Number,
          default: 1,
        },
        registeredAt: {
          type: Date,
          default: Date.now,
        },
        expiresAt: {
          type: Date,
        },
        status: {
          type: String,
          enum: ["active", "expired", "failed"],
          default: "active",
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

userSchema.index({ role: 1 });
userSchema.index({ isBlocked: 1 });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.generateAuthToken = function () {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(
    { id: this._id, email: this.email, role: this.role },
    secret,
    { expiresIn },
  );
};

module.exports = mongoose.model("User", userSchema);
