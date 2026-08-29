const Product = require("../models/Product");
const ShippingSettings = require("../models/ShippingSettings");
const ShippingZone = require("../models/ShippingZone");
const ShippingQuote = require("../models/ShippingQuote");
const Location = require("../models/Location");
const PickupLocation = require("../models/PickupLocation");
const { quoteShipping, splitCourierMethodId } = require("../services/shipping/shippingCalculator");
const { buildCartHash } = require("../models/ShippingQuote");
const { shippingCache } = require("../services/shipping/shippingCache");
const Neighborhood = require("../models/Neighborhood");
const logger = require("../utils/logger");
const { resolveZoneByNeighborhoodId, resolveZoneByName } = require("../services/shipping/zoneResolver");
const { calcShipping } = require("../services/shipping/distanceFee");
const { SAME_DAY_SPEEDS, sameDayWindowOpen } = require("../services/shipping/shippingCalculator");

/**
 * POST /api/v1/shipping/quote
 * Public — returns a server-computed shipping quote. Products are loaded from
 * the DB (active only) and every weight/category/fragility is read from those
 * records; the request body supplies only productIds and quantities. Prices
 * in the response are server-computed — the client cannot influence them.
 */
const getQuote = async (req, res, next) => {
  try {
    let {
      city, neighborhood, address, method, deliverySpeed, items, region, pickupLocationId,
      // The id the buyer picked from the neighbourhood list. Read it here, pass
      // it to quoteShipping, and let quoteShipping hand it to the resolver —
      // a pricing parameter that is silently defaulted at any link in that
      // chain is indistinguishable from a working one until you check output.
      neighborhoodId,
    } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ success: false, error: "At least one item is required." });
    }

    // Decompose compound courier method IDs (e.g. "courier_dispatch_express")
    // into method + deliverySpeed so the calculator gets clean params.
    ({ method, deliverySpeed } = splitCourierMethodId(method, deliverySpeed));

    // For bus-station pickup, the chosen pickup point must be a real, active
    // station in the city — the shippingFee may depend on it and the order
    // will snapshot its name, so validate it up front.
    if (method === "bus_station_pickup") {
      if (!pickupLocationId) {
        return res.status(400).json({
          success: false,
          error: "A pickup location is required for bus-station pickup.",
        });
      }
      const p = await PickupLocation.findOne({
        _id: pickupLocationId,
        kind: "bus_station",
        isActive: true,
        ...(city ? { city } : {}),
      }).lean();
      if (!p) {
        return res.status(400).json({
          success: false,
          error: "The selected pickup location is not available.",
        });
      }
    }

    // Load every catalogue line the client referenced. Shop stock, counter
    // stock and bench parts are one collection now, so this is a single lookup
    // — the Part fallback this used to need is gone with the merge.
    const productIds = items.map((i) => String(i.productId));
    const uniqueIds = [...new Set(productIds)];

    const catalogue = await Product.find({ _id: { $in: uniqueIds }, sellOnline: true })
      .lean()
      .select("_id name category weight weightUnit isFragile price");

    // Compare by id, not by count: two variants of one product are two cart
    // lines sharing a single product id, and a count check would reject that
    // cart as "unavailable".
    const found = new Set(catalogue.map((c) => String(c._id)));
    const missing = uniqueIds.filter((id) => !found.has(id));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `One or more products are unavailable or do not exist.`,
        invalidProductIds: missing,
      });
    }

    // Map catalogue docs to { product, quantity } and compute the server-side
    // subtotal — the fee formula needs it for the free-delivery threshold.
    const quoteItems = items.map((item) => {
      const product = catalogue.find((c) => String(c._id) === String(item.productId));
      return { product, quantity: item.quantity };
    });

    const subtotal = quoteItems.reduce(
      (sum, { product, quantity }) => sum + product.price * quantity,
      0,
    );

    const quote = await quoteShipping({
      city,
      neighborhood,
      address,
      method,
      deliverySpeed,
      items: quoteItems,
      subtotal,
      region: region || "",
      pickupLocationId: pickupLocationId || null,
      neighborhoodId: neighborhoodId || null,
    });

    // Build a canonical cart hash so the order controller can later verify
    // the checkout cart matches this exact quote. T80 E2: region + pickup
    // location ride along so a customer who switches fulfilment mode at
    // checkout invalidates the quote (cartHash will not match).
    const cartHash = buildCartHash(items, city, neighborhood, method, deliverySpeed, region, pickupLocationId);

    // Persist the quote (15 min TTL) so checkout can consume it.
    // T80 E2: region + pickupLocationId ride along so the order controller
    // can later reproduce the fulfilment context (and the cartHash can
    // detect a checkout-time mode switch).
    const quoteDoc = await ShippingQuote.create({
      city,
      neighborhood,
      address,
      method,
      deliverySpeed,
      region: region || "",
      pickupLocationId: pickupLocationId || null,
      cartHash,
      methodLabel: quote.methodLabel || "",
      shippingFee: quote.shippingFee,
      grossShippingFee: quote.grossShippingFee,
      freeDeliveryApplied: quote.freeDeliveryApplied,
      zoneCode: quote.zoneCode,
      zoneName: quote.zoneName,
      tierLevel: quote.tierLevel,
      totalWeightKg: quote.totalWeightKg,
      weightAssumed: quote.weightAssumed,
      estimatedDays: quote.estimatedDays,
      productIds: productIds.map(String),
      userId: req.user?.id || null,
    });

    // Return productIds + quoteId alongside the quote payload so the
    // storefront can build a "your shipping: GH₵ X.XX" banner and pass
    // the quoteId to checkout.
    return res.status(200).json({
      success: true,
      data: {
        ...quote,
        productIds,
        quoteId: quoteDoc.quoteId,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/shipping/methods?city=Accra
 * Public — which methods are available for a given city, with estimated days
 * and an indicative fee. Driven entirely by the settings flags; the indicative
 * fee is computed with a 1 kg dummy item against the default zone, so it's
 * directionally useful without being misleading.
 */
/**
 * Whether a speed tier can be offered right now. The calculator refuses a
 * same-day promise past the cutoff hour and on closed days — and express is a
 * same-day promise — so offering one after the cutoff would show the customer
 * an option that fails the moment they pick it.
 */
function speedBookableNow(settings, code) {
  // The `same_day` tier needs its master switch on; it is not a service we
  // sell. Express is sold, so it answers to the delivery window alone.
  if (code === "same_day" && !settings.sameDayAvailable) return false;
  if (!SAME_DAY_SPEEDS.includes(code)) return true;
  // The same predicate quoteShipping refuses with, so the list cannot offer a
  // speed the quote then rejects.
  return sameDayWindowOpen(settings, code).open;
}

const getMethods = async (req, res, next) => {
  try {
    const settings = await ShippingSettings.getSettings();
    const city = req.query.city;
    const neighborhood = req.query.neighborhood;
    const region = req.query.region ? String(req.query.region).trim() : "";

    // Determine whether this is a Greater-Accra-core city (home delivery) or a
    // regional city (bus-station pickup). The authoritative test is
    // Location.inAccraCore; falls back to the legacy Accra/Tema enum.
    let inAccraCore = ["Accra", "Tema"].includes(city);
    if (region) {
      const loc = await Location.findOne({
        region,
        city: city || "",
        isActive: true,
      }).lean();
      inAccraCore = loc ? Boolean(loc.inAccraCore) : false;
    }

    // Regional city → bus-station pickup is the only fulfilment method.
    if (region && !inAccraCore) {
      const pickups = await PickupLocation.find({
        kind: "bus_station",
        isActive: true,
        ...(city ? { city } : {}),
      }).lean();
      const pickupsMapped = pickups.map((p) => ({
        id: String(p._id),
        name: p.name,
        city: p.city,
        address: p.address,
        landmark: p.landmark,
      }));
      return res.status(200).json({
        success: true,
        data: {
          methods: settings.pickupAvailable
            ? [{
                id: "bus_station_pickup",
                name: "Bus Station Pickup",
                speed: "standard",
                available: true,
                estimatedDays: null,
                indicativeFee: null,
                isPickup: true,
              }]
            : [],
          pickups: pickupsMapped,
          freeDeliveryThreshold: null,
          freeDeliveryCurrency: null,
        },
      });
    }

    const methods = [];

    if (settings.inHouseDeliveryAvailable) {
      methods.push({
        id: "in_house_delivery",
        name: "In-House Delivery",
        speed: "standard",
        available: true,
        estimatedDays: null,
        // Our own rider — free by definition, in the calculator and here.
        // It used to report a null fee, which the storefront rendered as "—"
        // when the one method that is genuinely always free is the one that
        // should say so.
        indicativeFee: 0,
        freeDeliveryApplied: true,
      });
    }

    if (settings.courierDispatchAvailable) {
      // Only speeds that are bookable right now — the same-day switch, then the
      // cutoff and closed days, which express answers to as well. The
      // distance-zone branch below filters its own tiers through the same test.
      const speeds = [
        { speed: "standard", label: "Courier — Standard" },
        { speed: "express", label: "Courier — Express" },
        { speed: "same_day", label: "Courier — Same Day" },
      ].filter(({ speed }) => speedBookableNow(settings, speed));

      // ── Real per-speed prices from the A–F distance zone ──────────────────
      //
      // The storefront shows these BEFORE it asks for a quote, so if they come
      // from a different rate card than the quote does, the price visibly
      // changes under the customer a second after they pick a method. That is
      // exactly what happened: this block priced from the legacy city zone
      // while the quote priced from the A–F zone, and it could not see the
      // cart at all, so a basket over the free-delivery threshold flipped from
      // a fee to "Free" once the quote landed.
      //
      // Given a neighbourhood (and optionally the cart's subtotal and weight)
      // we now price through the SAME calculator the quote uses, so the number
      // shown here is the number charged.
      if (settings.useDistanceZones && inAccraCore && (req.query.neighborhoodId || neighborhood)) {
        try {
          const resolved = req.query.neighborhoodId
            ? await resolveZoneByNeighborhoodId(req.query.neighborhoodId)
            : await resolveZoneByName(neighborhood, city);

          const weightKg = Number(req.query.weightKg) || 0;

          // Offer exactly the tiers THIS ZONE defines, rather than a list
          // hardcoded here. A hardcoded list drifts: the seeded zones carry a
          // next_day tier that this endpoint never offered, while offering a
          // same_day one the quote could then reject.
          const tiers = (resolved.zone.speedTiers || []).filter((t) =>
            speedBookableNow(settings, t.code));

          for (const tier of tiers) {
            let fee = null;
            try {
              fee = calcShipping(resolved.zone, weightKg, tier.code, false);
            } catch {
              // The zone cannot price this tier: omit the price rather than
              // substitute a cheaper one.
              fee = null;
            }
            // Courier is never free — a third party is paid per delivery.
            const free = false;

            methods.push({
              id: `courier_dispatch_${tier.code}`,
              name: `Courier — ${tier.label}`,
              speed: tier.code,
              available: true,
              estimatedDays: tier.estimatedDays || resolved.zone.estimatedDaysLabel || String(resolved.zone.estimatedDays),
              indicativeFee: free ? 0 : fee,
              freeDeliveryApplied: free,
              zone: resolved.zone.zoneKey,
              // These are the charged figures, not estimates — the storefront
              // can render them without a "from" hedge.
              exact: fee != null,
            });
          }

          return res.status(200).json({
            success: true,
            data: {
              methods,
              zone: resolved.zone.zoneKey,
              freeDeliveryThreshold: null,
              freeDeliveryCurrency: null,
            },
          });
        } catch (err) {
          // Could not resolve a zone (unknown area, zone switched off). Fall
          // through to the legacy estimate below rather than failing the whole
          // methods list — the quote endpoint is what refuses the order.
          logger.warn(`[shipping] methods: zone lookup failed — ${err.message}`);
        }
      }

      // Legacy estimate — used when distance zones are off, or outside the
      // Accra core, or when the area could not be resolved.
      let zone = null;
      if (city && ["Accra", "Tema"].includes(city)) {
        const zones = await ShippingZone.find({ isActive: true, city }).lean();
        if (zones.length) {
          // Try exact neighborhood match first, then default zone
          if (neighborhood) {
            const needle = String(neighborhood).trim().toLowerCase();
            zone = zones.find((z) => (z.neighborhoods || []).includes(needle)) || null;
          }
          if (!zone) {
            zone = zones.find((z) => z.isDefault) || zones[0];
          }
        }
      }

      for (const { speed, label } of speeds) {
        let indicativeFee = null;
        let estimatedDays = null;
        if (zone) {
          if (speed === "standard") {
            // The same promise the A–F tiers state, so the fallback estimate
            // and the real rate card do not advertise different SLAs.
            estimatedDays = "1-3";
          } else if (speed === "express" && zone.expressMultiplier) {
            estimatedDays = Math.max(1, Math.round(zone.estimatedDays * 0.7));
          } else if (speed === "same_day") {
            estimatedDays = 1;
          } else {
            estimatedDays = zone.estimatedDays;
          }

          // Indicative fee: base rate × speed multiplier × tier multiplier
          const multiplier =
            speed === "same_day" ? (zone.sameDayMultiplier || 1.2) :
            speed === "express" ? (zone.expressMultiplier || 1.4) : 1;
          indicativeFee = Math.round(zone.baseRate * multiplier);
        }

        methods.push({
          id: `courier_dispatch_${speed}`,
          name: label,
          speed,
          available: true,
          estimatedDays,
          indicativeFee,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        methods,
        freeDeliveryThreshold: settings.freeDeliveryThreshold,
        freeDeliveryCurrency: settings.freeDeliveryThreshold > 0 ? "GHS" : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/shipping/free-delivery
 * Public — returns banner copy: whether free delivery is enabled and the
 * threshold, so the storefront can show "Free delivery on orders over GH₵500".
 */
const getFreeDelivery = async (req, res, next) => {
  try {
    const settings = await ShippingSettings.getSettings();
    return res.status(200).json({
      success: true,
      data: {
        enabled: settings.freeDeliveryThreshold > 0,
        threshold: settings.freeDeliveryThreshold,
        currency: "GHS",
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/shipping/neighborhoods?city=Accra
 * Public — returns active neighborhoods grouped by zone for a given city.
 * The storefront uses this to render a neighborhood picker after city selection.
 */
const getNeighborhoods = async (req, res, next) => {
  try {
    const { city } = req.query;
    const supportedCities = ShippingSettings.CITIES;
    if (!city || !supportedCities.includes(city)) {
      return res.status(400).json({
        success: false,
        error: `City must be one of: ${supportedCities.join(", ")}`,
      });
    }

    // NOTE: key this per-city. The bare "zones" key belongs to the calculator,
    // which caches EVERY active zone under it; caching a city-filtered result
    // there would poison the quote path into seeing only this city's zones for
    // the rest of the TTL (and quotes for every other city would fail with
    // UnsupportedDeliveryAreaError).
    const zones = await shippingCache.wrap(`zones:${city}`, () =>
      ShippingZone.find({ isActive: true, city }).lean()
    );

    const neighborhoods = [];
    for (const zone of zones) {
      for (const n of zone.neighborhoods || []) {
        neighborhoods.push({
          neighborhood: n,
          zoneCode: zone.code,
          zoneName: zone.name,
          estimatedDays: zone.estimatedDays,
        });
      }
    }

    // Sort alphabetically for easy scanning
    neighborhoods.sort((a, b) => a.neighborhood.localeCompare(b.neighborhood));

    return res.status(200).json({ success: true, data: neighborhoods });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/v1/neighborhoods?city=Accra
 * Public — active neighbourhoods for the checkout picker, grouped
 * city → municipality. The buyer picks one; its zone is already known, so
 * checkout never geocodes.
 */
const listNeighborhoods = async (req, res, next) => {
  try {
    const { city } = req.query;
    const rows = await Neighborhood.listActive(city);

    const grouped = {};
    for (const row of rows) {
      grouped[row.city] = grouped[row.city] || {};
      grouped[row.city][row.municipality] = grouped[row.city][row.municipality] || [];
      grouped[row.city][row.municipality].push({
        id: String(row._id),
        name: row.name,
        zone: row.assignedZone,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        neighborhoods: rows.map((r) => ({
          id: String(r._id),
          name: r.name,
          city: r.city,
          municipality: r.municipality,
          zone: r.assignedZone,
        })),
        grouped,
        count: rows.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/shipping/zones
 * Public — the rate table, for a "what does delivery cost?" page.
 */
const listPublicZones = async (req, res, next) => {
  try {
    const zones = await shippingCache.wrap("publicDistanceZones", () =>
      ShippingZone.getActiveZones(),
    );
    return res.status(200).json({
      success: true,
      data: zones.map((z) => ({
        zone: z.zoneKey,
        name: z.name,
        distanceRange: `${z.distanceMinKm}-${z.distanceMaxKm} km`,
        minKm: z.distanceMinKm,
        maxKm: z.distanceMaxKm,
        baseRate: z.baseRate,
        perKgRate: z.perKgRate,
        fragileSurcharge: z.fragileSurcharge,
        speedTiers: (z.speedTiers || []).map((t) => ({
          code: t.code, label: t.label, multiplier: t.multiplier,
        })),
        estimatedDays: z.estimatedDaysLabel || String(z.estimatedDays),
        currency: "GHS",
      })),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getQuote,
  getMethods,
  getFreeDelivery,
  getNeighborhoods,
  listNeighborhoods,
  listPublicZones,
};
