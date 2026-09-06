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
    // ── Phone ownership (T84) ────────────────────────────────────────────────
    // A phone number binds to an account only once the account has proven it
    // controls the number. Guest shop orders are matched to an account by
    // phone, so an unproven number is a claim on someone else's order history.
    // Registration only ever sends its PIN to ONE identifier, so `isVerified`
    // says nothing about the phone — hence a field of its own.
    phoneVerifiedAt: {
      type: Date,
      default: null,
    },
    // The number awaiting confirmation. The live `phone` is left untouched until
    // the PIN lands, so a failed or abandoned change cannot orphan the account.
    pendingPhone: {
      type: String,
      trim: true,
      default: '',
      select: false,
    },
    pendingPhonePin: {
      type: String,
      select: false,
    },
    pendingPhonePinExpires: {
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
    // ── Account deactivation (owner request, 2026-08-30) ──────────────────
    // Reversible by decision: a customer who deactivates keeps their orders and
    // history, and an admin can switch them back on. Distinct from `isBlocked`,
    // which is a staff action against a user — this one is the user's own
    // choice, and the two need different messages and different audit trails.
    isActive: {
      type: Boolean,
      default: true,
    },
    deactivatedAt: { type: Date, default: null },
    deactivationReason: { type: String, maxlength: 500, default: '' },

    // ── Ghana Card identity verification (manual admin review) ────────────
    // Government ID, so it is handled differently from every other upload here:
    //  - `number` is `select: false`. It is never returned by a normal read;
    //    responses carry a masked form instead.
    //  - the images are stored as Cloudinary public_ids with
    //    `type: 'authenticated'`, NOT as public URLs. Every other upload in this
    //    app is world-readable to anyone holding the link, which is fine for a
    //    product photo and not for someone's national ID. Admins fetch a
    //    short-lived signed URL through a dedicated endpoint.
    ghanaCard: {
      number: { type: String, select: false, default: '' },
      frontImageId: { type: String, default: '' },
      backImageId: { type: String, default: '' },
      status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none',
      },
      submittedAt: { type: Date, default: null },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      rejectionReason: { type: String, maxlength: 500, default: '' },
    },

    // T91 — bumped whenever every existing session for this account must stop
    // working: logout, a self-service password change, an admin password reset,
    // and the forgot-password flow. The value is stamped into the JWT and
    // compared in `protect`, so a token minted before the bump is refused.
    //
    // An int, not a deny-list: this runs as a single app instance with no Redis, and
    // a version compare costs nothing on a lookup `protect` already does. The
    // trade-off is that logout ends EVERY session for the account rather than
    // just the calling device — which is the behaviour someone hitting "log
    // out" because they think they are compromised actually wants.
    tokenVersion: {
      type: Number,
      default: 0,
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
        // The priced delivery area (models/Neighborhood.js). Stored so a saved
        // address resolves to a shipping zone on its own, without the customer
        // re-picking their area every time they select it.
        neighborhoodId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Neighborhood",
          default: null,
        },
        city: {
          type: String,
          trim: true,
          maxlength: 120,
        },
        // Region is REQUIRED for pricing: it decides whether the address is in
        // the Greater-Accra delivery core or is a regional bus-station pickup.
        // It used to be dropped on save, so re-selecting a saved address
        // produced an empty region, an empty city list, and no delivery options
        // at all — with no error anywhere.
        region: {
          type: String,
          trim: true,
          maxlength: 120,
          default: "",
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

// Cost 12 is the production figure and does not move: it is what makes a stolen
// hash expensive to attack, and it is baked into every password already stored.
//
// Under test it is the single largest cost in the suite. One hash takes ~377ms,
// and the suites create users in loops — usersPagination alone creates 31 in one
// test, which is 11.7 SECONDS of hashing on an idle machine and comfortably past
// the 30s timeout once workers compete for CPU. That test failed in every full
// run for this reason, then dragged the two after it down with the state it left
// behind. Cost 4 hashes in ~2ms and exercises exactly the same code path —
// nothing in the suite asserts the work factor, only that a password round-trips.
const BCRYPT_COST = process.env.NODE_ENV === "test" ? 4 : 12;

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_COST);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

/**
 * T88 — whether this account is still waiting on its emailed/texted PIN.
 *
 * NOT simply `!isVerified`. Accounts that predate the PIN system have
 * `isVerified: false` and no `verifyPin`, and they are treated as verified —
 * `login` has always worked this way. Refusing on `!isVerified` alone would lock
 * every one of those accounts out of every endpoint while still letting them log
 * in, which is worse than the hole it closes.
 *
 * `verifyPin` is `select: false`, so a caller must select it explicitly or this
 * always reports false. `protect` and `login` both do.
 */
// T91 — any password change ends every existing session for the account.
//
// A hook rather than three increments in the controllers: self-service change,
// admin reset and the forgot-password flow all end up here, and a fourth path
// added later inherits it instead of having to remember. `isNew` is excluded so
// a freshly created account starts at version 0 rather than 1.
userSchema.pre('save', function bumpTokenVersionOnPasswordChange(next) {
  if (!this.isNew && this.isModified('password')) {
    this.tokenVersion = (this.tokenVersion || 0) + 1;
  }
  next();
});

/**
 * A Ghana Card number is PII. Responses show only the last four characters, in
 * the card's own shape, so a user can recognise which card they submitted
 * without the full number travelling to the browser or into a log.
 */
userSchema.methods.maskedGhanaCardNumber = function () {
  const n = this.ghanaCard && this.ghanaCard.number;
  if (!n) return '';
  const tail = String(n).slice(-4);
  return `GHA-•••••••-${tail.slice(-1) || '•'}`.replace('•••••••', '•'.repeat(7));
};

userSchema.methods.needsVerification = function () {
  return this.isVerified === false && Boolean(this.verifyPin);
};

userSchema.methods.generateAuthToken = function () {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(
    // `tv` is the token version (T91). protect compares it with the user's
    // current tokenVersion and refuses anything stale.
    { id: this._id, email: this.email, role: this.role, tv: this.tokenVersion || 0 },
    secret,
    { expiresIn },
  );
};

module.exports = mongoose.model("User", userSchema);
