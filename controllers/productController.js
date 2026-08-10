const Product = require("../models/Product");

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
      ];
    }

    let sortQuery = { createdAt: -1 };
    if (sort === "price-asc") sortQuery = { price: 1 };
    if (sort === "price-desc") sortQuery = { price: -1 };
    if (sort === "name") sortQuery = { name: 1 };
    if (sort === "newest") sortQuery = { createdAt: -1 };

    const [data, total] = await Promise.all([
      Product.find(query).sort(sortQuery).skip(skip).limit(limit),
      Product.countDocuments(query),
    ]);

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
    const product = await Product.findOne({
      slug: req.params.slug,
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
