const express = require('express');
const {
  submitReview,
  getApprovedReviews,
  getAllReviews,
  updateReviewApproval,
  deleteReview,
} = require('../controllers/reviewController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Public
router.post('/', submitReview);
router.get('/', getApprovedReviews);

// Admin only
router.get('/all', protect, restrictTo('admin'), getAllReviews);
router.patch('/:id/approve', protect, restrictTo('admin'), updateReviewApproval);
router.delete('/:id', protect, restrictTo('admin'), deleteReview);

module.exports = router;
