/**
 * Typed errors for the shipping system (T78). The codebase has no shared error
 * class — controllers return inline `{ success: false, error }` responses and
 * middleware/errorHandler.js honours `err.statusCode` on anything unhandled.
 * These classes carry a statusCode so a throw inside the calculator surfaces
 * as the right HTTP status through the existing handler, with the same
 * `{ success, error }` shape every other endpoint produces.
 */
class ShippingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

/**
 * The delivery address matched no zone neighbourhood and the city has no
 * fallback zone. Never let this become a zero fee — it is a hard 400 naming
 * the supported cities so the storefront can route the customer somewhere
 * real. (A city outside the Accra/Tema enum is rejected earlier by Zod; this
 * error covers a supported city whose zones are missing or inactive.)
 */
class UnsupportedDeliveryAreaError extends ShippingError {
  constructor(supportedCities) {
    const list = (supportedCities || ["Accra", "Tema"]).join(" and ");
    super(
      `We don't deliver to that area yet. We currently deliver to ${list}. ` +
        "Please double-check your address or contact support.",
      400,
    );
    this.code = "UNSUPPORTED_DELIVERY_AREA";
  }
}

/** The requested fulfilment method is switched off in ShippingSettings. */
class DisabledDeliveryMethodError extends ShippingError {
  constructor(message) {
    super(message, 400);
    this.code = "DELIVERY_METHOD_DISABLED";
  }
}

/** The chosen zone is outside the in-house rider's configured radius. */
class OutOfRangeError extends DisabledDeliveryMethodError {
  constructor(message) {
    super(message);
    this.code = "OUT_OF_INHOUSE_RANGE";
  }
}

/**
 * The requested fulfilment method is not allowed for the customer's region.
 * Greater Accra delivers; everywhere else is pickup. This is server-enforced
 * (never a client decision) and mentions the role pickup plays so the
 * storefront can guide the customer.
 */
class InvalidFulfilmentMethodError extends ShippingError {
  constructor(message) {
    super(message, 400);
    this.code = "INVALID_FULFILMENT_METHOD";
  }
}

module.exports = {
  ShippingError,
  UnsupportedDeliveryAreaError,
  DisabledDeliveryMethodError,
  OutOfRangeError,
  InvalidFulfilmentMethodError,
};
