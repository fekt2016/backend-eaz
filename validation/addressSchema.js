const { z } = require("zod");

// A 24-char hex ObjectId, or null for "no priced area chosen".
//
// Deliberately tolerant: anything that is not a well-formed id becomes null
// rather than a 400. The id is an optimisation — the address still resolves by
// name — so a junk value from a client must not cost the customer the whole
// save. tests/savedAddressRegion.test.js pins this ("stores null rather than
// throwing when the id is malformed").
const objectId = z
  .any()
  .transform((v) => (/^[0-9a-fA-F]{24}$/.test(String(v ?? "")) ? String(v) : null));

const label = z.string().trim().max(60, "Label cannot exceed 60 characters");
const street = z.string().trim().max(200, "Street cannot exceed 200 characters");
const neighborhood = z.string().trim().max(120, "Neighborhood cannot exceed 120 characters");
const city = z.string().trim().max(120, "City cannot exceed 120 characters");
const region = z.string().trim().max(120, "Region cannot exceed 120 characters");
const phone = z.string().trim().max(30, "Phone cannot exceed 30 characters");

/**
 * At least one of street / neighborhood / city must be present — an address
 * that is only a region cannot be delivered to, and cannot be priced either.
 */
const hasSomeLocation = (data, ctx) => {
  if (!data.street && !data.neighborhood && !data.city) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["street"],
      message: "Enter at least a street address, neighborhood, or city.",
    });
  }
};

const createAddressSchema = z
  .object({
    label: label.optional().default(""),
    street: street.optional().default(""),
    neighborhood: neighborhood.optional().default(""),
    neighborhoodId: objectId.optional().default(null),
    city: city.optional().default(""),
    region: region.optional().default(""),
    phone: phone.optional().default(""),
    isDefault: z.coerce.boolean().optional().default(false),
  })
  .superRefine(hasSomeLocation);

/**
 * Update is a true partial: sending only `{ label }` renames the address and
 * leaves everything else as it was. Deliberately no `.default()` anywhere — a
 * default here would turn every omitted field into "" and blank the address on
 * a one-field edit. The emptiness rule is enforced in the controller against
 * the merged document, since a patch alone cannot know what it is patching.
 */
const updateAddressSchema = z
  .object({
    label: label.optional(),
    street: street.optional(),
    neighborhood: neighborhood.optional(),
    neighborhoodId: objectId.optional(),
    city: city.optional(),
    region: region.optional(),
    phone: phone.optional(),
    isDefault: z.coerce.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Send at least one field to update.",
  });

module.exports = { createAddressSchema, updateAddressSchema };
