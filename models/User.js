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
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
      // No `required`/field-level `unique` here (T17: registration allows
      // phone-only accounts with no email at all) — uniqueness for non-empty
      // emails only is enforced by the partial-unique index defined below,
      // same pattern as `phone`.
    },
    phone: {
      type: String,
      trim: true,
      // No field-level `sparse` index here: uniqueness (for non-empty phones
      // only) is enforced by the partial-unique index defined below. A field
      // `sparse:true` would generate a second `phone_1` index and collide with it.
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: ["superadmin", "admin", "user", "staff", "technician"],
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
    // ── Saved shipping addresses ──────────────────────────────────────
    shippingAddresses: [
      {
        label: {
          type: String,
          trim: true,
          maxlength: 60,
          default: "",
        },
        street: {
          type: String,
          trim: true,
          maxlength: 200,
        },
        neighborhood: {
          type: String,
          trim: true,
          maxlength: 120,
        },
        city: {
          type: String,
          trim: true,
          maxlength: 120,
        },
        isDefault: {
          type: Boolean,
          default: false,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
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
// Unique phone — but only for non-empty string phones (many accounts have none;
// absent/"" values must never collide). Store phones in canonical 0XXXXXXXXX form
// (see utils/sanitize.sanitizePhone). Run `npm run check:duplicate-phones` before
// deploying so this index can build.
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } },
);
// Unique email — same partial pattern as phone above (T17). The DATA is already
// compatible (email was `required`+`unique` before this change, so every existing
// document has a distinct non-empty value), but the INDEX is not: a pre-T17
// database still carries a plain unique `email_1`, and autoIndex cannot replace it
// (same name + different options → IndexKeySpecsConflict). The old index then
// survives and rejects the second email-less account with a `{ email: null }`
// duplicate-key error. Run `npm run migrate:user-email-index` against any existing
// database before deploying this. Same situation as `phone` above, whose legacy
// index is handled by `npm run migrate:user-phones`.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } },
);

// T17: registration allows either identifier, but not neither.
userSchema.pre("validate", function (next) {
  if (!this.email && !this.phone) {
    this.invalidate("email", "Provide an email or phone number.");
  }
  next();
});

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
