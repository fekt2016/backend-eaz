const { z } = require('zod');

const searchSchema = z.object({
  domain: z.string().min(1, 'Domain name is required'),
});

/**
 * POST /api/v1/domain/payment.
 *
 * T126 — this schema was written and never wired. Wiring it revealed it was
 * OVER-STRICT: it required `email`, and `domainController.createDomainPayment`
 * never reads `req.body.email` at all — the customer's identity comes from
 * `req.user`. The storefront happens to send an email, so the schema looked
 * right against that one caller, but it would have rejected any valid request
 * that did not, including the existing T65 price-guard tests.
 *
 * A schema has to describe what the ENDPOINT accepts, not what one client
 * happens to send. `email` is optional accordingly.
 */
const paymentSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  email: z.string().email('Invalid email').optional(),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  customerName: z.string().optional(),
  fullName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  // Zod 4 requires BOTH a key and a value schema. Written as
  // `z.record(z.unknown())` this threw a TypeError — not a ZodError — so the
  // error handler returned 500 rather than 400. The schema had never been wired
  // to a route, so nothing had ever executed it against the installed Zod (4.3.6);
  // it was written for Zod 3 and quietly rotted through the upgrade.
  registrantInfo: z.record(z.string(), z.unknown()).optional(),
  years: z.number().min(1).max(10).optional(),
});

module.exports = { searchSchema, paymentSchema };
