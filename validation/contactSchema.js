const { z } = require('zod');

/**
 * Contact / consultation submission — the public form at POST /api/v1/contacts.
 *
 * REWRITTEN 2026-08-30 (T126). The previous version of this schema was written
 * but never wired to a route, and wiring it as it stood would have BROKEN the
 * form in two separate ways. Both are worth recording, because they are the
 * general hazard in T126 rather than quirks of this one file:
 *
 *  1. It declared only { name, email, subject, message }. `validate()` does
 *     `req.body = schema.parse(req.body)`, and Zod strips unknown keys — so
 *     phone, businessName, service, type and plan would have been silently
 *     dropped from every submission. A consultation booking would have lost the
 *     service and plan the customer chose, with no error anywhere.
 *  2. It required `message`. The controller does not: it requires only name and
 *     email, and stores `message || ''`. A consultation booked without a message
 *     would have been rejected with "Message is required".
 *
 * So an unused schema is not a free win waiting to be plugged in — it is an
 * untested assertion about a request shape. This one now mirrors what
 * contactController.submitContact actually reads.
 *
 * Lengths match the sanitisers the controller applies immediately afterwards
 * (sanitizeMessage 3000, sanitizeText 200/100), so the schema rejects what the
 * sanitiser would otherwise silently truncate.
 */
const CONTACT_TYPES = ['general', 'consultation', 'hosting-enquiry', 'seo-audit', 'domain', 'other'];

const submitContactSchema = z.object({
  // The controller's own hard requirements.
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Invalid email').max(254),

  // Optional in the controller — every one of these was being stripped before.
  phone: z.string().trim().max(20).optional(),
  message: z.string().max(3000).optional(),
  subject: z.string().trim().max(200).optional(),
  businessName: z.string().trim().max(200).optional(),
  service: z.string().trim().max(100).optional(),
  // Unrecognised values are rejected here rather than reaching Mongoose, whose
  // enum error is a 500-shaped ValidationError rather than a clean 400.
  type: z.enum(CONTACT_TYPES).optional(),
  plan: z.string().trim().max(100).optional(),
});

module.exports = { submitContactSchema, CONTACT_TYPES };
