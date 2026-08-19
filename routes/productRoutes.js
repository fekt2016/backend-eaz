const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getProducts,
  getProductBySlug,
  getAdminProducts,
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
router.post('/', protect, restrictTo('admin', 'staff'), createProduct);
router.put('/:id', protect, restrictTo('admin', 'staff'), updateProduct);
// The admin UI and hooks send PATCH for product updates (useUpdateProduct,
// useRestoreProduct, inventory archive toggle). PUT is kept for API parity.
router.patch('/:id', protect, restrictTo('admin', 'staff'), updateProduct);
router.delete('/:id', protect, restrictTo('admin', 'staff'), deleteProduct);

// Product reviews — parallel system to the service Review (see PRODUCT_REVIEW_TASK.md)
router.post('/:productId/reviews', protect, submitProductReview);
router.get('/:productId/reviews/mine', protect, getMyProductReview);
router.get('/:productId/reviews/eligibility', protect, getReviewEligibility);
router.patch('/:productId/reviews/mine', protect, updateMyProductReview);
router.get('/:productId/reviews', getProductReviews);

router.get('/:slug', getProductBySlug);

module.exports = router;
