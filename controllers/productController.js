const mongoose = require("mongoose");
const Product = require("../models/Product");
const Part = require("../models/Part");
const { logFromRequest, ACTIONS, RESOURCES } = require("../services/activityLogService");
// escapeRegex: match user-supplied search text literally (prevents ReDoS).
const { escapeRegex } = require("../utils/regex");
const { formatGhs } = require("../utils/money");
const { getRatingSummary } = require("./productReviewController");

// Shape a retail Part like a shop product so it flows through the same
// product-detail page, metadata, JSON-LD and cart/checkout. Mirrors the part
// mapping in getProducts. Price stays in integer pesewas (Part.sellingPrice).
function partAsProduct(p) {
  return {
    _id: p._id,
    slug: `part-${p._id}`,
    name: p.name,
    description: p.description || p.notes || "",
    price: p.sellingPrice,
    category: p.category,
    stock: p.quantity,
    sku: p.sku,
    variants: [],
    gallery: { images: [], videos: [] },
    isActive: true,
    kind: "part",
    partId: p._id,
    images: p.images || [],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const getProducts = async (req, res, next) => {
  try {
    const { category, q, sort, kind } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 12, 1),
      60,
    );
    const skip = (page - 1) * limit;

    const query = { isActive: true };

    if (category) {
      query.category = category;
    }

    if (q && q.trim()) {
      const search = escapeRegex(q.trim());
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
      ];
    }

    let sortStage = { createdAt: -1 };
    if (sort === "price-asc") sortStage = { price: 1 };
    if (sort === "price-desc") sortStage = { price: -1 };
    if (sort === "name") sortStage = { name: 1 };
    if (sort === "newest") sortStage = { createdAt: -1 };

    // Retail parts only belong in the unfiltered "All Products" view — a
    // shop category (Phones, Screen Protectors, ...) is a different
    // namespace from a part's own category (Battery, Screen, ...), so once
    // a category chip is active, parts are excluded entirely rather than
    // guessed at. When a search query is active, parts are matched by the
    // same query text as products instead of being included unconditionally.
    const partMatch = { isRetail: true, quantity: { $gt: 0 } };
    if (q && q.trim()) {
      const search = escapeRegex(q.trim());
      partMatch.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { notes: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
      ];
    }

    // Merge shop products with sellable retail parts, then sort + paginate in
    // the database (a single $unionWith aggregation) so we never load the whole
    // catalogue into memory. Retail parts only appear in the unfiltered
    // "All Products" view — a shop category excludes them, and a search query
    // matches parts by the same text as products. Pass `kind=product` to list
    // only real shop products (e.g. the homepage "Recent Products" strip).
    const pipeline = [
      { $match: query },
      {
        $project: {
          _id: 1, slug: 1, name: 1, description: 1, price: 1, category: 1,
          stock: 1, sku: 1, variants: 1, isActive: 1, images: 1,
          createdAt: 1, updatedAt: 1,
          // T48 popularity counters. This list is an aggregation with an explicit
          // $project, so a new schema field does NOT reach the client until it is
          // named here. $ifNull because products created before T48 have no such
          // field stored at all — an aggregation applies no schema defaults.
          views: { $ifNull: ["$views", 0] },
          sold: { $ifNull: ["$sold", 0] },
        },
      },
      { $addFields: { kind: "product", partId: null } },
    ];

    if (kind !== "product" && !category) {
      pipeline.push({
        $unionWith: {
          coll: "parts",
          pipeline: [
            { $match: partMatch },
            {
              $project: {
                _id: 1, name: 1, category: 1, sku: 1, createdAt: 1, updatedAt: 1,
                slug: { $concat: ["part-", { $toString: "$_id" }] },
                description: { $ifNull: ["$description", { $ifNull: ["$notes", ""] }] },
                price: "$sellingPrice",
                stock: "$quantity",
                images: { $ifNull: ["$images", []] },
              },
            },
            { $addFields: { variants: [], isActive: true, kind: "part", partId: "$_id" } },
          ],
        },
      });
    }

    pipeline.push(
      { $sort: sortStage },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "n" }],
        },
      },
    );

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

    // Retail parts are listed in the catalogue with a synthetic `part-<id>`
    // slug. Resolve those to the Part so the detail page no longer 404s.
    if (typeof slug === "string" && slug.startsWith("part-")) {
      const partId = slug.slice("part-".length);
      if (!mongoose.Types.ObjectId.isValid(partId)) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      const part = await Part.findById(partId);
      // Only expose parts that are actually sellable in the shop.
      if (!part || !part.isRetail || !Number(part.sellingPrice) || part.sellingPrice <= 0) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }
      const partAsProductDoc = partAsProduct(part);
      const ratingSummary = await getRatingSummary(part._id);
      return res.status(200).json({ success: true, data: { ...partAsProductDoc, ratingSummary } });
    }

    // T48: count the read as a view in the same round trip that fetches the
    // product. $inc rather than read-modify-write, so simultaneous readers each
    // count. Only the detail endpoint does this — list reads are not views.
    const product = await Product.findOneAndUpdate(
      { slug, isActive: true },
      { $inc: { views: 1 } },
      { new: true },
    );

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

const getAdminProducts = async (req, res, next) => {
  try {
    const data = await Product.find({}).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: data.length, data });
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
    if (update.isActive !== undefined) update.isActive = Boolean(update.isActive);
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
      { isActive: false },
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
  getProductBySlug,
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};
