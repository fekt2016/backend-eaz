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
  },
  {
    timestamps: true,
    // variant.attributes is a Map — flatten it to a plain object in every
    // response so the API serves { color: "Black" }, not an empty {}.
    toObject: { flattenMaps: true },
    toJSON: { flattenMaps: true },
  },
);

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ isActive: 1 });
// Unique SKU — but only for non-empty SKUs (sku defaults to "" and is optional).
// Run `npm run check:duplicate-skus` before deploying so this index can build.
productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $gt: "" } } });

module.exports = mongoose.model("Product", productSchema);
