const express = require('express');
const {
  getAllProductReviews,
  updateProductReviewApproval,
  deleteProductReview,
} = require('../controllers/productReviewController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Admin only — mirrors the service-review admin pattern.
router.get('/all', protect, restrictTo('admin'), getAllProductReviews);
router.patch('/:id/approve', protect, restrictTo('admin'), updateProductReviewApproval);
router.delete('/:id', protect, restrictTo('admin'), deleteProductReview);

module.exports = router;