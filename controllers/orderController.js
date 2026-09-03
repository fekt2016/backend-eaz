const crypto = require("crypto");
const Paystack = require("@paystack/paystack-sdk");
const Order = require("../models/Order");
const Product = require("../models/Product");
const DeliveryZone = require("../models/DeliveryZone");
const ShippingQuote = require("../models/ShippingQuote");
const PickupLocation = require("../models/PickupLocation");
const { quoteShipping, splitCourierMethodId } = require("../services/shipping/shippingCalculator");
const { buildCartHash } = require("../models/ShippingQuote");
const { fulfilShopOrder, restockOrderItems } = require("../utils/fulfilShopOrder");
const { generateTrackingNumber } = require("../utils/trackingNumber");
const { formatGhs } = require("../utils/money");
const { log, logFromRequest, ACTIONS, RESOURCES } = require("../services/activityLogService");
const { normalizePhone } = require("../utils/phone");
const { buildCustomerOrderFilter } = require("../utils/customerOrderMatch");
const { applyRefundOutcome, mapPaystackRefundStatus } = require("../utils/refunds");
const { sendPreorderReadyEmail, sendShopStatusEmail } = require("../utils/email");
const { CUSTOMER_STAGES } = require("../models/Shipment");

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith("sk_")) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn(
    "⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for payments.",
  );
}

const FRONTEND_URL = require("../utils/frontendUrl")();
const { sanitizeName, sanitizeText, sanitizeEmail } = require("../utils/sanitize");

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `EZW-${ts}${rand}`;
}

/**
 * Resolve whether a variant line is a pre-order, and with what fields.
 *
 * Pre-order can live at two levels: on the product (`product.preorder`) and,
 * per variant, on the variant itself (`variant.preorder`). A variant that has
 * opted into pre-order supports it even when another variant of the same
 * product is in stock — the whole product is no longer a single on/off switch.
 *
 * Resolution rule: the variant's own flag wins (null = unset → fall through to
 * the product). Conversely a variant can be explicitly switched OFF (false)
 * even if the product-level flag is on. Returns `null` when the line cannot be
 * a pre-order at all.
 */
function resolveVariantPreorder(product, variant) {
  const variantPre = variant?.preorder;
  if (variantPre && typeof variantPre.enabled === "boolean") {
    if (!variantPre.enabled) return null;
    return {
      enabled: true,
      availableFrom: variantPre.availableFrom ?? null,
      note: variantPre.note || "",
      maxQty: variantPre.maxQty ?? null,
    };
  }
  if (product.preorder?.enabled) {
    return {
      enabled: true,
      availableFrom: product.preorder.availableFrom ?? null,
      note: product.preorder.note || "",
      maxQty: product.preorder.maxQty ?? null,
    };
  }
  return null;
}

/**
 * POST /api/v1/orders
 * Guest checkout — no auth required. Totals are always computed
 * server-side from the DB; client-submitted prices are never trusted.
 *
 * Two shipping paths coexist for backward compat:
 *   1. NEW (preferred): body includes `shippingQuoteId`. The controller loads
 *      the stored ShippingQuote, validates the cart hash, re-computes server-
 *      side, and charges the verified fee. Tamper-proof.
 *   2. LEGACY: body includes `deliveryZoneId` (old DeliveryZone model). The
 *      controller reads the flat fee from that document. Kept so old checkout
 *      pages don't break until the frontend ships quote support.
 *
 * When neither is provided, shipping is free (pickup / no-delivery orders).
 * The client can never influence the stored fee — it's always computed here.
 */
const createOrder = async (req, res, next) => {
  try {
    const {
      items, deliveryZoneId, customer,
      // T78 new shipping params
      shippingQuoteId, city, neighborhood, address,       method: rawMethod, deliverySpeed: rawSpeed,
      // T80 E2 — region rides along so the calculator can pick the right
      // formula. `pickupLocationId` is NOT destructured here: it would clash
      // with the resolved local declared lower in this function, and the
      // server resolves the authoritative pickup from the quote/DB below.
      region: rawRegion,
    } = req.body;

    // Decompose compound courier method IDs (e.g. "courier_dispatch_express")
    // into method + deliverySpeed so the calculator gets clean params.
    let { method, deliverySpeed } = splitCourierMethodId(rawMethod, rawSpeed);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Cart is empty" });
    }
    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({ success: false, error: "Name and phone are required" });
    }

    // T80 E2 — bus-station pickup without a quote: the customer must name a
    // specific bus station in their city, and that station must be active. The
    // shipping-quote path already validated this; we replicate the check here
    // so a hand-built checkout body can't bypass it.
    if (method === "bus_station_pickup" && !shippingQuoteId) {
      const requestedPickupId = req.body.pickupLocationId;
      if (!requestedPickupId) {
        return res.status(400).json({
          success: false,
          error: "A pickup location is required for bus-station pickup.",
        });
      }
      const pickup = await PickupLocation.findOne({
        _id: requestedPickupId,
        kind: "bus_station",
        isActive: true,
        ...(city ? { city } : {}),
      }).lean();
      if (!pickup) {
        return res.status(400).json({
          success: false,
          error: "The selected pickup location is not available.",
        });
      }
    }

    // ── Build order lines (server-side prices) ─────────────────────────────
    const orderItems = [];

    for (const item of items) {
      const slug = typeof item === "string" ? item : item.slug;
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));

      // `part-<id>` carts were minted before parts and products became one
      // model. The ids survived the merge, so they still resolve — the line is
      // recorded on `part` to match the carts and orders already in flight.
      if (slug.startsWith("part-")) {
        const partId = slug.replace("part-", "");
        const part = await Product.findOne({ _id: partId, sellOnline: true });
        if (!part) {
          return res.status(400).json({ success: false, error: `Part with id ${partId} not found.` });
        }
        if (!Number(part.price) || part.price <= 0) {
          return res.status(400).json({ success: false, error: `${part.name} is not available for ordering.` });
        }
        if (part.stock < qty) {
          return res.status(400).json({ success: false, error: `${part.name} only has ${part.stock} in stock.` });
        }
        orderItems.push({
          part: part._id,
          name: part.name,
          price: Math.round(Number(part.price)),
          qty,
        });
        continue;
      }

      if (!slug) continue;

      const product = await Product.findOne({ slug, sellOnline: true });
      if (!product) {
        return res.status(400).json({ success: false, error: `Product "${slug}" not found.` });
      }

      let variantInfo = null;
      let resolvedPrice = product.price;
      if (item.variant && item.variant.sku) {
        const variant = (product.variants || []).find(
          (v) => v.sku === item.variant.sku,
        );
        if (!variant) {
          return res.status(400).json({
            success: false,
            error: `Variant "${item.variant.sku}" not found for ${product.name}.`,
          });
        }
        if (variant.stock < qty && !product.preorder?.enabled) {
          const label = Object.values(variant.attributes || {}).join(" ");
          return res.status(400).json({
            success: false,
            error: `${product.name}${label ? ` (${label})` : ""} only has ${variant.stock} in stock.`,
          });
        }
        variantInfo = {
          sku: variant.sku,
          attributes:
            variant.attributes && typeof variant.attributes.toObject === "function"
              ? variant.attributes.toObject()
              : variant.attributes || {},
        };
        resolvedPrice = variant.price != null ? variant.price : product.price;
      }

      const availableStock = variantInfo
        ? (product.variants || []).find((v) => v.sku === variantInfo.sku)?.stock ?? 0
        : product.stock;

      const isPreorder = availableStock < qty && Boolean(product.preorder?.enabled);

      if (availableStock < qty && !isPreorder) {
        return res.status(400).json({ success: false, error: `${product.name} only has ${availableStock} in stock.` });
      }

      const cap = product.preorder?.maxQty;
      if (isPreorder && cap != null && qty > cap) {
        return res.status(400).json({
          success: false,
          error: `${product.name} is limited to ${cap} per pre-order.`,
        });
      }

      orderItems.push({
        product: product._id,
        name: product.name,
        ...(variantInfo && { variant: variantInfo }),
        price: resolvedPrice,
        qty,
        ...(isPreorder && { isPreorder: true }),
      });
    }

    const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);

    // ── Shipping fee resolution (server-computed, never client-supplied) ────
    let shippingFee = 0;
    let shippingZoneCode = null;
    let shippingZoneName = null;
    let shippingNeighborhood = null;
    let shippingMethod = null;
    let shippingSpeedVal = "standard";
    let shippingQuoteDoc = null;
    let shippingWeightKg = 0;
    let shippingTierLevel = 0;
    let legacyDeliveryZone = null;
    // T80 E2 — region + pickup snapshot. `pickupLocationName` is the customer-
    // facing label that we keep even if the PickupLocation is later renamed
    // or deactivated; historical orders must read exactly what the buyer
    // selected at checkout time.
    let shippingRegion = null;
    let shippingMethodLabel = "";
    let pickupLocationId = null;
    let pickupLocationName = null;

    if (shippingQuoteId) {
      // ── Path 1: consume a persisted quote (tamper-proof) ────────────────
      shippingQuoteDoc = await ShippingQuote.findOne({
        quoteId: shippingQuoteId,
        consumed: false,
      });
      if (!shippingQuoteDoc) {
        return res.status(400).json({
          success: false,
          error: "Shipping quote not found, expired, or already used. Please request a new quote.",
        });
      }

      // Verify the cart hash — if the client changed any item, city, method,
      // speed, region or pickup location after quoting, the hash won't match.
      // Use the resolved product IDs from the order lines (not the
      // client-supplied slugs) since the quote was built with MongoDB
      // ObjectId strings. T80 E2: region + pickupLocationId ride along so a
      // fulfilment switch (delivery → pickup, or vice-versa) invalidates the
      // quote.
      const resolvedItems = orderItems.map((i) => ({
        productId: String(i.product || i.part || ""),
        quantity: i.qty,
      }));
      const clientHash = buildCartHash(
        resolvedItems,
        shippingQuoteDoc.city,
        shippingQuoteDoc.neighborhood,
        shippingQuoteDoc.method,
        shippingQuoteDoc.deliverySpeed,
        shippingQuoteDoc.region || "",
        shippingQuoteDoc.pickupLocationId ? String(shippingQuoteDoc.pickupLocationId) : "",
      );
      if (clientHash !== shippingQuoteDoc.cartHash) {
        return res.status(400).json({
          success: false,
          error: "Cart contents changed since shipping quote. Please get a new quote.",
        });
      }

      // Also reject if the client changed city/method/speed after quoting —
      // the fee was computed for the quote's parameters, not the request's.
      if (city && city !== shippingQuoteDoc.city) {
        return res.status(400).json({
          success: false,
          error: "Delivery city changed since shipping quote. Please get a new quote.",
        });
      }
      if (neighborhood && neighborhood !== shippingQuoteDoc.neighborhood) {
        return res.status(400).json({
          success: false,
          error: "Delivery neighborhood changed since shipping quote. Please get a new quote.",
        });
      }
      if (method && method !== shippingQuoteDoc.method) {
        return res.status(400).json({
          success: false,
          error: "Delivery method changed since shipping quote. Please get a new quote.",
        });
      }

      // Use the server-stored fee — the client cannot influence it.
      shippingFee = shippingQuoteDoc.shippingFee;
      shippingZoneCode = shippingQuoteDoc.zoneCode;
      shippingZoneName = shippingQuoteDoc.zoneName || null;
      shippingNeighborhood = shippingQuoteDoc.neighborhood || null;
      shippingMethod = shippingQuoteDoc.method;
      shippingSpeedVal = shippingQuoteDoc.deliverySpeed;
      shippingWeightKg = shippingQuoteDoc.totalWeightKg || 0;
      shippingTierLevel = shippingQuoteDoc.tierLevel || 0;
      shippingMethodLabel = shippingQuoteDoc.methodLabel || "";
      // T80 E2 — region + pickup snapshot from the persisted quote.
      shippingRegion = shippingQuoteDoc.region || null;
      pickupLocationId = shippingQuoteDoc.pickupLocationId || null;
      // The quote doc only carries the id; the name is resolved live so the
      // order can still display the human label even if the PickupLocation
      // is later renamed (the order keeps the original label too — see below).
      if (pickupLocationId) {
        const pickup = await PickupLocation.findById(pickupLocationId).lean();
        if (pickup) pickupLocationName = pickup.name;
      }

    } else if (method && city) {
      // ── Path 2: fresh server-side recomputation (no quote) ──────────────
      // The client sends city/address/method/speed but we compute the fee
      // from scratch — this path is for checkouts that didn't pre-quote.
      // T80 E2: region + pickupLocationId are forwarded so the calculator
      // picks the right formula (delivery vs bus-station pickup). The station
      // was validated against the DB at the top of this handler; adopt it here
      // so the order also snapshots where the buyer is actually collecting.
      // Gated on the method so a delivery order carries no stray station id.
      if (method === "bus_station_pickup") {
        pickupLocationId = req.body.pickupLocationId || null;
      }

      const quoteItems = orderItems.map((item) => {
        // Reconstitute a product-like object the calculator needs.
        const pid = item.product || item.part;
        return {
          product: {
            _id: pid,
            name: item.name,
            price: item.price,
            weight: 0,
            weightUnit: "kg",
            isFragile: false,
            category: "",
          },
          quantity: item.qty,
        };
      });

      try {
        const quote = await quoteShipping({
          city,
          neighborhood: neighborhood || "",
          address: address || "",
          method,
          deliverySpeed: deliverySpeed || "standard",
          items: quoteItems,
          subtotal,
            ...(rawRegion ? { region: rawRegion } : {}),
          ...(pickupLocationId ? { pickupLocationId } : {}),
          // Thread the picked neighbourhood through: without it the zone
          // resolver has only free text to work with, and a pricing parameter
          // that quietly defaults to null looks exactly like a working one.
          ...(req.body.neighborhoodId ? { neighborhoodId: req.body.neighborhoodId } : {}),
        });
        shippingFee = quote.shippingFee;
        shippingZoneCode = quote.zoneCode;
        shippingZoneName = quote.zoneName || null;
        shippingNeighborhood = neighborhood || null;
        shippingMethod = method;
        shippingSpeedVal = quote.deliverySpeed || "standard";
        shippingWeightKg = quote.totalWeightKg || 0;
        shippingTierLevel = quote.tierLevel || 0;
        shippingMethodLabel = quote.methodLabel || "";
        // T80 E2 — region rides through; pickupLocationId was adopted from the
        // request body above, and the snapshot name comes from the live
        // PickupLocation so the order survives a rename.
        shippingRegion = quote.region || rawRegion || null;
        if (pickupLocationId) {
          const pickup = await PickupLocation.findById(pickupLocationId).lean();
          if (pickup) pickupLocationName = pickup.name;
        }
      } catch (err) {
        return res.status(err.statusCode || 400).json({
          success: false,
          error: err.message,
        });
      }

    } else if (deliveryZoneId) {
      // ── Path 3: LEGACY delivery zone (deprecated, kept for compat) ──────
      legacyDeliveryZone = await DeliveryZone.findOne({ _id: deliveryZoneId, isActive: true });
      if (!legacyDeliveryZone) {
        return res.status(400).json({ success: false, error: "Invalid delivery zone" });
      }
      shippingFee = legacyDeliveryZone.fee;
    }

    // ── Total assertion ────────────────────────────────────────────────────
    // The total must never go negative (e.g. a coupon > subtotal).
    // ── Client-supplied fee guard ──────────────────────────────────────────
    // Echoing back the figure the buyer saw at checkout is a legitimate UX
    // goal — the total should not shift between checkout and confirmation.
    // Satisfy it by VALIDATING the echoed value, never by trusting it: a
    // crafted body with shippingFee: 0 must not be honoured.
    //
    // Tolerance absorbs client/server rounding only. Below it we refuse (the
    // price genuinely moved, or someone is probing); above it we clamp down to
    // the server figure, because overcharging is not a fix for a stale quote.
    const clientFee = req.body.shippingFee;
    if (clientFee != null && clientFee !== "") {
      const claimed = Number(clientFee);
      const TOLERANCE_PESEWAS = 50; // GH₵0.50
      if (!Number.isFinite(claimed) || claimed < shippingFee - TOLERANCE_PESEWAS) {
        return res.status(409).json({
          success: false,
          error: "Shipping cost has changed since checkout. Please refresh and try again.",
        });
      }
      // Higher than the server's figure: silently use ours, never theirs.
    }

    const total = Math.max(0, subtotal + shippingFee);

    if (!paystack) {
      return res.status(500).json({ success: false, error: "Paystack not configured." });
    }

    const reference = `ORD_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const email = orderCustomerEmail(customer);

    const transaction = await paystack.transaction.initialize({
      email,
      amount: total,
      currency: "GHS",
      reference,
      channels: ["card", "mobile_money"],
      metadata: { type: "shop_order" },
      callback_url: `${FRONTEND_URL}/order-confirmation/${reference}`,
    });

    if (!transaction.status) {
      return res.status(500).json({ success: false, error: "Failed to initialize payment." });
    }

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      trackingNumber: generateTrackingNumber(),
      items: orderItems,
      subtotal,
      // Legacy fields
      ...(legacyDeliveryZone && { deliveryZone: legacyDeliveryZone._id }),
      // T78 shipping fields
      shippingFee,
      shippingZoneCode,
      shippingZoneName,
      shippingNeighborhood,
      shippingMethod,
      shippingSpeed: shippingSpeedVal,
      ...(shippingQuoteDoc && { shippingQuoteId: shippingQuoteDoc._id }),
      shippingWeightKg,
      shippingTierLevel,
      // T80 E2 — region + pickup snapshot live with the order so historical
      // tracking/email copy and admin views don't need to chase references.
      ...(shippingRegion && { shippingRegion }),
      ...(shippingMethodLabel && { shippingMethodLabel }),
      ...(pickupLocationId && { pickupLocationId }),
      ...(pickupLocationName && { pickupLocationName }),
      total,
      // T125 — normalise and cap before persisting. These are guest-supplied and
      // previously only had .trim() applied, so length was bounded by
      // express.json's 5mb limit. The model enforces the same caps (it is not the
      // only writer); doing it here too means the value is clean rather than
      // rejected at save time. sanitize* return undefined when empty, which lets
      // the schema defaults apply.
      customer: {
        name: sanitizeName(customer.name),
        phone: String(customer.phone || "").trim().slice(0, 20),
        phoneDigits: normalizePhone(customer.phone),
        email: sanitizeEmail(customer.email) || "",
        address: sanitizeText(customer.address, 500) || "",
      },
      status: "pending",
      paystackReference: reference,
      trackingHistory: [{
        status: "pending",
        note: "Order placed — awaiting payment confirmation.",
        timestamp: new Date(),
      }],
    });

    // Mark the quote as consumed (atomic — prevents double-spend in a race).
    if (shippingQuoteDoc) {
      await ShippingQuote.findOneAndUpdate(
        { _id: shippingQuoteDoc._id, consumed: false },
        { $set: { consumed: true, consumedAt: new Date(), orderId: order._id } },
      );
    }

    await logOrderCreated(order);

    return res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        accessCode: transaction.data.access_code,
        reference: transaction.data.reference,
        orderId: order._id,
        orderNumber: order.orderNumber,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Log the shop order creation once it has been persisted (guest checkout — no
// authenticated actor, so the record carries the customer snapshot instead).
async function logOrderCreated(order) {
  await log({
    action: ACTIONS.ORDER_CREATED,
    resourceType: RESOURCES.ORDER,
    resourceId: order.orderNumber,
    resourceName: order.orderNumber,
    description: `Order ${order.orderNumber} placed (${order.items.length} item${order.items.length === 1 ? '' : 's'}, ${formatGhs(order.total)})`,
    metadata: {
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      reference: order.paystackReference,
      totalPesewas: order.total,
    },
  });
}

function orderCustomerEmail(customer) {
  const email = (customer.email || '').trim().toLowerCase();
  if (email) return email;
  const phone = (customer.phone || '').trim().replace(/\s+/g, '');
  return `${phone || 'guest'}@eazworld.com`;
}

/**
 * POST /api/v1/orders/track
 * Guest order tracking: orderNumber + phone. The order is only returned
 * when the submitted phone matches customer.phone — this prevents order
 * enumeration by guessing order numbers alone.
 */
const trackOrder = async (req, res, next) => {
  try {
    const { orderNumber, phone } = req.body;

    if (!orderNumber || !phone) {
      return res.status(400).json({ success: false, error: 'Order number and phone are required' });
    }

    const order = await Order.findOne({
      orderNumber: String(orderNumber).trim().toUpperCase()
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (normalizePhone(phone) !== normalizePhone(order.customer.phone)) {
      return res.status(403).json({ success: false, error: 'Phone number does not match this order' });
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/orders/track/:trackingNumber
 * Public — dedicated tracking detail for a shop order. Returns a minimal
 * payload: status, timeline history and delivery destination only. No
 * customer details, items, or money figures leak out, so this URL is safe
 * to share in order-confirmation emails and on dashboards.
 */
const getOrderTracking = async (req, res, next) => {
  try {
    const trackingNumber = String(req.params.trackingNumber || '').trim().toUpperCase();
    if (!trackingNumber) {
      return res.status(400).json({ success: false, error: 'Tracking number is required' });
    }

    const order = await Order.findOne({ trackingNumber })
      .populate('deliveryZone', 'name')
      .populate('items.shipment', 'stage expectedArrival')
      .lean();
    if (!order) {
      return res.status(404).json({ success: false, error: 'Tracking number not found' });
    }

    // T45: where an unreleased pre-order line actually is. Eight operational
    // stages collapse to four the customer can act on, and nothing identifying
    // the supplier, the container or any internal note crosses this line — the
    // rest of this payload is deliberately minimal for the same reason.
    const waiting = (order.items || []).filter((i) => i.isPreorder && !i.preorderReleasedAt);
    const withShipment = waiting.find((i) => i.shipment?.stage);
    const preorder = waiting.length
      ? {
          items: waiting.map((i) => ({ name: i.name, qty: i.qty })),
          stage: withShipment ? CUSTOMER_STAGES[withShipment.shipment.stage]?.key || null : null,
          label: withShipment
            ? CUSTOMER_STAGES[withShipment.shipment.stage]?.label || null
            : 'Confirmed — awaiting shipment',
          expectedArrival: withShipment ? withShipment.shipment.expectedArrival || null : null,
        }
      : null;

    const history = (order.trackingHistory || [])
      .map((e) => ({
        status: e.status,
        note: e.note || '',
        location: e.location || '',
        timestamp: e.timestamp,
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.status(200).json({
      success: true,
      data: {
        trackingNumber: order.trackingNumber,
        orderNumber: order.orderNumber,
        status: order.status,
        destination: order.deliveryZone?.name || '',
        shippingMethod: order.shippingMethod || null,
        shippingSpeed: order.shippingSpeed || null,
        // The label the customer picked, snapshotted at order time.
        shippingMethodLabel: order.shippingMethodLabel || null,
        shippingFee: order.shippingFee || 0,
        shippingZoneCode: order.shippingZoneCode || null,
        shippingZoneName: order.shippingZoneName || null,
        shippingNeighborhood: order.shippingNeighborhood || null,
        createdAt: order.createdAt,
        history,
        latestEvent: history.length ? history[history.length - 1] : null,
        // Null for an ordinary order, so existing clients are unaffected.
        preorder,
        // T80 E2 — pickup-fulfilment snapshot. Null for home-delivery orders.
        // `pickupLocation` is shaped for direct display in the tracking UI;
        // it omits internal fields the public endpoint never exposes.
        pickup: order.shippingMethod === "bus_station_pickup"
          ? {
              name: order.pickupLocationName || null,
              address: null, // live address lookup is admin-only
              region: order.shippingRegion || null,
              readyForPickupAt: order.readyForPickupAt || null,
              pickedUpAt: order.pickedUpAt || null,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Public order view (T86) ─────────────────────────────────────────────────
// What an unauthenticated holder of a payment reference may see: enough for the
// customer to recognise their own order, not enough to be worth stealing.

/** "Ama Owusu" -> "Ama O." — recognisable to its owner, not an identity to others. */
function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const [first, ...rest] = parts;
  return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : first;
}

/** Keeps the last 3 digits: "0244000111" -> "•••••••111". */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 3) return '•'.repeat(digits.length);
  return `${'•'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}

function publicOrderView(order) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    trackingNumber: order.trackingNumber || null,

    subtotal: order.subtotal,
    total: order.total,
    deliveryFee: order.deliveryFee,
    shippingFee: order.shippingFee,
    items: (order.items || []).map((i) => ({
      name: i.name,
      qty: i.qty,
      price: i.price,
      isPreorder: Boolean(i.isPreorder),
    })),

    // Area-level only — the same fields getOrderTracking already exposes
    // publicly. They say which neighbourhood, never which door.
    shippingMethod: order.shippingMethod || null,
    shippingMethodLabel: order.shippingMethodLabel || null,
    shippingSpeed: order.shippingSpeed || null,
    shippingRegion: order.shippingRegion || null,
    shippingNeighborhood: order.shippingNeighborhood || null,
    shippingZoneName: order.shippingZoneName || null,
    pickupLocationName: order.pickupLocationName || null,

    // Masked, so a leaked link cannot be used to contact or locate the
    // customer. No email and no street address at all.
    customer: {
      name: maskName(order.customer?.name),
      phone: maskPhone(order.customer?.phone),
    },
  };
}

/**
 * GET /api/v1/orders/by-reference/:reference
 * Public lookup by Paystack reference for the order confirmation page.
 */
const getOrderByReference = async (req, res, next) => {
  try {
    const order = await Order.findOne({ paystackReference: req.params.reference });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Actively verify the payment with Paystack when the order is still
    // pending — the confirmation page should not depend on the webhook alone.
    if (order.status === 'pending' && paystack) {
      try {
        const verify = await paystack.transaction.verify({ reference: order.paystackReference });
        const tx = verify?.data || {};
        if (verify?.status && tx.status === 'success') {
          // Idempotent (no-op if a webhook already fulfilled it) and guarded —
          // fulfilShopOrder throws rather than fulfil a mismatched charge.
          const paid = await fulfilShopOrder(order.paystackReference, {
            amountPesewas: tx.amount,
            currency:      tx.currency,
          });
          if (paid) order.status = 'paid';
        }
      } catch (e) {
        // Verification is best-effort here; the webhook remains authoritative.
        console.error(`[verify] Could not verify order ${order.orderNumber}:`, e.message);
      }
    }

    // T86 — this route needs no auth, so the response is an explicit projection,
    // not the order document. A reference travels: shared confirmation links,
    // forwarded emails, browser history, referrer headers. Returning the whole
    // document handed anyone holding one the customer's full name, phone, email
    // and delivery address. getOrderTracking, the sibling public route, already
    // redacts the same fields — this brings the two into line.
    res.status(200).json({ success: true, data: publicOrderView(order) });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/orders/mine
 * Shop orders for the logged-in customer. Orders are guest checkouts, so we
 * match them to the account by the customer's email and/or phone (several
 * common phone formats), never by a stored user id.
 */
const getMyOrders = async (req, res, next) => {
  try {
    // Shop orders are guest checkouts with no `user` ref, so they are linked to
    // an account by the contact details captured at checkout. That matcher now
    // lives in utils/customerOrderMatch so the admin user-detail page uses the
    // SAME rule — two copies would drift, and an admin would silently see a
    // different set of orders than the customer sees for themselves.
    const filter = buildCustomerOrderFilter({ email: req.user?.email, phone: req.user?.phone });
    if (!filter) return res.status(200).json({ success: true, count: 0, data: [] });

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};

const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];

// Forward-only status flow. An order may move to any *later* stage (skips like
// paid → delivered are allowed), or be cancelled while still live. Same-status
// is a no-op. `delivered` and `cancelled` are terminal. This only blocks
// backward moves and changes out of a terminal state.
const STATUS_RANK = { pending: 0, paid: 1, processing: 2, shipped: 3, delivered: 4 };
function canTransition(from, to) {
  if (from === to) return true;                                   // no-op
  if (from === 'delivered' || from === 'cancelled') return false; // terminal
  if (to === 'cancelled') return true;                            // cancel any live order
  return (STATUS_RANK[to] ?? -1) > (STATUS_RANK[from] ?? -1);     // forward only
}

const getOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && ORDER_STATUSES.includes(status)) {
      query.status = status;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const orders = await Order.find(query)
      .populate('deliveryZone')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/orders/preorders — the release queue (admin/staff).
 *
 * Paid orders carrying at least one pre-order line that has not been released.
 * Unpaid ones are excluded: nothing is owed to the customer until the money has
 * actually landed, and releasing one would move stock for an order that may never
 * be paid.
 */
const getPreorders = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const orders = await Order.find({
      status: { $in: ['paid', 'processing'] },
      items: { $elemMatch: { isPreorder: true, preorderReleasedAt: null } },
    })
      .sort({ createdAt: 1 }) // oldest first — longest-waiting customer at the top
      .limit(limit)
      .lean();

    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/orders/:id/preorder-release — the stock has landed (admin/staff).
 *
 * This is the moment a pre-order becomes a normal line: stock moves, `sold`
 * counts it, and the customer is told. Deliberately manual — stock changes for
 * plenty of reasons (a correction, a return, a POS void) and none of those should
 * ship anything by themselves.
 */
const releasePreorder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (!['paid', 'processing'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: 'Only a paid order can have its pre-order released.',
      });
    }

    const pending = order.items.filter((i) => i.isPreorder && !i.preorderReleasedAt);
    if (!pending.length) {
      return res.status(400).json({
        success: false,
        error: 'This order has no pre-order lines waiting to be released.',
      });
    }

    const released = [];
    const short = [];

    for (const item of pending) {
      // The same guarded decrement fulfilment uses, for the same reason: never
      // oversell. If the stock is not actually there yet, this line stays queued
      // rather than being marked released against inventory that does not exist.
      const filter = item.variant?.sku
        ? { _id: item.product, variants: { $elemMatch: { sku: item.variant.sku, stock: { $gte: item.qty } } } }
        : { _id: item.product, stock: { $gte: item.qty } };
      const update = item.variant?.sku
        ? { $inc: { 'variants.$.stock': -item.qty, sold: item.qty } }
        : { $inc: { stock: -item.qty, sold: item.qty } };

      const result = await Product.findOneAndUpdate(filter, update);
      if (!result) {
        short.push(item.name);
        continue;
      }
      item.preorderReleasedAt = new Date();
      released.push(item);
    }

    if (!released.length) {
      return res.status(400).json({
        success: false,
        error: `Not enough stock to release: ${short.join(', ')}.`,
      });
    }

    order.trackingHistory.push({
      status: order.status,
      note: `Pre-order released: ${released.map((i) => i.name).join(', ')}.`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await order.save();

    // Best-effort: a mail failure must not undo a release that already moved stock.
    sendPreorderReadyEmail(order, released).catch(() => {});

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: `Pre-order released for ${order.orderNumber} — ${released.map((i) => i.name).join(', ')}`,
      metadata: { released: released.length, short },
    });

    res.status(200).json({
      success: true,
      data: order,
      // Named so the caller can tell a full release from a partial one.
      meta: { released: released.length, short },
    });
  } catch (error) {
    next(error);
  }
};

const getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('deliveryZone');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/orders/mine/:id
 * A logged-in customer's own order detail. Ownership is verified the same way
 * as getMyOrders — email and/or normalized phone must match — so a customer
 * can never view another account's order by id.
 */
const getMyOrderById = async (req, res, next) => {
  try {
    const or = [];
    if (req.user?.email) {
      or.push({ 'customer.email': String(req.user.email).toLowerCase() });
    }
    if (req.user?.phone) {
      const digits = normalizePhone(req.user.phone);
      if (digits) {
        or.push({ 'customer.phoneDigits': digits });
        or.push({ 'customer.phone': { $in: [req.user.phone, digits] } });
      }
    }
    if (!or.length) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const order = await Order.findOne({ _id: req.params.id, $or: or }).populate('deliveryZone');
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Valid status required: ${ORDER_STATUSES.join(', ')}`
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (!canTransition(order.status, status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot change order from "${order.status}" to "${status}".`,
      });
    }

    const prevStatus = order.status;
    order.status = status;
    if (status === 'paid' && !order.paidAt) {
      order.paidAt = new Date();
    }
    if (status === 'cancelled' && order.stockDeducted && !order.stockRestored) {
      await restockOrderItems(order);
      order.stockRestored = true;
    }
    // T80 E2 — pickup lifecycle markers. For bus-station-pickup orders:
    //   `shipped`   → readyForPickupAt (parcel reached the chosen station)
    //   `delivered` → pickedUpAt      (customer collected the parcel)
    // We deliberately reuse the existing 'shipped' / 'delivered' status values
    // (no new enum) so reports and forward-only transitions keep working.
    if (order.shippingMethod === "bus_station_pickup") {
      if (status === "shipped" && !order.readyForPickupAt) {
        order.readyForPickupAt = new Date();
      }
      if (status === "delivered" && !order.pickedUpAt) {
        order.pickedUpAt = new Date();
      }
    }
    order.trackingHistory.push({
      status,
      note: `Status updated to ${status}.`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await order.save();

    if (prevStatus !== status) {
      await logFromRequest(req, {
        action: status === 'cancelled' ? ACTIONS.ORDER_CANCELLED : ACTIONS.ORDER_STATUS_CHANGED,
        resourceType: RESOURCES.ORDER,
        resourceId: order.orderNumber,
        resourceName: order.orderNumber,
        description: status === 'cancelled'
          ? `Order ${order.orderNumber} cancelled`
          : `Order ${order.orderNumber} status changed ${prevStatus} → ${status}`,
        changes: [{ field: 'status', label: 'Order Status', before: prevStatus, after: status }],
      });

    // T78 — when an order reaches delivered, settle the courier payout.
    // Best-effort: a settlement failure must not block the status update.
    if (status === "delivered" && prevStatus !== "delivered") {
      const { settleDeliveryCharge } = require("../services/shipping/settleDeliveryCharge");
      settleDeliveryCharge(order).catch((err) => {
        console.error("[settle] delivery charge settlement failed:", err.message);
      });
    }

    // T62 — the customer hears about meaningful moves, like repair jobs already
    // do. Best-effort: never let a mail problem fail a status change.
    sendShopStatusEmail(order).catch(() => {});
  }

  res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/orders/:id/tracking  (staff/admin)
 * Append a tracking event — status change and/or a staff note with an
 * optional location. When `status` is supplied and valid it also advances
 * the order status, so the order and its history never drift apart.
 */
const addTrackingEvent = async (req, res, next) => {
  try {
    const { status, note, location } = req.body;

    if (status && !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Valid status required: ${ORDER_STATUSES.join(', ')}`
      });
    }
    if (!status && !note) {
      return res.status(400).json({ success: false, error: 'A status or note is required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (status && !canTransition(order.status, status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot change order from "${order.status}" to "${status}".`,
      });
    }

    const prevStatus = order.status;
    if (status) {
      order.status = status;
      if (status === 'paid' && !order.paidAt) {
        order.paidAt = new Date();
      }
      if (status === 'cancelled' && order.stockDeducted && !order.stockRestored) {
        await restockOrderItems(order);
        order.stockRestored = true;
      }
      // T80 E2 — pickup lifecycle markers (see updateOrderStatus for the
      // rationale — same rules apply on this door).
      if (order.shippingMethod === "bus_station_pickup") {
        if (status === "shipped" && !order.readyForPickupAt) {
          order.readyForPickupAt = new Date();
        }
        if (status === "delivered" && !order.pickedUpAt) {
          order.pickedUpAt = new Date();
        }
      }
    }

    order.trackingHistory.push({
      status: status || order.status,
      note: note ? String(note).trim() : `Status updated to ${status}.`,
      location: location ? String(location).trim() : '',
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await order.save();

    const statusChanged = status && status !== prevStatus;
    const changes = [];
    if (statusChanged) {
      changes.push({ field: 'status', label: 'Order Status', before: prevStatus, after: status });
    }
    if (note) {
      changes.push({ field: 'note', label: 'Tracking Note', before: null, after: String(note).trim() });
    }
    if (location) {
      changes.push({ field: 'location', label: 'Location', before: null, after: String(location).trim() });
    }
    await logFromRequest(req, {
      action: statusChanged
        ? (status === 'cancelled' ? ACTIONS.ORDER_CANCELLED : ACTIONS.ORDER_STATUS_CHANGED)
        : ACTIONS.ORDER_TRACKING_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: statusChanged
        ? `Order ${order.orderNumber} status changed ${prevStatus} → ${status}`
        : `Tracking updated for order ${order.orderNumber}`,
      changes,
    });

    // T62 — the tracking endpoint is the other door status changes walk through.
    // Notes-only updates don't email; only a real status move does.
    if (statusChanged) sendShopStatusEmail(order).catch(() => {});

    // T78 — settle courier payout on delivered (same as updateOrderStatus).
    if (status === "delivered" && statusChanged) {
      const { settleDeliveryCharge } = require("../services/shipping/settleDeliveryCharge");
      settleDeliveryCharge(order).catch((err) => {
        console.error("[settle] delivery charge settlement failed:", err.message);
      });
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

// T15 — a refund is a payment outcome, not a fulfilment stage: no "refunded"
// value was added to ORDER_STATUSES. T78 — delivered orders are now eligible
// too (refund the shipping charge after settlement).
const REFUND_ELIGIBLE_STATUSES = ['paid', 'processing', 'shipped', 'delivered'];

/**
 * POST /api/v1/orders/:id/refund  (admin only)
 * Full-order refund via Paystack. Claim-then-call: the atomic write below
 * flips refund.status 'none' -> 'processing' *before* the Paystack API call
 * fires, so (a) two simultaneous requests can't both proceed — the second
 * gets no match and 409s — and (b) a crash between the claim and the
 * Paystack call fails safe: a stuck 'processing' record with no money moved,
 * recoverable via /refund/sync or the reconcile job, rather than risking a
 * duplicate refund attempt. See backend-eaz/tasks.md T15 for the full design
 * writeup, including why call-then-claim was rejected.
 */
const refundOrder = async (req, res, next) => {
  try {
    if (!paystack) {
      return res.status(500).json({ success: false, error: 'Paystack not configured.' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (!order.paystackReference) {
      return res.status(400).json({ success: false, error: 'Order has no Paystack payment to refund.' });
    }
    if (!REFUND_ELIGIBLE_STATUSES.includes(order.status)) {
      return res.status(400).json({ success: false, error: `Cannot refund an order with status "${order.status}".` });
    }

    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : '';

    // Atomic claim. Re-checks the same conditions as above so a race between
    // the reads and this write can't slip a second refund through.
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, 'refund.status': 'none', status: { $in: REFUND_ELIGIBLE_STATUSES } },
      {
        $set: {
          'refund.status': 'processing',
          'refund.amount': order.total,
          'refund.reason': reason,
          'refund.requestedBy': req.user._id,
          'refund.requestedAt': new Date(),
        },
      },
      { new: true }
    );
    if (!claimed) {
      return res.status(409).json({ success: false, error: 'A refund is already in progress or completed for this order.' });
    }

    await logFromRequest(req, {
      action: ACTIONS.REFUND_INITIATED,
      resourceType: RESOURCES.PAYMENT,
      resourceId: claimed.orderNumber,
      resourceName: `Order ${claimed.orderNumber}`,
      description: `Refund initiated for order ${claimed.orderNumber} (${formatGhs(claimed.total)})`,
      metadata: { reason },
    });

    let refundResponse;
    try {
      refundResponse = await paystack.refund.create({
        transaction: claimed.paystackReference,
        amount: claimed.total,
        currency: 'GHS',
        merchant_note: reason || undefined,
      });
    } catch (err) {
      // The claim already flipped refund.status to 'processing'. We don't
      // know whether Paystack received the request before this error, so we
      // don't guess — leave it in 'processing' and let /refund/sync or the
      // reconcile job ask Paystack directly, rather than risk a duplicate
      // refund by blindly retrying create() here.
      console.error(`[refund] paystack.refund.create threw for order ${claimed.orderNumber}:`, err.message);
      return res.status(202).json({
        success: true,
        data: claimed,
        warning: 'Refund request sent but not yet confirmed. Status will update automatically, or use /refund/sync to check now.',
      });
    }

    if (!refundResponse?.status) {
      // Paystack responded and rejected the request outright — this is a
      // confirmed failure, not an ambiguous one, so mark it now.
      await applyRefundOutcome(claimed, 'failed', req.user);
      return res.status(502).json({
        success: false,
        error: refundResponse?.message || 'Paystack rejected the refund request.',
        data: claimed,
      });
    }

    claimed.refund.reference = refundResponse.data?.id != null ? String(refundResponse.data.id) : null;
    // Reuse the exact cancellation transition + T2 restock the rest of this
    // app already uses — a refund IS a cancellation, plus payment detail.
    claimed.status = 'cancelled';
    if (claimed.stockDeducted && !claimed.stockRestored) {
      await restockOrderItems(claimed);
      claimed.stockRestored = true;
    }
    claimed.trackingHistory.push({
      status: 'cancelled',
      note: `Order cancelled — refund initiated (${formatGhs(claimed.total)}).`,
      updatedBy: { name: req.user?.name || '', role: req.user?.role || '' },
      timestamp: new Date(),
    });
    await claimed.save();

    // T78 — if a delivery charge was settled, mark it refunded so the summary
    // reports don't double-count. Best-effort: a DeliveryCharge write failure
    // must not block the order refund.
    const DeliveryCharge = require("../models/DeliveryCharge");
    DeliveryCharge.findOneAndUpdate(
      { orderId: claimed._id, refunded: false },
      { $set: { refunded: true, refundedAt: new Date() } },
    ).catch(() => {});

    res.status(200).json({ success: true, data: claimed });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/orders/:id/refund/sync  (admin only)
 * Manual reconciliation — asks Paystack directly what a refund's real status
 * is. Fallback for when the refund.processed/refund.failed webhook doesn't
 * arrive; Paystack webhook delivery has never been live-verified in this
 * project (see backend-eaz/tasks.md T3b — still blocked). Read-only against
 * Paystack (refund.fetch), safe to call repeatedly.
 */
const syncRefund = async (req, res, next) => {
  try {
    if (!paystack) {
      return res.status(500).json({ success: false, error: 'Paystack not configured.' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (!order.refund?.reference) {
      return res.status(400).json({ success: false, error: 'No refund reference to check for this order.' });
    }
    if (['completed', 'failed'].includes(order.refund.status)) {
      return res.status(200).json({ success: true, data: order }); // already settled
    }

    const result = await paystack.refund.fetch({ id: order.refund.reference });
    const outcome = mapPaystackRefundStatus(result?.data?.status);
    if (outcome) await applyRefundOutcome(order, outcome, req.user);
    // else: still in-flight at Paystack's end — leave as 'processing'.

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/orders/:id/address  (admin/staff)
 * Change the delivery address and recalculate the shipping fee. Blocked once
 * the order reaches "shipped" status — the goods are already on the way.
 *
 * The old address + fee + zone are pushed onto `addressHistory` so the
 * complete trail is auditable. If the fee changes, the order total is
 * adjusted accordingly and the delta is surfaced in the response.
 *
 * T80 E2: accepts `region` + `pickupLocationId` so an address change can
 * also move a customer between delivery zones (e.g. East Legon → Kumasi
 * switches fulfilment from in-house to bus-station pickup). Pickup
 * location id is validated live; the snapshot name is preserved.
 *
 * NOTE: this does NOT re-authorize a Paystack payment. If the new total is
 * higher the customer must pay the difference separately (Phase 5 settle
 * endpoint); if lower the delta is a credit. The webhook handler must be
 * aware of this.
 */
const changeOrderAddress = async (req, res, next) => {
  try {
    let { address, neighborhood, city, method, deliverySpeed, region, pickupLocationId } = req.body;

    // Decompose compound courier method IDs.
    ({ method, deliverySpeed } = splitCourierMethodId(method, deliverySpeed));

    if (!neighborhood || !city || !method) {
      return res.status(400).json({
        success: false,
        error: "neighborhood, city, and method are required.",
      });
    }

    // T80 E2 — bus-station pickup on an address change must still name a
    // real, active station in the destination city.
    let pickupLocationName = null;
    if (method === "bus_station_pickup") {
      if (!pickupLocationId) {
        return res.status(400).json({
          success: false,
          error: "A pickup location is required for bus-station pickup.",
        });
      }
      const pickup = await PickupLocation.findOne({
        _id: pickupLocationId,
        kind: "bus_station",
        isActive: true,
        ...(city ? { city } : {}),
      }).lean();
      if (!pickup) {
        return res.status(400).json({
          success: false,
          error: "The selected pickup location is not available.",
        });
      }
      pickupLocationName = pickup.name;
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found." });
    }
    if (["shipped", "delivered", "cancelled"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot change address for an order with status "${order.status}".`,
      });
    }

    // Build order-like items the calculator can consume.
    const quoteItems = order.items.map((item) => ({
      product: {
        _id: item.product || item.part,
        name: item.name,
        price: item.price,
        weight: 0,
        weightUnit: "kg",
        isFragile: false,
        category: "",
      },
      quantity: item.qty,
    }));

    let newShippingFee = 0;
    let newZoneCode = null;
    let newWeightKg = 0;
    let newTierLevel = 0;
    let newRegion = null;

    try {
      const quote = await quoteShipping({
        city,
        neighborhood: neighborhood || "",
        address: address || "",
        method,
        deliverySpeed: deliverySpeed || order.shippingSpeed || "standard",
        items: quoteItems,
        subtotal: order.subtotal,
        ...(region ? { region } : {}),
        ...(pickupLocationId ? { pickupLocationId } : {}),
      });
      newShippingFee = quote.shippingFee;
      newZoneCode = quote.zoneCode;
      newWeightKg = quote.totalWeightKg || 0;
      newTierLevel = quote.tierLevel || 0;
      newRegion = quote.region || region || null;
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: err.message,
      });
    }

    // Record the change in addressHistory.
    order.addressHistory.push({
      address: order.customer.address,
      shippingFee: order.shippingFee,
      zoneCode: order.shippingZoneCode,
      changedBy: req.user?.name || "staff",
      changedAt: new Date(),
    });

    const oldFee = order.shippingFee;
    const oldTotal = order.total;

    // Update order fields.
    order.customer.address = String(address || "").trim();
    order.shippingFee = newShippingFee;
    order.shippingZoneCode = newZoneCode;
    order.shippingMethod = method;
    order.shippingSpeed = deliverySpeed || order.shippingSpeed || "standard";
    order.shippingWeightKg = newWeightKg;
    order.shippingTierLevel = newTierLevel;
    // T80 E2 — region + pickup live with the order so the historical
    // record shows the new fulfilment context, not a re-query.
    order.shippingRegion = newRegion;
    order.pickupLocationId = method === "bus_station_pickup" ? pickupLocationId : null;
    order.pickupLocationName = method === "bus_station_pickup" ? pickupLocationName : null;
    order.total = Math.max(0, order.subtotal + newShippingFee);

    await order.save();

    await logFromRequest(req, {
      action: ACTIONS.ORDER_UPDATED,
      resourceType: RESOURCES.ORDER,
      resourceId: order.orderNumber,
      resourceName: order.orderNumber,
      description: `Address changed for ${order.orderNumber}: fee ${formatGhs(oldFee)} → ${formatGhs(newShippingFee)}`,
      changes: [
        { field: "customer.address", label: "Address", before: "(previous)", after: address },
        { field: "shippingFee", label: "Shipping Fee", before: oldFee, after: newShippingFee },
      ],
    });

    res.status(200).json({
      success: true,
      data: order,
      meta: {
        oldShippingFee: oldFee,
        newShippingFee,
        feeDifference: newShippingFee - oldFee,
        oldTotal,
        newTotal: order.total,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getPreorders,
  releasePreorder,
  getMyOrders,
  getMyOrderById,
  getOrderByReference,
  trackOrder,
  getOrderTracking,
  getOrders,
  getOrder,
  updateOrderStatus,
  addTrackingEvent,
  refundOrder,
  syncRefund,
  changeOrderAddress,
  normalizePhone
};
