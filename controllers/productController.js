const mongoose = require("mongoose");
const Product = require("../models/Product");
const Part = require("../models/Part");

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

// Escape regex metacharacters so user-supplied search text is matched
// literally — prevents ReDoS and unintended regex-metacharacter matching.
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const getProducts = async (req, res, next) => {
  try {
    const { category, q, sort } = req.query;
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
        { "parts.name": { $regex: search, $options: "i" } },
      ];
    }

    let sortStage = { createdAt: -1 };
    if (sort === "price-asc") sortStage = { price: 1 };
    if (sort === "price-desc") sortStage = { price: -1 };
    if (sort === "name") sortStage = { name: 1 };
    if (sort === "newest") sortStage = { createdAt: -1 };

    // Merge shop products with sellable retail parts, then sort + paginate in
    // the database (a single $unionWith aggregation) so we never load the whole
    // catalogue into memory. Retail parts are matched independently of the
    // product query — same behaviour as before.
    const pipeline = [
      { $match: query },
      {
        $project: {
          _id: 1, slug: 1, name: 1, description: 1, price: 1, category: 1,
          stock: 1, sku: 1, variants: 1, isActive: 1, images: 1,
          createdAt: 1, updatedAt: 1,
        },
      },
      { $addFields: { kind: "product", partId: null } },
      {
        $unionWith: {
          coll: "parts",
          pipeline: [
            { $match: { isRetail: true, quantity: { $gt: 0 } } },
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
      return res.status(200).json({ success: true, data: partAsProduct(part) });
    }

    const product = await Product.findOne({
      slug,
      isActive: true,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      data: product,
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
    const { name, slug, description, price, images, category, stock, sku, variants, isActive } = req.body;

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
      price: Number(price),
      images: Array.isArray(images) ? images.filter(Boolean) : [],
      category: String(category).trim(),
      stock: stock == null ? 0 : Number(stock),
      sku: sku || "",
      variants: Array.isArray(variants) ? variants.filter(Boolean) : [],
      isActive: isActive !== undefined ? Boolean(isActive) : true,
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
