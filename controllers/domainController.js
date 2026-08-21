const crypto = require("crypto");
const Paystack = require("@paystack/paystack-sdk");
const DomainOrder = require("../models/DomainOrder");
const User = require("../models/User");
const {
  validateDomain,
  extractTLD,
  extractSLD,
  generateFallbackSuggestions,
  getDefaultPrice,
  normalizeDomain,
} = require("../utils/domainHelper");
const namecheap = require("../services/namecheap");
const { registerDomainOrder } = require("../utils/registerDomainOrder");
const {
  sanitizeName,
  sanitizePhone,
  sanitizeDomain,
  sanitizeInt,
} = require("../utils/sanitize");

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith("sk_")) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn(
    "⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for payments.",
  );
}

/**
 * Check availability of a single domain
 */
const checkDomain = async (req, res, next) => {
  try {
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: "Domain name is required",
      });
    }

    if (!validateDomain(domain)) {
      return res.status(400).json({
        success: false,
        error: "Invalid domain format",
      });
    }

    let result;
    if (namecheap.hasConfig()) {
      result = await namecheap.checkDomain(domain);
    } else {
      const tldFallback = extractTLD(domain);
      result = {
        domain,
        available: false,
        price: getDefaultPrice(tldFallback),
        currency: "USD",
        tld: tldFallback,
        error: "Domain search not configured",
      };
    }
    const tld = result.tld || extractTLD(domain);
    const currency = result.currency || "USD";

    res.status(200).json({
      success: true,
      data: {
        domain: result.domain,
        available: result.available,
        price: result.price,
        currency,
        tld,
        ...(result.error && { error: result.error }),
      },
    });
  } catch (error) {
    console.error("Domain check error:", error);
    next(error);
  }
};

/**
 * Check availability of multiple domains in batch
 */
const checkDomainBatch = async (req, res, next) => {
  try {
    const rawDomains = req.body.domains;

    if (!rawDomains || !Array.isArray(rawDomains) || rawDomains.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Domains array is required",
      });
    }

    if (rawDomains.length > 20) {
      return res.status(400).json({
        success: false,
        error: "Maximum 20 domains can be checked at once",
      });
    }

    const domains = rawDomains.map((d) => sanitizeDomain(d)).filter(Boolean);

    const invalidDomains = domains.filter((d) => !validateDomain(d));
    if (invalidDomains.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid domain format: ${invalidDomains.join(", ")}`,
      });
    }

    if (!namecheap.hasConfig()) {
      return res.status(503).json({
        success: false,
        error: "Domain search is not configured",
      });
    }

    const results = await namecheap.checkMultipleDomains(domains.join(","), []);
    const normalized = results.map((r) => ({
      domain: r.domain,
      available: r.available,
      price: r.price,
      currency: r.currency || "USD",
      tld: r.tld || extractTLD(r.domain),
      ...(r.error && { error: r.error }),
    }));

    res.status(200).json({
      success: true,
      data: normalized,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Check availability of multiple domains in bulk (alternative endpoint)
 */
const checkDomainBulk = async (req, res, next) => {
  try {
    const rawDomains = req.body.domains;

    if (!rawDomains || !Array.isArray(rawDomains) || rawDomains.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Domains array is required",
      });
    }

    if (rawDomains.length > 50) {
      return res.status(400).json({
        success: false,
        error: "Maximum 50 domains can be checked at once",
      });
    }

    const domains = rawDomains.map((d) => sanitizeDomain(d)).filter(Boolean);

    const invalidDomains = domains.filter((d) => !validateDomain(d));
    if (invalidDomains.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid domain format: ${invalidDomains.join(", ")}`,
      });
    }

    if (!namecheap.hasConfig()) {
      return res.status(503).json({
        success: false,
        error: "Domain search is not configured",
      });
    }

    const results = await namecheap.checkMultipleDomains(domains.join(","), []);
    const normalized = results.map((r) => ({
      domain: r.domain,
      available: r.available,
      price: r.price,
      currency: r.currency || "USD",
      tld: r.tld || extractTLD(r.domain),
      ...(r.error && { error: r.error }),
    }));

    res.status(200).json({
      success: true,
      data: normalized,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/domain/payment
 * Create domain payment session — requires authentication (protect middleware).
 * Email and user ID are taken from req.user, never trusted from the request body.
 */
const createDomainPayment = async (req, res, next) => {
  try {
    if (!paystack) {
      return res.status(500).json({
        success: false,
        error:
          "Paystack is not configured. Please add PAYSTACK_SECRET to your environment variables.",
      });
    }

    // ── Identity comes from the verified JWT, not the request body ──
    const userId = req.user._id;
    const email = req.user.email;

    const domain = sanitizeDomain(req.body.domain);
    const firstName = sanitizeName(req.body.firstName);
    const lastName = sanitizeName(req.body.lastName);
    const bodyCustomerName = sanitizeName(req.body.customerName);
    const fullName = sanitizeName(req.body.fullName);
    const phone = sanitizePhone(req.body.phone);
    const years = sanitizeInt(req.body.years, 1, 10) ?? 1;
    const { amount, currency = "GHS", registrantInfo } = req.body;

    if (!domain || !amount) {
      return res.status(400).json({
        success: false,
        error: "Domain and amount are required",
      });
    }

    const tld = extractTLD(domain);
    const safeYears = Number(Math.min(10, Math.max(1, Number(years) || 1)));

    // ── Server-side price validation ─────────────────────────────────
    let expectedGHS = null;
    try {
      if (namecheap.hasConfig()) {
        const pricing = await namecheap.getPricing();
        if (pricing?.[tld]) {
          expectedGHS = pricing[tld] * safeYears;
        }
      }
    } catch {
      expectedGHS = null;
    }

    if (expectedGHS == null) {
      const usdRate = parseFloat(process.env.USD_TO_GHS_RATE) || 15.5;
      const markup = parseFloat(process.env.DOMAIN_MARKUP) || 1.2;
      const defaultUsd = getDefaultPrice(tld);
      if (defaultUsd) {
        expectedGHS = defaultUsd * usdRate * markup * safeYears;
      }
    }

    if (expectedGHS != null) {
      const submitted = Number(amount);
      const tolerance = 0.05;
      if (
        submitted < expectedGHS * (1 - tolerance) ||
        submitted > expectedGHS * (1 + tolerance)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid payment amount. Please refresh the page and try again.",
        });
      }
    }

    const price = Number(amount);

    let customerName = bodyCustomerName || fullName;
    if (!customerName && registrantInfo) {
      const first = registrantInfo.firstName || "";
      const last = registrantInfo.lastName || "";
      customerName = [first, last].filter(Boolean).join(" ").trim();
    }
    if (!customerName && (firstName || lastName)) {
      customerName = [firstName, lastName].filter(Boolean).join(" ").trim();
    }
    if (!customerName) {
      customerName = req.user.name || email.split("@")[0] || "Customer";
    }

    const reference = `DOM_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const amountInUnits = Math.round(Number(amount) * 100);

    const transaction = await paystack.transaction.initialize({
      email,
      amount: amountInUnits,
      currency: currency || "GHS",
      reference,
      channels: ["card", "mobile_money"],
      metadata: {
        domain,
        type: "domain_registration",
        years: String(years),
        userId: String(userId),
        ...(registrantInfo && {
          registrantInfo: JSON.stringify(registrantInfo),
        }),
      },
      callback_url: `${require("../utils/frontendUrl")()}/payment-success?type=domain`,
    });

    if (!transaction.status) {
      return res.status(500).json({
        success: false,
        error: "Failed to initialize payment",
      });
    }

    const order = await DomainOrder.create({
      user: userId,
      domain: domain || "",
      tld,
      price,
      email,
      customerName: customerName || "",
      phone: phone || undefined,
      registrantInfo: registrantInfo || undefined,
      years: safeYears,
      status: "pending",
      paymentId: reference,
      paystackReference: reference,
    });

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        accessCode: transaction.data.access_code,
        reference: transaction.data.reference,
        orderId: order._id,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/domain/orders
 * Admin sees all orders; regular users see only their own.
 */
const getDomainOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const isAdmin = ["admin", "superadmin"].includes(req.user?.role);

    const query = {};
    if (!isAdmin) {
      // Filter by user ObjectId — reliable, no email-spoofing risk
      query.user = req.user._id;
    }
    if (status) {
      query.status = status;
    }

    const orders = await DomainOrder.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/domain/my
 * The caller's actually-registered domains (not order records) — pushed to
 * `User.domains` by the Paystack webhook once Namecheap registration
 * succeeds. Sorted soonest-expiring first so renewals due surface at the top.
 */
const getMyRegisteredDomains = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("domains").lean();
    const domains = (user?.domains || [])
      .slice()
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));

    res.status(200).json({ success: true, count: domains.length, data: domains });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single domain order by ID
 */
const getDomainOrder = async (req, res, next) => {
  try {
    const order = await DomainOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const isAdmin = ["admin", "superadmin"].includes(req.user?.role);
    const isOwner = order.user?.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res
        .status(403)
        .json({ success: false, error: "Not authorized to view this order" });
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * Update domain order status (admin only)
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!["pending", "completed", "failed"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: pending, completed, failed",
      });
    }

    const order = await DomainOrder.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true },
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/domain/suggest?query=xyz
 */
const suggestDomain = async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        success: false,
        error: "Query parameter is required",
      });
    }

    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Query must be at least 2 characters long",
      });
    }

    const normalizedQuery = normalizeDomain(trimmedQuery);

    const suggestions = generateFallbackSuggestions(normalizedQuery)
      .sort((a, b) => {
        const aMatch = a.toLowerCase().startsWith(normalizedQuery);
        const bMatch = b.toLowerCase().startsWith(normalizedQuery);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return a.length - b.length;
      })
      .slice(0, 10);

    res.status(200).json({
      query: normalizedQuery,
      suggestions,
    });
  } catch (error) {
    console.error("Domain suggest error:", error);
    const fallbackSuggestions = generateFallbackSuggestions(
      req.query?.query || "",
    );
    res.status(200).json({
      query: normalizeDomain(req.query?.query || ""),
      suggestions: fallbackSuggestions.slice(0, 10),
    });
  }
};

/**
 * GET /api/v1/domain/search?domain=xyz
 */
const searchDomain = async (req, res, next) => {
  try {
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: "Domain name is required",
      });
    }

    if (!validateDomain(domain)) {
      return res.status(400).json({
        success: false,
        error: "Invalid domain format",
      });
    }

    const normalizedDomain = normalizeDomain(domain);
    const baseName = extractSLD(normalizedDomain);

    if (!namecheap.hasConfig()) {
      return res.status(503).json({
        success: false,
        error: "Domain search is not configured. Please contact support.",
      });
    }

    const allPrices = await namecheap.getPricing();
    const wantedTlds = [
      ".com",
      ".net",
      ".org",
      ".io",
      ".co",
      ".online",
      ".tech",
      ".xyz",
      ".info",
      ".biz",
      ".me",
    ];
    const tlds = wantedTlds.filter((t) => allPrices[t]);

    const results = await namecheap.checkMultipleDomains(
      baseName,
      tlds.length > 0 ? tlds : wantedTlds,
    );
    const exact = results.find((r) => r.domain === normalizedDomain);
    const available = exact ? exact.available : false;
    const price = exact ? exact.price : null;

    res.status(200).json({
      domain: normalizedDomain,
      available,
      registered: !available,
      price,
      results,
    });
  } catch (error) {
    console.error("Domain search error:", error);
    next(error);
  }
};

/**
 * POST /api/v1/domain/orders/:id/retry-registration  (admin)
 * Re-attempt Namecheap registration for a paid order whose registration failed.
 * Only valid once the order is paid (status 'completed'); succeeds idempotently.
 */
const retryDomainRegistration = async (req, res, next) => {
  try {
    const order = await DomainOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    if (order.status !== "completed") {
      return res.status(400).json({
        success: false,
        error: "Only a paid (completed) order can be registered.",
      });
    }

    const result = await registerDomainOrder(order);
    if (!result.success) {
      return res.status(502).json({
        success: false,
        error: result.error || "Domain registration failed. Please try again.",
      });
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  checkDomain,
  checkDomainBatch,
  checkDomainBulk,
  searchDomain,
  suggestDomain,
  createDomainPayment,
  getDomainOrders,
  getDomainOrder,
  getMyRegisteredDomains,
  updateOrderStatus,
  retryDomainRegistration,
};
