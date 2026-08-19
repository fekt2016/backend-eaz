const mongoose = require("mongoose");
const ProductReview = require("../models/ProductReview");
const Product = require("../models/Product");
const Part = require("../models/Part");
const Order = require("../models/Order");
const { normalizePhone } = require("./orderController");
const { sanitizeText, sanitizeMessage } = require("../utils/sanitize");

// Orders are guest checkouts — there is no stored user id on Order, only a
// customer.email/customer.phone snapshot from checkout time (see
// orderController.getMyOrders, which uses the same match). A review is only
// allowed once the logged-in reviewer's account email/phone matches at least
// one paid or delivered order that actually contains this catalogue item
// (product or part — reviews cover both, see resolveCatalogItem above).
async function hasVerifiedPurchase(user, catalogItemId) {
  const or = [];
  if (user?.email) {
    or.push({ "customer.email": String(user.email).toLowerCase() });
  }
  if (user?.phone) {
    const digits = normalizePhone(user.phone);
    if (digits) {
      or.push({ "customer.phoneDigits": digits });
      const variants = new Set([user.phone, digits]);
      if (digits.startsWith("0")) {
        variants.add(`233${digits.slice(1)}`);
        variants.add(`+233${digits.slice(1)}`);
      }
      if (!/^0/.test(digits) && digits.startsWith("233")) {
        variants.add(`0${digits.slice(3)}`);
      }
      or.push({ "customer.phone": { $in: [...variants] } });
    }
  }
  if (!or.length) return false;

  const match = await Order.exists({
    status: { $in: ["paid", "delivered"] },
    $or: or,
    items: {
      $elemMatch: { $or: [{ product: catalogItemId }, { part: catalogItemId }] },
    },
  });
  return Boolean(match);
}

// Resolve a shop catalogue item by _id or slug. The product detail page serves
// both real Products and retail Parts under a synthetic `part-<id>` slug, and
// reviews are keyed to whatever `_id` that page shows — so resolve across both
// collections so part reviews still validate. Returns a plain object with
// `_id`, `name`, `slug` or null when nothing matches.
async function resolveCatalogItem(productIdOrSlug) {
  const raw = String(productIdOrSlug || "");
  if (!raw) return null;

  if (mongoose.Types.ObjectId.isValid(raw)) {
    const [product, part] = await Promise.all([
      Product.findById(raw).select("_id name slug"),
      Part.findById(raw).select("_id name"),
    ]);
    if (product) return { _id: product._id, name: product.name, slug: product.slug };
    if (part) return { _id: part._id, name: part.name, slug: null };
    return null;
  }

  const product = await Product.findOne({ slug: raw }).select("_id name slug");
  return product ? { _id: product._id, name: product.name, slug: product.slug } : null;
}

// Aggregate avg rating + count for approved reviews of a catalog item.
async function getRatingSummary(catalogItemId) {
  const [row] = await ProductReview.aggregate([
    { $match: { product: catalogItemId, approved: true } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  if (!row) return { average: null, count: 0 };
  return { average: Math.round(row.average * 10) / 10, count: row.count };
}

/**
 * POST /api/v1/products/:productId/reviews — auth required.
 * Creates a review; the user is taken from the token, never from the body.
 * Approved by default (Decision #4 — authenticated submitter lowers spam risk).
 */
const submitProductReview = async (req, res, next) => {
  try {
    const item = await resolveCatalogItem(req.params.productId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const comment = sanitizeMessage(req.body.comment, 2000);
    const rating = Number(req.body.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: "Rating must be an integer between 1 and 5" });
    }
    if (!comment || comment.length < 10) {
      return res.status(400).json({ success: false, error: "Review must be at least 10 characters" });
    }

    const existing = await ProductReview.findOne({
      product: item._id,
      user: req.user._id,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "You have already reviewed this product",
        data: existing,
      });
    }

    const verified = await hasVerifiedPurchase(req.user, item._id);
    if (!verified) {
      return res.status(403).json({
        success: false,
        error: "Reviews are limited to verified purchasers of this product",
        code: "PURCHASE_NOT_VERIFIED",
      });
    }

    const created = await ProductReview.create({
      product: item._id,
      user: req.user._id,
      rating,
      comment,
      approved: true,
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "You have already reviewed this product",
      });
    }
    next(error);
  }
};

/**
 * GET /api/v1/products/:productId/reviews — public.
 * Approved-only, paginated, newest first. Exposes reviewer name only.
 */
const getProductReviews = async (req, res, next) => {
  try {
    const item = await resolveCatalogItem(req.params.productId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      ProductReview.find({ product: item._id, approved: true })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "name"),
      ProductReview.countDocuments({ product: item._id, approved: true }),
    ]);

    const data = reviews.map((r) => ({
      _id: r._id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      userName: r.user?.name || "Deleted user",
    }));

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

/**
 * GET /api/v1/products/:productId/reviews/mine — auth required.
 * Returns the current user's review for this product (approved or not), or
 * null — lets the UI show an edit state instead of a duplicate form.
 */
const getMyProductReview = async (req, res, next) => {
  try {
    const item = await resolveCatalogItem(req.params.productId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }
    const review = await ProductReview.findOne({ product: item._id, user: req.user._id });
    res.status(200).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/products/:productId/reviews/eligibility — auth required.
 * Lets the product page decide, before rendering, whether to show the
 * review form or a "verified purchasers only" message — rather than the
 * user filling out a review and only then hitting the 403 from POST.
 */
const getReviewEligibility = async (req, res, next) => {
  try {
    const item = await resolveCatalogItem(req.params.productId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }
    const alreadyReviewed = Boolean(
      await ProductReview.exists({ product: item._id, user: req.user._id }),
    );
    const verifiedPurchase = await hasVerifiedPurchase(req.user, item._id);
    res.status(200).json({
      success: true,
      data: {
        canReview: verifiedPurchase && !alreadyReviewed,
        alreadyReviewed,
        verifiedPurchase,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/products/:productId/reviews/mine — auth required.
 * Updates the current user's existing review for this product.
 */
const updateMyProductReview = async (req, res, next) => {
  try {
    const item = await resolveCatalogItem(req.params.productId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const comment = sanitizeText(req.body.comment, 2000);
    const rating = req.body.rating !== undefined ? Number(req.body.rating) : undefined;

    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({ success: false, error: "Rating must be an integer between 1 and 5" });
    }
    if (comment !== undefined && comment.length < 10) {
      return res.status(400).json({ success: false, error: "Review must be at least 10 characters" });
    }

    const update = {};
    if (rating !== undefined) update.rating = rating;
    if (comment !== undefined) update.comment = comment;

    const review = await ProductReview.findOneAndUpdate(
      { product: item._id, user: req.user._id },
      update,
      { new: true, runValidators: true },
    );

    if (!review) {
      return res.status(404).json({ success: false, error: "You have not reviewed this product yet" });
    }

    res.status(200).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/product-reviews/all — admin only.
 * All product reviews incl. pending, newest first, with reviewer + product
 * names resolved (products and parts are separate collections, so resolve
 * names in bulk rather than relying on populate).
 */
const getAllProductReviews = async (req, res, next) => {
  try {
    const reviews = await ProductReview.find()
      .sort({ createdAt: -1 })
      .populate("user", "name");

    const ids = [...new Set(reviews.map((r) => r.product?.toString()).filter(Boolean))];
    const [products, parts] = await Promise.all([
      Product.find({ _id: { $in: ids } }).select("name slug"),
      Part.find({ _id: { $in: ids } }).select("name"),
    ]);

    const nameMap = new Map();
    products.forEach((p) => nameMap.set(p._id.toString(), { name: p.name, slug: p.slug }));
    parts.forEach((p) => nameMap.set(p._id.toString(), { name: p.name, slug: null }));

    const data = reviews.map((r) => {
          const meta = nameMap.get(r.product?.toString()) || { name: null, slug: null };
          return {
            _id: r._id,
            product: r.product,
            productName: meta.name,
            productSlug: meta.slug,
            userName: r.user?.name || "Deleted user",
            rating: r.rating,
            comment: r.comment,
            approved: r.approved,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          };
        });

    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/product-reviews/:id/approve — admin only.
 */
const updateProductReviewApproval = async (req, res, next) => {
  try {
    const { approved } = req.body;
    const review = await ProductReview.findByIdAndUpdate(
      req.params.id,
      { approved: approved === true },
      { new: true, runValidators: true },
    );

    if (!review) {
      return res.status(404).json({ success: false, error: "Review not found" });
    }

    res.status(200).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/product-reviews/:id — admin only.
 */
const deleteProductReview = async (req, res, next) => {
  try {
    const review = await ProductReview.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, error: "Review not found" });
    }
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitProductReview,
  getProductReviews,
  getMyProductReview,
  getReviewEligibility,
  updateMyProductReview,
  getAllProductReviews,
  updateProductReviewApproval,
  deleteProductReview,
  getRatingSummary,
};
