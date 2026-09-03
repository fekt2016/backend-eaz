const mongoose = require("mongoose");
const Product = require("../models/Product");
const { logFromRequest, ACTIONS, RESOURCES } = require("../services/activityLogService");
// escapeRegex: match user-supplied search text literally (prevents ReDoS).
const { escapeRegex } = require("../utils/regex");
const { formatGhs } = require("../utils/money");
const { getRatingSummary } = require("./productReviewController");
const { nextProductSku, nextVariantSku } = require("../services/skuGenerator");

// Shape a retail Part like a shop product so it flows through the same
// product-detail page, metadata, JSON-LD and cart/checkout. Mirrors the part
// mapping in getProducts. Price stays in integer pesewas.
function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const getProducts = async (req, res, next) => {
  try {
    const { category, q, sort, kind, preorder } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      60,
    );
    const skip = (page - 1) * limit;

    // One collection now holds shop stock, counter stock and bench parts, so
    // the catalogue is a plain query — the $unionWith against `parts` that used
    // to merge two collections here is gone, and with it the whole class of bug
    // where a feature was written for products and forgotten for parts.
    const query = { sellOnline: true };
    const and = [];

    if (category) {
      query.category = category;
    }

    // `preorder=true` narrows the grid to items that can currently be
    // pre-ordered. Variant-aware: a product qualifies via its own pre-order flag
    // OR when any of its variants is a pre-order variant (a 0-stock size among
    // stocked ones, the per-variant case). Both flags default off, so only
    // explicitly-enabled items are matched.
    if (preorder === "true") {
      and.push({
        $or: [
          { "preorder.enabled": true },
          { "variants.preorder.enabled": true },
        ],
      });
    }

    // `kind=product` keeps its meaning: ordinary shop stock only, no repair
    // parts (the homepage strip uses it). A repair part is an item carrying a
    // `partCategory` — the repair taxonomy — which ordinary stock never has.
    if (kind === "product") {
      query.partCategory = null;
    }

    if (q && q.trim()) {
      const search = escapeRegex(q.trim());
      and.push({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
          { sku: { $regex: search, $options: "i" } },
          // `notes` came from the part side of the old union; keeping it means
          // a bench note like "iPhone 14 compatible" still finds the item.
          { notes: { $regex: search, $options: "i" } },
        ],
      });
    }

    // A repair part with an empty shelf was never listed in the shop, and that
    // stays true. Ordinary shop stock still lists at zero — it can be
    // pre-ordered, or restocked without disappearing from the catalogue.
    and.push({ $or: [{ partCategory: null }, { stock: { $gt: 0 } }] });
    if (and.length) query.$and = and;

    let sortStage = { createdAt: -1 };
    if (sort === "price-asc") sortStage = { price: 1 };
    if (sort === "price-desc") sortStage = { price: -1 };
    if (sort === "name") sortStage = { name: 1 };
    if (sort === "newest") sortStage = { createdAt: -1 };

    const pipeline = [
      { $match: query },
      {
        $project: {
          _id: 1, slug: 1, name: 1, description: 1, price: 1, category: 1,
          stock: 1, sku: 1, variants: 1, isActive: 1, images: 1,
          partCategory: 1, createdAt: 1, updatedAt: 1, preorder: 1,
          // T48 popularity counters. This list is an aggregation with an explicit
          // $project, so a new schema field does NOT reach the client until it is
          // named here. $ifNull because documents created before T48 have no such
          // field stored at all — an aggregation applies no schema defaults.
          views: { $ifNull: ["$views", 0] },
          sold: { $ifNull: ["$sold", 0] },
        },
      },
      // `kind` and `partId` are kept for the clients that read them, but they
      // are now derived rather than stamped by whichever half of a union the
      // row came from.
      {
        $addFields: {
          kind: { $cond: [{ $ifNull: ["$partCategory", false] }, "part", "product"] },
          partId: { $cond: [{ $ifNull: ["$partCategory", false] }, "$_id", null] },
          // A variant product's real sellable stock lives on the variants —
          // fulfilment decrements `variants.$.stock`, never the top-level
          // `stock` field (a separate seed value that would otherwise read as
          // "in stock" forever). Report the aggregate so the storefront badge
          // reflects what is actually sellable. Non-variant products keep the
          // top-level stock.
          stock: {
            $cond: [
              { $and: [{ $isArray: "$variants" }, { $gt: [{ $size: "$variants" }, 0] }] },
              { $sum: { $map: { input: "$variants", as: "v", in: { $ifNull: ["$$v.stock", 0] } } } },
              { $ifNull: ["$stock", 0] },
            ],
          },
        },
      },
      { $sort: sortStage },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "n" }],
        },
      },
    ];

    const [result] = await Product.aggregate(pipeline).collation({ locale: "en", strength: 2 });
    const data = result?.data || [];
    const total = result?.totalCount?.[0]?.n || 0;

    res.status(200).json({
      success: true,
      count: data.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data,
    });
  } catch (error) {
    next(error);
  }
};

const getProductBySlug = async (req, res, next) => {
  try {
    const slug = req.params.slug;

    // `part-<id>` URLs were minted before parts and products became one model
    // and are in the wild — links, bookmarks, anything already shared. The id
    // survived the merge unchanged, so resolve them against Product rather
    // than 404 on history.
    if (typeof slug === "string" && slug.startsWith("part-")) {
      const partId = slug.slice("part-".length);
      if (!mongoose.Types.ObjectId.isValid(partId)) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      const item = await Product.findOne({ _id: partId, sellOnline: true });
      if (!item || !Number(item.price) || item.price <= 0) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      const ratingSummary = await getRatingSummary(item._id);
      return res.status(200).json({
        success: true,
        data: { ...item.toObject(), kind: item.partCategory ? "part" : "product", partId: item._id, ratingSummary },
      });
    }

    const product = await Product.findOne({
      slug,
      sellOnline: true,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      });
    }

    const ratingSummary = await getRatingSummary(product._id);

    res.status(200).json({
      success: true,
      data: { ...product.toObject(), ratingSummary },
    });
  } catch (error) {
    next(error);
  }
};

// POST /products/:slug/view — record one product-page view.
//
// Deliberately NOT folded into the detail GET. That endpoint is called by
// `generateMetadata`, by the server render of /shop/[slug], and again by the
// client, so a single visit counted about three times — and Next prefetches the
// route on link hover, so a view was recorded for products nobody ever opened.
// A POST from the browser after the page mounts counts people, not fetches: it
// also means crawlers, which never run the script, cannot inflate the figure.
const recordProductView = async (req, res, next) => {
  try {
    // Same `part-<id>` compatibility as the detail route above — one lookup,
    // one counter, because there is one collection.
    const slug = req.params.slug;
    if (typeof slug === "string" && slug.startsWith("part-")) {
      const partId = slug.slice("part-".length);
      if (!mongoose.Types.ObjectId.isValid(partId)) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      const item = await Product.findOneAndUpdate(
        { _id: partId, sellOnline: true },
        { $inc: { views: 1 } },
        { new: true, projection: { views: 1 } },
      );
      if (!item) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      return res.status(200).json({ success: true, data: { views: item.views } });
    }

    const product = await Product.findOneAndUpdate(
      { slug, sellOnline: true },
      { $inc: { views: 1 } },
      // $inc rather than read-modify-write, so simultaneous visitors each count.
      { new: true, projection: { views: 1 } },
    );

    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    res.status(200).json({ success: true, data: { views: product.views } });
  } catch (error) {
    next(error);
  }
};

// T107: this was `Product.find({})` — no bound, no `lean()`, full hydrated
// documents — on a route the Marketplace calls on every open. Since the
// parts/products merge one collection holds bench stock and shop stock, so it
// only grows, and a 512MB heap will not carry it. Clamped with the same
// default/min/max pattern as `getProducts` above.
/**
 * GET /api/v1/products/id/:id  (admin/staff)
 *
 * One product by _id, regardless of `isActive` / `sellOnline`.
 *
 * T109: the product edit page used to call `getAdminProducts` and hunt for its
 * record inside the returned array. `/all` is paginated (200 max), so editing
 * anything past the 200th newest silently found nothing and the form came up
 * empty — and rendering one form fetched up to 200 documents. The merged
 * collection carries bench parts *and* shop stock, so 200 is reachable.
 *
 * Mounted under `/id/` rather than `/:id` so it cannot shadow the public
 * `/:slug` route. The public route must stay unable to serve an archived
 * product; this one deliberately can, because archiving is exactly when an
 * admin still needs to open the record.
 */
const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const product = await Product.findById(id).lean();
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    return res.status(200).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

const getAdminProducts = async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      200,
    );
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      Product.find({})
        // `_id` breaks ties: `createdAt` is not unique (a bulk import shares a
        // timestamp), and without a total order skip/limit can serve the same
        // document on two pages and drop another entirely.
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments({}),
    ]);

    // `count` stays the length of this page — existing callers read it that way.
    res.status(200).json({
      success: true,
      count: data.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      data,
    });
  } catch (error) {
    next(error);
  }
};

const generateSku = async (req, res, next) => {
  try {
    const { mode, prefix, parentSku, suffix } = req.body || {};
    if (mode === 'variant') {
      if (!parentSku || !suffix) {
        return res.status(400).json({ success: false, error: 'A parent SKU and an attribute suffix are required for a variant SKU' });
      }
    } else if (!prefix) {
      return res.status(400).json({ success: false, error: 'A SKU prefix is required' });
    }
    const sku = mode === 'variant'
      ? await nextVariantSku(parentSku, suffix)
      : await nextProductSku(prefix);
    res.status(200).json({ success: true, data: { sku } });
  } catch (error) {
    next(error);
  }
};

const createProduct = async (req, res, next) => {
  try {
    const { name, slug, description, shortDescription, price, images, category, stock, sku, variants, gallery, isActive } = req.body;

    if (!name || price == null || !category) {
      return res.status(400).json({
        success: false,
        error: "Name, price, and category are required",
      });
    }

    const productSlug = slug || slugify(name);
    if (!productSlug) {
      return res.status(400).json({ success: false, error: "Could not generate a slug" });
    }

    const product = await Product.create({
      name: String(name).trim(),
      slug: productSlug,
      description: description || "",
      shortDescription: shortDescription || "",
      price: Number(price),
      images: Array.isArray(images) ? images.filter(Boolean) : [],
      category: String(category).trim(),
      stock: stock == null ? 0 : Number(stock),
      sku: sku || "",
      variants: Array.isArray(variants) ? variants.filter(Boolean) : [],
      gallery: gallery && typeof gallery === "object" ? gallery : {},
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      // The shop reads sellOnline; isActive is the switch the admin UI writes.
      // Keep them in step so turning a product off still hides it.
      sellOnline: isActive !== undefined ? Boolean(isActive) : true,
    });

    await logFromRequest(req, {
      action: ACTIONS.PRODUCT_CREATED,
      resourceType: RESOURCES.PRODUCT,
      resourceId: product._id,
      resourceName: product.name,
      description: `Created product ${product.name} (${formatGhs(product.price)})`,
      metadata: { slug: product.slug, category: product.category },
    });

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    if (error.code === 11000) {
      const dupKey = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
      if (dupKey === "sku") {
        return res.status(400).json({
          success: false,
          error: "That SKU is already in use. Use a different SKU or regenerate one.",
        });
      }
      return res.status(400).json({
        success: false,
        error: "A product with that slug already exists",
      });
    }
    next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const update = { ...req.body };
    if (update.price != null) update.price = Number(update.price);
    if (update.stock != null) update.stock = Number(update.stock);
    if (update.isActive !== undefined) {
      update.isActive = Boolean(update.isActive);
      // findByIdAndUpdate skips the model hook, so mirror it here too.
      if (update.sellOnline === undefined) update.sellOnline = update.isActive;
    }
    if (update.variants !== undefined) update.variants = Array.isArray(update.variants) ? update.variants.filter(Boolean) : [];

    const product = await Product.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    await logFromRequest(req, {
      action: ACTIONS.PRODUCT_UPDATED,
      resourceType: RESOURCES.PRODUCT,
      resourceId: product._id,
      resourceName: product.name,
      description: `Updated product ${product.name}`,
      metadata: { slug: product.slug, category: product.category },
    });

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    if (error.code === 11000) {
      const dupKey = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
      if (dupKey === "sku") {
        return res.status(400).json({
          success: false,
          error: "That SKU is already in use. Use a different SKU or regenerate one.",
        });
      }
      return res.status(400).json({
        success: false,
        error: "A product with that slug already exists",
      });
    }
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false, sellOnline: false },
      { new: true },
    );

    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    await logFromRequest(req, {
      action: ACTIONS.PRODUCT_DELETED,
      resourceType: RESOURCES.PRODUCT,
      resourceId: product._id,
      resourceName: product.name,
      description: `Deactivated product ${product.name} (${product.slug})`,
    });

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  recordProductView,
  getProductBySlug,
  getAdminProducts,
  getProductById,
  generateSku,
  createProduct,
  updateProduct,
  deleteProduct,
};
