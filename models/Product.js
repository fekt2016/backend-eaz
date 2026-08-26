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

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ isActive: 1 });
// Unique SKU — but only for non-empty SKUs (sku defaults to "" and is optional).
// Run `npm run check:duplicate-skus` before deploying so this index can build.
productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $gt: "" } } });

module.exports = mongoose.model("Product", productSchema);
