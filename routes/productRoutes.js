const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  submitProductReviewSchema,
  updateMyProductReviewSchema,
} = require('../validation/productReviewSchema');
const {
  getProducts,
  recordProductView,
  getProductBySlug,
  getAdminProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct
} = require('../controllers/productController');
const {
  submitProductReview,
  getProductReviews,
  getMyProductReview,
  getReviewEligibility,
  updateMyProductReview
} = require('../controllers/productReviewController');

const router = express.Router();

router.get('/', getProducts);
router.get('/all', protect, restrictTo('admin', 'staff'), getAdminProducts);
// T109 — one product by _id for the admin edit form, archived included. Under
// `/id/` so it cannot shadow the public `/:slug` route below, which must stay
// unable to serve an archived product.
router.get('/id/:id', protect, restrictTo('admin', 'staff'), getProductById);
router.post('/', protect, restrictTo('admin', 'staff'), createProduct);
router.put('/:id', protect, restrictTo('admin', 'staff'), updateProduct);
// The admin UI and hooks send PATCH for product updates (useUpdateProduct,
// useRestoreProduct, inventory archive toggle). PUT is kept for API parity.
router.patch('/:id', protect, restrictTo('admin', 'staff'), updateProduct);
router.delete('/:id', protect, restrictTo('admin', 'staff'), deleteProduct);

// Product reviews — parallel system to the service Review (see PRODUCT_REVIEW_TASK.md)
router.post('/:productId/reviews', protect, validate(submitProductReviewSchema), submitProductReview);
router.get('/:productId/reviews/mine', protect, getMyProductReview);
router.get('/:productId/reviews/eligibility', protect, getReviewEligibility);
router.patch('/:productId/reviews/mine', protect, validate(updateMyProductReviewSchema), updateMyProductReview);
router.get('/:productId/reviews', getProductReviews);

router.get('/:slug', getProductBySlug);
// Public: the storefront calls this once when a visitor actually opens the
// product page. Kept off the GET so prefetches and crawlers do not count (T48).
router.post('/:slug/view', recordProductView);

module.exports = router;
