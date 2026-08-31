const { z } = require("zod");
const { DELIVERY_SPEEDS } = require("../services/shipping/shippingCalculator");

// Every fulfilment id the storefront can send: the two plain methods, the
// bare courier method, and one compound courier id per delivery speed.
const COURIER_METHOD_IDS = [
  "in_house_delivery",
  "courier_dispatch",
  ...DELIVERY_SPEEDS.map((speed) => `courier_dispatch_${speed}`),
  "bus_station_pickup",
];

// ── Shipping-quote request (public) ─────────────────────────────────────────
//
// Legacy: `city` is one of the closed Accra/Tema enum. Expansion (T78 → E2):
// an optional `region` accompanies a free-form `city`, so a customer anywhere
// in Ghana can quote. The authoritative region↔city existence + fulfillment
// validation happens in the controller (DB-backed), not in this sync Zod shape.
const quoteSchema = z
  .object({
    city: z.union([
      z.enum(["Accra", "Tema"]),
      z.string().min(1, "City is required").max(120),
    ]),
    region: z.string().max(120).optional().default(""),
    // Neighborhood is required for a home delivery but meaningless for
    // bus-station pickup (the customer collects at a station), so it's
    // relaxed here and enforced in the superRefine below.
    neighborhood: z.string().max(200).optional().default(""),
    address: z.string().max(500).optional().default(""),
    pickupLocationId: z.string().optional().default(""),
    // The id the buyer picked from GET /neighborhoods. Optional at the schema
    // level (legacy callers send only a free-text `neighborhood`), but it is
    // the precise path — without it the resolver falls back to name matching.
    neighborhoodId: z.string().optional().default(""),
    // Derived, never typed out: GET /shipping/methods offers one compound id
    // per speed tier a zone defines, so a hand-written list here silently
    // rejects a method the storefront is showing (that is exactly how
    // `courier_dispatch_next_day` came to fail).
    method: z.enum(COURIER_METHOD_IDS, {
      error: "Method must be a valid delivery method",
    }),
    deliverySpeed: z
      .enum(["standard", "same_day", "next_day", "express"])
      .optional()
      .default("standard"),
    items: z
      .array(
        z.object({
          productId: z.string().min(1, "Product ID is required"),
          quantity: z.coerce
            .number({ invalid_type_error: "Quantity must be a number" })
            .int("Quantity must be a whole number")
            .min(1, "Quantity must be at least 1")
            .default(1),
        }),
      )
      .min(1, "At least one item is required")
      .max(50, "Maximum 50 items per quote"),
  })
  .superRefine((data, ctx) => {
    if (data.method === "bus_station_pickup") {
      if (!data.region) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["region"],
          message: "Region is required for bus-station pickup.",
        });
      }
      if (!data.pickupLocationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pickupLocationId"],
          message: "A pickup location is required for bus-station pickup.",
        });
      }
    } else if (!data.neighborhood) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["neighborhood"],
        message: "Neighborhood is required.",
      });
    }
  });

// ── Shipping methods query ──────────────────────────────────────────────────
const methodsQuerySchema = z
  .object({
    city: z.union([
      z.enum(["Accra", "Tema"]),
      z.string().min(1).max(120),
    ]),
    region: z.string().max(120).optional().default(""),
    neighborhood: z.string().max(200).optional().default(""),
    // The area the buyer picked. With it, the prices returned here come from
    // the same zone the quote will use, so they do not change afterwards.
    neighborhoodId: z.string().max(48).optional().default(""),
    // Cart context, so free delivery is reflected up front instead of the fee
    // visibly flipping to "Free" once the quote lands. Both are optional —
    // without a subtotal the endpoint declines to claim free delivery at all.
    subtotal: z.coerce.number().min(0).optional(),
    weightKg: z.coerce.number().min(0).optional(),
  });

// ── Admin: zone CRUD ────────────────────────────────────────────────────────
const zoneCreateSchema = z.object({
  name: z.string().min(1, "Zone name is required").max(100),
  code: z
    .string()
    .min(1, "Zone code is required")
    .max(20)
    .regex(/^[A-Z0-9-]+$/, "Code must be uppercase alphanumeric or hyphens"),
  city: z.union([
    z.enum(["Accra", "Tema"]),
    z.string().min(1, "City is required").max(120),
  ]),
  region: z.string().max(120).optional().default(""),
  neighborhoods: z.array(z.string().trim().toLowerCase()).optional().default([]),
  distanceMinKm: z.number().min(0).nullable().optional().default(null),
  distanceMaxKm: z.number().min(0).nullable().optional().default(null),
  baseRate: z.coerce
    .number({ invalid_type_error: "Base rate must be a number" })
    .min(0, "Base rate cannot be negative"),
  courierBaseRate: z.coerce.number().min(0).nullable().optional().default(null),
  perKgRate: z.coerce.number().min(0).optional().default(0),
  courierPerKgRate: z.coerce.number().min(0).nullable().optional().default(null),
  sameDayMultiplier: z.number().min(0).optional().default(1.2),
  expressMultiplier: z.number().min(0).optional().default(1.4),
  fragileSurcharge: z.coerce.number().min(0).optional().default(0),
  inAccraCore: z.boolean().nullable().optional().default(null),
  distanceBaseFee: z.coerce.number().min(0).nullable().optional().default(null),
  pricePerKm: z.coerce.number().min(0).nullable().optional().default(null),
  pricePerKg: z.coerce.number().min(0).nullable().optional().default(null),
  regionalBaseFee: z.coerce.number().min(0).nullable().optional().default(null),
  regionalPricePerKg: z.coerce.number().min(0).nullable().optional().default(null),
  pickupMode: z.enum(["none", "bus_station"]).optional().default("none"),
  estimatedDays: z.coerce
    .number({ invalid_type_error: "Estimated days must be a number" })
    .int("Estimated days must be a whole number")
    .min(0, "Estimated days cannot be negative"),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

/**
 * Build the PATCH counterpart of a create schema.
 *
 * `.partial()` alone is NOT enough: it makes each field optional but leaves its
 * `.default()` in place, so a PATCH body of `{ name }` parses into every
 * defaulted field as well. Wired as route middleware — which replaces req.body
 * with the parsed result — that would silently reset an admin's whole pricing
 * config on a rename: perKgRate to 0, sameDayMultiplier to 1.2, isActive to
 * true, and 16 more. Strip the defaults first, then make it partial, so an
 * absent key stays absent.
 */
function patchSchemaOf(createSchema) {
  const shape = {};
  for (const [key, field] of Object.entries(createSchema.shape)) {
    shape[key] = typeof field.removeDefault === 'function' ? field.removeDefault() : field;
  }
  return z.object(shape).partial();
}

const zoneUpdateSchema = patchSchemaOf(zoneCreateSchema);

// ── Admin: tier CRUD ────────────────────────────────────────────────────────
const tierCreateSchema = z.object({
  name: z.string().min(1, "Tier name is required").max(100),
  category: z.string().min(1, "Category is required").max(100),
  level: z.coerce.number().int().min(0).optional().default(0),
  multiplier: z.number().min(0).optional().default(1.0),
  fragileSurcharge: z.coerce.number().min(0).optional().default(0),
  weightThresholdKg: z.number().min(0).optional().default(0),
  weightSurchargePerKg: z.coerce.number().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const tierUpdateSchema = patchSchemaOf(tierCreateSchema);

// ── Admin: settings update ──────────────────────────────────────────────────
const settingsUpdateSchema = patchSchemaOf(
  z.object({
    inHouseDeliveryAvailable: z.boolean(),
    courierDispatchAvailable: z.boolean(),
    expressAvailable: z.boolean(),
    sameDayAvailable: z.boolean().optional(),
    pickupAvailable: z.boolean().optional(),
    freeDeliveryThreshold: z.coerce.number().positive().nullable(),
    inHouseRadiusKm: z.coerce.number().min(0).nullable(),
    sameCityFee: z.coerce.number().min(0),
    crossCityFee: z.coerce.number().min(0),
    heavyItemFee: z.coerce.number().min(0),
    heavyItemThresholdKg: z.coerce.number().min(0),
    expressSurcharge: z.coerce.number().min(0),
    // T80 — same-day cutoff hour (0–23) and closed weekday set.
    sameDayCutoffHour: z.coerce.number().int().min(0).max(23).optional(),
    deliveryClosedDays: z
      .array(z.coerce.number().int().min(0).max(6))
      .optional()
      .default([0]),
    // Google-Maps distance pricing: measurement origin + master switch.
    originAddress: z.string().max(300).optional(),
    useGoogleDistance: z.boolean().optional(),
  }),
);

// ── Admin: neighbourhood distance resolution ────────────────────────────────
const distanceResolveSchema = z.object({
  region: z.string().trim().optional().default(""),
  city: z.string().trim().min(1, "A city is required"),
  neighborhoods: z.array(z.string().trim().min(1)).optional(),
  force: z.boolean().optional().default(false),
});

const distanceManualSchema = z.object({
  region: z.string().trim().optional().default(""),
  city: z.string().trim().min(1, "A city is required"),
  neighborhood: z.string().trim().min(1, "A neighbourhood is required"),
  distanceKm: z.coerce.number().min(0),
});

// ── Admin: courier-rate config ──────────────────────────────────────────────
const courierRateSchema = z.object({
  code: z.string().min(1).optional().default("COURIER_PAYOUT"),
  mode: z.enum(["percentage", "flat", "per_zone"]),
  percentage: z.number().min(0).max(100).optional().default(0),
  flatAmount: z.coerce.number().min(0).optional().default(0),
  zoneRates: z
    .array(
      z.object({
        zoneCode: z.string().min(1),
        amount: z.coerce.number().min(0),
      }),
    )
    .optional()
    .default([]),
  isActive: z.boolean().optional().default(true),
});

// The only courier-rate route is a PATCH that applies whichever keys were sent
// (`req.body[key] !== undefined`). The strict schema above would break it twice
// over: `mode` would become required, so `{ isActive: false }` alone is refused;
// and the defaults would reset percentage, flatAmount and zoneRates on any edit.
const courierRateUpdateSchema = patchSchemaOf(courierRateSchema);

module.exports = {
  quoteSchema,
  methodsQuerySchema,
  zoneCreateSchema,
  zoneUpdateSchema,
  tierCreateSchema,
  tierUpdateSchema,
  settingsUpdateSchema,
  courierRateSchema,
  courierRateUpdateSchema,
  distanceResolveSchema,
  distanceManualSchema,
};
