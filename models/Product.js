const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    // T39: one-or-two-line summary shown in the buy column on the product page,
    // above the price. The full `description` lives behind the Description tab.
    // Optional — the storefront falls back to summarising `description` when this
    // is empty, so products created before this field still read sensibly.
    shortDescription: {
      type: String,
      trim: true,
      default: "",
      maxlength: [200, "Short description cannot exceed 200 characters"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Price must be a whole number in pesewas",
      },
    },
    images: {
      type: [String],
      default: [],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
    },
    stock: {
      type: Number,
      required: [true, "Stock is required"],
      min: [0, "Stock cannot be negative"],
      default: 0,
    },
    sku: {
      type: String,
      trim: true,
      default: "",
    },
    // Shipping attributes (shipping charges feature). Read ONLY from the DB by
    // the shipping calculator — never off a client payload. `weight: 0` means
    // "unknown": the calculator prices the line at an assumed 0.5 kg and flags
    // `weightAssumed` on the quote so support can explain the charge.
    weight: {
      type: Number,
      min: [0, "Weight cannot be negative"],
      default: 0,
    },
    weightUnit: {
      type: String,
      enum: { values: ["g", "kg", "lb"], message: "Weight unit must be one of: {VALUES}" },
      default: "kg",
    },
    isFragile: {
      type: Boolean,
      default: false,
    },
    // Structured variants — simple options (color/storage/length/model) as
    // distinct SKUs (Decision #1). Each variant has its own SKU, flexible
    // attribute key-values, stock, and optional images. Products without
    // variants keep today's single-implicit-SKU behaviour via top-level stock.
    variants: {
      type: [
        {
          _id: false,
          sku: { type: String, trim: true, default: "" },
          attributes: { type: Map, of: String, default: {} },
          stock: { type: Number, min: [0, "Stock cannot be negative"], default: 0 },
          images: { type: [String], default: [] },
          // Per-variant price override, in pesewas. `null` (default) means
          // "unset" — resolve to the product's base price. Distinct from an
          // explicit `0`, which is a legitimately free variant.
          price: {
            type: Number,
            min: [0, "Price cannot be negative"],
            default: null,
            validate: {
              validator: (v) => v == null || Number.isInteger(v),
              message: "Variant price must be a whole number in pesewas",
            },
          },
          // Per-variant pre-order (independent of the product-level one). When a
          // specific variant runs out of stock — while another size/colour still
          // has stock — checkout should offer a pre-order for THAT variant alone
          // rather than gate the whole product on a single boolean. `enabled`
          // defaults to null: null/false means "not a pre-order variant", and a
          // product-level preorder (if any) still applies. When set, its fields
          // override the product-level note/date/max for this variant.
          preorder: {
            enabled: { type: Boolean, default: null },
            // Expected availability, shown on the storefront. Null = no date.
            availableFrom: { type: Date, default: null },
            // Free text, e.g. "ships from abroad, ~3 weeks".
            note: { type: String, trim: true, default: "", maxlength: [200, "Pre-order note cannot exceed 200 characters"] },
            // Per-line cap for constrained supply. Null = uncapped.
            maxQty: { type: Number, default: null, min: [1, "Pre-order cap must be at least 1"] },
          },
        },
      ],
      default: [],
    },
    // Gallery media (Cloudinary URLs). Additive and separate from the hero
    // `images[0]` used by listing cards — a product without a gallery keeps the
    // exact hero behaviour from before.
    gallery: {
      type: new mongoose.Schema(
        {
          images: { type: [String], default: [] },
          videos: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    // Optional structured specs rendered on the product detail page. Additive
    // only — existing products without specs just render no Specifications
    // section. Array of {label, value} keeps display order intact (a Map would
    // not) and matches the other simple list fields on this schema.
    specs: {
      type: [
        {
          _id: false,
          label: { type: String, trim: true },
          value: { type: String, trim: true },
        },
      ],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // T45 — pre-order. When `enabled`, checkout lets a customer buy this product
    // with no stock on hand: they pay in full up front (same Paystack flow as any
    // order) and the line sits in a release queue until the stock lands and staff
    // release it. A nested schema with its own default so products created before
    // T45 read as `{ enabled: false }` rather than undefined.
    preorder: {
      type: new mongoose.Schema(
        {
          enabled: { type: Boolean, default: false },
          // Expected availability, shown on the storefront. Null = "no date yet".
          availableFrom: { type: Date, default: null },
          // Free text shown under the badge, e.g. "ships from abroad, ~3 weeks".
          note: { type: String, trim: true, default: "", maxlength: [200, "Pre-order note cannot exceed 200 characters"] },
          // Per-line cap for constrained supply. Null = uncapped. Enforced
          // server-side at checkout, never only in the UI.
          maxQty: { type: Number, default: null, min: [1, "Pre-order cap must be at least 1"] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    // ── Inventory / POS fields (merged from the retired Part model) ──────
    // A shop product and a repair part are the same thing — something we stock
    // and sell — reached from two directions. These fields came from Part so a
    // single record can be rung up at the counter, listed online, or fitted on
    // a repair job without a second document or an adapter in between.

    // What we paid, in pesewas. Parts always carried this; products never did,
    // which left every counter-sold product invisible to COGS and inventory
    // valuation. Defaults to 0 = "cost unknown" — reports must exclude those
    // lines rather than assume a margin. Products migrated before costs were
    // captured read 0 until someone fills them in.
    costPrice: {
      type: Number,
      default: 0,
      min: [0, "Cost price cannot be negative"],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "Cost price must be a whole number in pesewas",
      },
    },
    // Scanner lookup. Products had no barcode at all, so a cashier could not
    // scan one — the POS search matched barcodes for parts only.
    barcode: {
      type: String,
      trim: true,
      maxlength: [100, "Barcode cannot exceed 100 characters"],
      default: "",
    },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    // Devices a repair part fits ("iPhone 14", "Redmi Note 12"). Empty for
    // ordinary shop stock.
    compatibleWith: [{ type: String, trim: true, maxlength: 100 }],
    // Repair taxonomy (Screen, Battery, …), deliberately separate from the
    // shop-facing `category` above (Phones, Accessories, …): they are different
    // namespaces, which is why the old catalogue union refused to mix them.
    // Null on ordinary shop stock.
    partCategory: {
      type: String,
      enum: {
        values: ["Screen", "Battery", "Charging Port", "Speaker", "Camera", "Button",
                 "Housing", "Board", "Accessory", "Cable", "IC / Chip", "Other"],
        message: "Part category must be one of: {VALUES}",
      },
      default: null,
    },
    lowStockThreshold: { type: Number, default: 0, min: [0, "Threshold cannot be negative"] },
    // Admin override letting stock go below zero (back-ordered bench parts).
    allowNegativeStock: { type: Boolean, default: false },
    // Internal note — never shown to customers.
    notes: { type: String, trim: true, maxlength: [500, "Notes cannot exceed 500 characters"], default: "" },

    // ── Where this item may be sold ──────────────────────────────────────
    // Behaviour, not type. The old split forced "is it a Product or a Part?"
    // when the real questions are where it can be sold and whether it can go on
    // a repair job — and an item can answer yes to all three.
    //
    // sellOnline  — listed in the shop  (was Product.isActive)
    // sellInStore — offered in POS search/scan  (was Part.isRetail)
    // useInRepairs — selectable as a job part  (was: being a Part at all)
    sellOnline:   { type: Boolean, default: true },
    sellInStore:  { type: Boolean, default: true },
    useInRepairs: { type: Boolean, default: false },

    // T48 — popularity counters. Both move only through $inc from the server
    // (detail-page reads, and the same update that deducts stock on a sale);
    // neither is ever read off a client payload, so create/update must keep
    // ignoring them. `min` is documentation here rather than enforcement: $inc
    // is a raw update and skips validators, so the decrement paths clamp.
    views: {
      type: Number,
      default: 0,
      min: [0, "Views cannot be negative"],
    },
    sold: {
      type: Number,
      default: 0,
      min: [0, "Sold cannot be negative"],
    },
  },
  {
    timestamps: true,
    // variant.attributes is a Map — flatten it to a plain object in every
    // response so the API serves { color: "Black" }, not an empty {}.
    toObject: { flattenMaps: true },
    toJSON: { flattenMaps: true },
  },
);

// Give a unit of stock back to `sold` when a sale is reversed (order cancelled,
// POS sale voided). A pipeline update so the clamp is atomic: orders paid before
// T48 shipped deducted stock without ever bumping `sold`, so a plain $inc of -qty
// would drive those products negative when they are cancelled now.
productSchema.statics.decrementSold = function (productId, qty, session) {
  return this.updateOne(
    { _id: productId },
    [{ $set: { sold: { $max: [0, { $subtract: [{ $ifNull: ["$sold", 0] }, qty] }] } } }],
    session ? { session } : {},
  );
};

/**
 * Auto-slug from the name when none is given. The shop has always supplied its
 * own slug; the POS inventory screens (which used to create Parts, a model with
 * no slug) supply only a name. Uniqueness is enforced by the index below — this
 * appends the document's own id tail on collision, which cannot clash.
 */
/**
 * `isActive` is the admin's on/off switch and its soft-delete — it predates the
 * channel flags and the admin UI still writes it. Keep `sellOnline` in step
 * unless the caller set it deliberately, so turning a product off (or deleting
 * it) still takes it out of the shop.
 */
productSchema.pre("validate", function syncSellOnlineWithIsActive(next) {
  if (this.$isDefault("sellOnline")) this.sellOnline = this.isActive;
  return next();
});

productSchema.pre("validate", async function ensureSlug(next) {
  if (this.slug) return next();
  const base =
    String(this.name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";

  const taken = await this.constructor.exists({ slug: base, _id: { $ne: this._id } });
  this.slug = taken ? `${base}-${String(this._id).slice(-6)}` : base;
  return next();
});

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ isActive: 1 });
// Channel lookups: the shop lists sellOnline, POS searches sellInStore, the
// job-parts picker uses useInRepairs. Each is the first filter of its query.
productSchema.index({ sellOnline: 1 });
productSchema.index({ sellInStore: 1 });
productSchema.index({ useInRepairs: 1 });
// Barcode scan — sparse because most shop stock has none. Carried over from
// models/Part.js, which indexed it the same way.
productSchema.index({ barcode: 1 }, { sparse: true });
// POS low-stock filter reads threshold against stock.
productSchema.index({ partCategory: 1 });
// Unique SKU — but only for non-empty SKUs (sku defaults to "" and is optional).
// Run `npm run check:duplicate-skus` before deploying so this index can build.
productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $gt: "" } } });

module.exports = mongoose.model("Product", productSchema);
