/**
 * Lightweight Zod validation middleware for Express.
 *
 * Usage:
 *   const { validate } = require('../middleware/validate');
 *   const { quoteSchema } = require('../validation/shippingSchema');
 *   router.post('/quote', validate(quoteSchema, 'body'), controller);
 *
 * Passes `source` = 'body' | 'query' | 'params'. On failure the ZodError is
 * forwarded to the existing errorHandler (which already maps ZodError → 400).
 */
function validate(schema, source = "body") {
  return (req, _res, next) => {
    try {
      req[source] = schema.parse(req[source]);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validate };
