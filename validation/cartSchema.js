const { z } = require("zod");

/**
 * Cart write schemas — PATCH /api/v1/cart/items (upsertItem), PUT
 * /api/v1/cart (replaceCart) and PATCH /api/v1/cart/merge (mergeCart).
 *
 * Wired per T126. Cart items are stored verbatim and re-echoed to the
 * browser in full, and the cart is the seed of the checkout flow, so the
 * bounds below mirror the Cart model's own shape: a cart line that could
 * never be saved is rejected before it reaches Mongoose, whose "$push"
 * ValidationError would otherwise surface as a 500-shaped message.
 *
 * Deliberate choices:
 *  - `name`/`price`/`slug`/`lineId` are required, matching both the model
 *    and upsertItem's manual check. A line missing them is rejected with a
 *    400 rather than silently dropped or persisted half-formed.
 *  - `qty` stays optional with a 1..100000 floor/ceiling. The controller
 *    applies `qty: qty || 1`; the cap simply stops an absurd value reaching
 *    the DB (the schema has no upper bound on qty, only a min of 1).
 *  - `variant` is a free object: sku + attributes, where attributes are the
 *    product's free-form key/value map. Sizing every variant attribute is
 *    not worth the maintenance; just cap the string sku.
 */

const stringField = (max) => z.string().trim().max(max).optional().default("");

const cartItemSchema = z.object({
  lineId: z.string().trim().min(1, "lineId is required").max(200),
  slug: z.string().trim().min(1, "slug is required").max(200),
  name: z.string().trim().min(1, "name is required").max(200),
  // Money in pesewas — a negative or non-numeric price can never be saved.
  price: z
    .number({ invalid_type_error: "price must be a number (pesewas)" })
    .int("price must be a whole number of pesewas")
    .min(0, "price cannot be negative"),
  image: stringField(500),
  category: stringField(100),
  stock: z.number().int().min(0).optional().default(0),
  qty: z.number().int().min(1).max(100000).optional().default(1),
  variant: z
    .object({
      sku: z.string().trim().max(200).optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  // `product` (ObjectId string) rides along from some clients; keep it.
  product: z.string().trim().max(24).optional(),
});

/**
 * PUT /api/v1/cart — replace the whole cart.
 */
const replaceCartSchema = z.object({
  items: z.array(cartItemSchema).max(200, "Cart cannot contain more than 200 items"),
});

/**
 * PATCH /api/v1/cart/merge — merge localStorage items into the DB cart.
 */
const mergeCartSchema = z.object({
  items: z.array(cartItemSchema).max(200, "Cart cannot contain more than 200 items"),
});

/**
 * PATCH /api/v1/cart/items — add or update a single line.
 */
const upsertItemSchema = cartItemSchema;

module.exports = { replaceCartSchema, mergeCartSchema, upsertItemSchema };
