const { z } = require("zod");

/**
 * Order write schemas — POST /api/v1/orders (createOrder) and
 * POST /api/v1/orders/track (trackOrder). Wired per T126.
 *
 * createOrder is the shop's guest checkout: many optional shipping params
 * coexist (quote path, legacy path, delivery-zone path, bus-station pickup),
 * and `validate()` REPLACES req.body with the parsed output while Zod
 * STRIPS unknown keys. So the schema must enumerate every field the
 * controller reads, or checkout silently loses one. The pattern used here —
 * an explicit object with `.passthrough()` at the item level and a
 * permissive top level — is the defensive choice for a mission-critical,
 * multi-path endpoint: it enforces the invariants that matter (items is an
 * array, customer has name + phone, caps) without ever dropping a field
 * another code path needs.
 */

// Optional fields arrive as "" (missing), undefined, or `null` — the
// controller treats all three as "not provided" (`if (deliveryZoneId)`,
// `req.body.pickupLocationId || null`, …). Accept all three so a legacy
// client's `null` is not rejected (see the order-creation-with-variants
// payloads, which send `deliveryZoneId: null`).
const optionalString = (max) =>
  z.union([z.string().trim().max(max), z.null()]).optional().default("");

// A single order line. The controller accepts a bare string (legacy
// `part-<id>` carts) OR an object `{ slug, qty, variant? }`.
const orderItemSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      slug: z.string().trim().min(1),
      qty: z.number().int().min(1).max(100000).optional().default(1),
      variant: z
        .object({
          sku: z.string().trim().max(200).optional(),
          attributes: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    })
    .passthrough(), // tolerate extra line fields from older clients
]);

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().trim().min(1, "Phone is required").max(20),
  email: z.string().trim().email("Invalid email").max(254).optional().default(""),
  address: optionalString(500),
});

/**
 * POST /api/v1/orders — guest checkout. Enforces the invariants the
 * controller itself checks up front (items present, customer name+phone) so
 * a malformed body fails as a clean 400 with a field list instead of being
 * silently half-processed. `customer` is required by literal shape; items
 * must be a non-empty array.
 */
const createOrderSchema = z
  .object({
    items: z.array(orderItemSchema).min(1, "Cart is empty"),
    customer: customerSchema,
    // Quote path
    shippingQuoteId: optionalString(100),
    // Legacy / recompute path
    deliveryZoneId: optionalString(24),
    city: optionalString(120),
    neighborhood: optionalString(120),
    address: optionalString(200),
    method: optionalString(50),
    deliverySpeed: optionalString(20),
    region: optionalString(120),
    pickupLocationId: optionalString(24),
    neighborhoodId: optionalString(24),
    // Echoed server-computed fee (validated against the server figure)
    shippingFee: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough(); // never drop an unknown field from a guest checkout body

/**
 * POST /api/v1/orders/track — orderNumber + phone.
 */
const trackOrderSchema = z.object({
  orderNumber: z.string().trim().min(1, "Order number is required").max(40),
  phone: z.string().trim().min(1, "Phone is required").max(20),
});

module.exports = { createOrderSchema, trackOrderSchema };
