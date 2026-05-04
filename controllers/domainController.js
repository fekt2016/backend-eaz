const crypto = require('crypto');
const Paystack = require('@paystack/paystack-sdk');
const DomainOrder = require('../models/DomainOrder');
const { validateDomain, extractTLD, extractSLD, generateFallbackSuggestions, getDefaultPrice, normalizeDomain } = require('../utils/domainHelper');
const namecheap = require('../services/namecheap');

// Paystack initialization (secret key: PAYSTACK_SECRET or PAYSTACK_KEY)
const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith('sk_')) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn('⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for payments.');
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
        error: 'Domain name is required'
      });
    }

    if (!validateDomain(domain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid domain format'
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
        currency: 'USD',
        tld: tldFallback,
        error: 'Domain search not configured'
      };
    }
    const tld = result.tld || extractTLD(domain);
    const currency = result.currency || 'USD';

    res.status(200).json({
      success: true,
      data: {
        domain: result.domain,
        available: result.available,
        price: result.price,
        currency,
        tld,
        ...(result.error && { error: result.error }),
      }
    });
  } catch (error) {
    console.error('Domain check error:', error);
    next(error);
  }
};

/**
 * Check availability of multiple domains in batch
 */
const checkDomainBatch = async (req, res, next) => {
  try {
    const { domains } = req.body;

    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Domains array is required'
      });
    }

    if (domains.length > 20) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 20 domains can be checked at once'
      });
    }

    // Validate all domains
    const invalidDomains = domains.filter(d => !validateDomain(d));
    if (invalidDomains.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid domain format: ${invalidDomains.join(', ')}`
      });
    }

    if (!namecheap.hasConfig()) {
      return res.status(503).json({
        success: false,
        error: 'Domain search is not configured'
      });
    }

    const results = await namecheap.checkMultipleDomains(domains.join(','), []);
    const normalized = results.map(r => ({
      domain: r.domain,
      available: r.available,
      price: r.price,
      currency: r.currency || 'USD',
      tld: r.tld || extractTLD(r.domain),
      ...(r.error && { error: r.error }),
    }));

    res.status(200).json({
      success: true,
      data: normalized
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
    const { domains } = req.body;

    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Domains array is required'
      });
    }

    if (domains.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 domains can be checked at once'
      });
    }

    const invalidDomains = domains.filter(d => !validateDomain(d));
    if (invalidDomains.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid domain format: ${invalidDomains.join(', ')}`
      });
    }

    if (!namecheap.hasConfig()) {
      return res.status(503).json({
        success: false,
        error: 'Domain search is not configured'
      });
    }

    const results = await namecheap.checkMultipleDomains(domains.join(','), []);
    const normalized = results.map(r => ({
      domain: r.domain,
      available: r.available,
      price: r.price,
      currency: r.currency || 'USD',
      tld: r.tld || extractTLD(r.domain),
      ...(r.error && { error: r.error }),
    }));

    res.status(200).json({
      success: true,
      data: normalized
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create domain payment session
 */
const createDomainPayment = async (req, res, next) => {
  try {
    if (!paystack) {
      return res.status(500).json({
        success: false,
        error: 'Paystack is not configured. Please add PAYSTACK_SECRET to your environment variables.'
      });
    }

    const {
      domain,
      email,
      amount,
      currency = 'NGN',
      firstName,
      lastName,
      customerName: bodyCustomerName,
      fullName,
      phone,
      registrantInfo,
      years = 1
    } = req.body;

    if (!domain || !email || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Domain, email, and amount are required'
      });
    }

    const tld = extractTLD(domain);
    const price = Number(amount);

    let customerName = bodyCustomerName || fullName;
    if (!customerName && registrantInfo) {
      const first = registrantInfo.firstName || '';
      const last = registrantInfo.lastName || '';
      customerName = [first, last].filter(Boolean).join(' ').trim();
    }
    if (!customerName && (firstName || lastName)) {
      customerName = [firstName, lastName].filter(Boolean).join(' ').trim();
    }
    if (!customerName) {
      customerName = email.split('@')[0] || 'Customer';
    }

    // Create payment reference
    const reference = `DOM_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const amountInUnits = Math.round(Number(amount) * 100); // kobo (NGN) or pesewas (GHS)
    const transaction = await paystack.transaction.initialize({
      email,
      amount: amountInUnits,
      currency: currency || 'NGN',
      reference,
      channels: ['card', 'mobile_money'],
      metadata: {
        domain,
        type: 'domain_registration',
        years: String(years),
        ...(registrantInfo && { registrantInfo: JSON.stringify(registrantInfo) })
      },
      callback_url: `${process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173'}/domain/payment-success`
    });

    if (!transaction.status) {
      return res.status(500).json({
        success: false,
        error: 'Failed to initialize payment'
      });
    }

    const order = await DomainOrder.create({
      domain: domain.toLowerCase().trim(),
      tld,
      price,
      email: email.trim().toLowerCase(),
      customerName: customerName.trim(),
      phone: (phone || '').trim() || undefined,
      registrantInfo: registrantInfo || undefined,
      years: Math.min(10, Math.max(1, Number(years) || 1)),
      status: 'pending',
      paymentId: reference,
      paystackReference: reference
    });

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        accessCode: transaction.data.access_code,
        reference: transaction.data.reference,
        orderId: order._id
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get domain orders — admin sees all, regular users see only their own
 */
const getDomainOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const isAdmin = req.user?.role === 'admin';

    const query = {};
    if (!isAdmin) {
      query.email = req.user.email;
    }
    if (status) {
      query.status = status;
    }

    const orders = await DomainOrder.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders
    });
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
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update domain order status
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['pending', 'completed', 'failed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: pending, completed, failed'
      });
    }

    const order = await DomainOrder.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get real-time domain suggestions for autocomplete
 * GET /api/domain/suggest?query=xyz
 */
const suggestDomain = async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required'
      });
    }

    const trimmedQuery = query.trim();

    // Validate minimum length
    if (trimmedQuery.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Query must be at least 2 characters long'
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
    console.error('Domain suggest error:', error);
    const fallbackSuggestions = generateFallbackSuggestions(req.query?.query || '');
    res.status(200).json({
      query: normalizeDomain(req.query?.query || ''),
      suggestions: fallbackSuggestions.slice(0, 10),
    });
  }
};

/**
 * Search domain with Domainr API (includes availability, suggestions, and WHOIS)
 * This is the main endpoint for the domain search feature
 */
const searchDomain = async (req, res, next) => {
  try {
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain name is required'
      });
    }

    // Validate domain format
    if (!validateDomain(domain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid domain format'
      });
    }

    const normalizedDomain = normalizeDomain(domain);
    const baseName = extractSLD(normalizedDomain);
    const tlds = ['.com', '.net', '.org', '.io', '.africa', '.com.gh', '.gh'];

    if (!namecheap.hasConfig()) {
      return res.status(503).json({
        success: false,
        error: 'Domain search is not configured. Please contact support.'
      });
    }

    const results = await namecheap.checkMultipleDomains(baseName, tlds);
    const exact = results.find(r => r.domain === normalizedDomain);
    const available = exact ? exact.available : false;
    const price = exact ? exact.price : null;

    const response = {
      domain: normalizedDomain,
      available,
      registered: !available,
      price,
      results,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Domain search error:', error);
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
  updateOrderStatus,
};
