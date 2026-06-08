const Review = require('../models/Review');
const { sanitizeName, sanitizeText, sanitizeMessage } = require('../utils/sanitize');

/**
 * Submit a new review (public)
 */
const submitReview = async (req, res, next) => {
  try {
    const name    = sanitizeName(req.body.name);
    const service = sanitizeText(req.body.service, 100);
    const review  = sanitizeMessage(req.body.review, 2000);
    const { rating } = req.body;

    if (!name || !service || !rating || !review) {
      return res.status(400).json({
        success: false,
        error: 'Name, service, rating and review are required',
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5',
      });
    }

    if (review.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Review must be at least 10 characters',
      });
    }

    const created = await Review.create({ name, service, rating: Number(rating), review });

    res.status(201).json({
      success: true,
      message: 'Thank you for your review!',
      data: created,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get approved reviews (public)
 */
const getApprovedReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ approved: true }).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all reviews — admin only
 */
const getAllReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Approve or reject a review — admin only
 */
const updateReviewApproval = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approved } = req.body;

    const review = await Review.findByIdAndUpdate(
      id,
      { approved },
      { new: true, runValidators: true }
    );

    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    res.status(200).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a review — admin only
 */
const deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitReview,
  getApprovedReviews,
  getAllReviews,
  updateReviewApproval,
  deleteReview,
};
