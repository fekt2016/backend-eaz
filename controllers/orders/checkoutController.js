/**
 * Placing an order: pricing, stock, shipping quote and the Paystack handoff.
 *
 * Split out of controllers/orderController.js, which re-exports these so the
 * route files are unchanged. Moved verbatim — no logic was rewritten.
 */
const {
  crypto, Paystack, Order, Product, DeliveryZone, ShippingQuote,
  PickupLocation, quoteShipping, splitCourierMethodId, buildCartHash,
  generateTrackingNumber, formatGhs, log, ACTIONS, RESOURCES,
  normalizePhone, paystack, FRONTEND_URL, sanitizeName, sanitizeText,
  sanitizeEmail, resolveVariantPreorder,
} = require("./common");


function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `EZW-${ts}${rand}`;
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
      // The stored variant document, kept alongside the stripped snapshot below.
      // `variantInfo` is only what gets written onto the order — {sku, attributes} —
      // so it carries neither the stock nor the variant's own pre-order flag.
      // Reading the flag off it meant a variant-level pre-order resolved to null
      // and checkout rejected the line as out of stock.
      let matchedVariant = null;
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
        if (variant.stock < qty && !resolveVariantPreorder(product, variant)) {
          const label = Object.values(variant.attributes || {}).join(" ");
          return res.status(400).json({
            success: false,
            error: `${product.name}${label ? ` (${label})` : ""} only has ${variant.stock} in stock.`,
          });
        }
        matchedVariant = variant;
        variantInfo = {
          sku: variant.sku,
          attributes:
            variant.attributes && typeof variant.attributes.toObject === "function"
              ? variant.attributes.toObject()
              : variant.attributes || {},
        };
        resolvedPrice = variant.price != null ? variant.price : product.price;
      }

      const availableStock = matchedVariant ? matchedVariant.stock ?? 0 : product.stock;

      const resolvedPreorder = resolveVariantPreorder(product, matchedVariant);
      const isPreorder = availableStock < qty && Boolean(resolvedPreorder);

      if (availableStock < qty && !isPreorder) {
        return res.status(400).json({ success: false, error: `${product.name} only has ${availableStock} in stock.` });
      }

      const cap = resolvedPreorder?.maxQty;
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

module.exports = {
  createOrder,
};
