const { z } = require("zod");

/**
 * Product review write schemas — POST /:productId/reviews (submit) and
 * PATCH /:productId/reviews/mine (update). Wired per T126.
 *
 * The controller sanitises and re-validates the same boundsthat these
 * schemas assert (rating integer 1..5, comment >= 10 chars). Wiring Zod in
 * front means those rules are enforced once, in one place, at the edge —
 * while the controller keeps its own checks as the backstop for any other
 * writer. A `validate()` that fails here returns the same 400 the
 * controller returned, so nothing observable changes for a client that was
 * already correct.
 */

const rating = z
  .number({ invalid_type_error: "Rating must be an integer between 1 and 5" })
  .int("Rating must be an integer between 1 and 5")
  .min(1, "Rating must be an integer between 1 and 5")
  .max(5, "Rating must be an integer between 1 and 5");

const comment = z.string().trim().min(10, "Review must be at least 10 characters");

/**
 * POST /:productId/reviews — a new review. Both fields required, matching
 * the controller.
 */
const submitProductReviewSchema = z.object({
  rating,
  comment: comment.max(2000),
});

/**
 * PATCH /:productId/reviews/mine — a true partial. Either field may be
 * sent alone, exactly as the controller allows (`rating !== undefined`).
 * No `.required()`, no `.default()` — a default would force a value the
 * client did not send.
 */
const updateMyProductReviewSchema = z
  .object({
    rating: rating.optional(),
    comment: comment.max(2000).optional(),
  })
  .refine((d) => d.rating !== undefined || d.comment !== undefined, {
    message: "Send a rating or a comment to update your review.",
    path: ["rating"],
  });

module.exports = { submitProductReviewSchema, updateMyProductReviewSchema };
