const axios = require('axios');
const { parseString } = require('xml2js');
const { promisify } = require('util');
const { extractTLD, getDefaultPrice } = require('../utils/domainHelper');

const parseXml = promisify(parseString);

// In-memory price cache — refreshed every hour
let priceCache = { data: null, timestamp: 0 };
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function hasConfig() {
  return !!(process.env.NAMECHEAP_API_USER && process.env.NAMECHEAP_API_KEY && process.env.NAMECHEAP_CLIENT_IP);
}

function getBaseUrl() {
  const sandbox = process.env.NAMECHEAP_SANDBOX === 'true' || process.env.NAMECHEAP_SANDBOX === '1';
  return sandbox
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';
}

function buildParams(extra = {}) {
  return {
    ApiUser: process.env.NAMECHEAP_API_USER,
    ApiKey: process.env.NAMECHEAP_API_KEY,
    UserName: process.env.NAMECHEAP_API_USER,
    ClientIp: process.env.NAMECHEAP_CLIENT_IP,
    ...extra
  };
}

/**
 * Convert USD to GHS using USD_TO_GHS_RATE env var (default 15.5)
 * Applies a 20% markup to cover Namecheap cost + profit margin
 */
function usdToGhs(usd) {
  const rate = parseFloat(process.env.USD_TO_GHS_RATE) || 15.5;
  const markup = parseFloat(process.env.DOMAIN_MARKUP) || 1.2; // 20% markup
  return Math.ceil(usd * rate * markup);
}

/**
 * Fetch live TLD pricing from Namecheap — cached for 1 hour
 * Returns an object: { '.com': 85, '.net': 75, ... } (in GHS)
 */
async function getPricing() {
  if (!hasConfig()) return {};

  // Return cached prices if still fresh
  if (priceCache.data && Date.now() - priceCache.timestamp < CACHE_TTL) {
    return priceCache.data;
  }

  try {
    const params = buildParams({
      Command: 'namecheap.users.getPricing',
      ProductType: 'DOMAIN',
      ActionName: 'REGISTER',
    });
    const qs = new URLSearchParams(params).toString();
    const response = await axios.get(`${getBaseUrl()}?${qs}`, { timeout: 15000 });
    const parsed = await parseXml(response.data);

    const apiResponse = parsed?.ApiResponse;
    const status = apiResponse?.$?.Status;
    console.log(`[Namecheap] getPricing status: ${status}`);

    if (status !== 'OK') {
      const errors = apiResponse?.Errors?.[0]?.Error;
      const errMsg = Array.isArray(errors) ? errors[0]?._ : errors?._;
      console.warn(`⚠️  Namecheap getPricing failed: ${errMsg || 'non-OK status'}`);
      return priceCache.data || {};
    }

    const pricing = {};
    const productTypes = apiResponse?.CommandResponse?.[0]?.UserGetPricingResult?.[0]?.ProductType || [];
    console.log(`[Namecheap] ProductType entries: ${productTypes.length}`);

    for (const pt of productTypes) {
      const categories = pt.ProductCategory || [];
      for (const cat of categories) {
        const products = cat.Product || [];
        for (const product of products) {
          const tldName = product?.$?.Name; // e.g. "com", "com.gh", "net"
          if (!tldName) continue;
          const prices = product.Price || [];
          // Find 1-year registration price
          const oneYear = prices.find(p => p?.$?.Duration === '1' && p?.$?.DurationType === 'YEAR');
          if (!oneYear) continue;
          const usdPrice = parseFloat(oneYear?.$?.YourPrice || oneYear?.$?.Price || '0');
          if (usdPrice > 0) {
            pricing[`.${tldName}`] = usdToGhs(usdPrice);
          }
        }
      }
    }

    if (Object.keys(pricing).length > 0) {
      priceCache = { data: pricing, timestamp: Date.now() };
      console.log(`✅ Namecheap pricing loaded: ${Object.keys(pricing).length} TLDs`);
    }

    return pricing;
  } catch (err) {
    console.warn('⚠️  Namecheap getPricing failed:', err.message);
    return priceCache.data || {};
  }
}

/**
 * Get price for a TLD — live from Namecheap with fallback to defaults
 */
async function getTldPrice(tld) {
  const prices = await getPricing();
  return prices[tld] ?? null;
}

/**
 * Check a single domain availability
 */
async function checkDomain(domain) {
  if (!hasConfig()) {
    return { domain: domain.trim().toLowerCase(), available: false, price: null };
  }

  try {
    const params = buildParams({
      Command: 'namecheap.domains.check',
      DomainList: domain.trim().toLowerCase()
    });
    const qs = new URLSearchParams(params).toString();
    const response = await axios.get(`${getBaseUrl()}?${qs}`, { timeout: 15000 });
    const parsed = await parseXml(response.data);
    const apiResponse = parsed?.ApiResponse;

    if (apiResponse?.$?.Status !== 'OK') {
      const errors = apiResponse?.Errors?.[0]?.Error;
      const errMsg = Array.isArray(errors) ? errors[0]?.$?.['Number'] : errors?.$?.['Number'];
      return {
        domain: domain.trim().toLowerCase(),
        available: false,
        price: getDefaultPrice(extractTLD(domain)),
        error: errMsg || 'Namecheap check failed'
      };
    }

    const domainCheckResult = apiResponse?.CommandResponse?.[0]?.DomainCheckResult?.[0]?.$;
    if (!domainCheckResult) {
      return { domain: domain.trim().toLowerCase(), available: false, price: getDefaultPrice(extractTLD(domain)) };
    }

    const available = domainCheckResult.Available === 'true';
    const tld = extractTLD(domainCheckResult.Domain || domain);
    const isPremium = domainCheckResult.IsPremiumName === 'true';
    const premiumUsd = parseFloat(domainCheckResult.PremiumRegistrationPrice || '0');

    const price = isPremium && premiumUsd > 0
      ? usdToGhs(premiumUsd)
      : await getTldPrice(tld);

    return {
      domain: (domainCheckResult.Domain || domain).trim().toLowerCase(),
      available,
      price
    };
  } catch (err) {
    return {
      domain: domain.trim().toLowerCase(),
      available: false,
      price: getDefaultPrice(extractTLD(domain)),
      error: err.message || 'Namecheap check failed'
    };
  }
}

/**
 * Check multiple domains and return live availability + prices
 */
async function checkMultipleDomains(name, tlds = ['.com', '.net', '.org', '.io', '.africa', '.com.gh', '.gh']) {
  let domainList;
  if (Array.isArray(tlds) && tlds.length > 0) {
    const base = name.replace(/\s+/g, '').toLowerCase();
    domainList = tlds.map(tld => `${base}${tld.startsWith('.') ? tld : '.' + tld}`);
  } else {
    domainList = name.split(',').map(d => d.trim()).filter(Boolean);
  }

  if (domainList.length === 0) return [];
  if (!hasConfig()) return Promise.all(domainList.map(d => checkDomain(d)));

  // Fetch pricing once before the availability checks
  const livePrices = await getPricing();

  const maxPerRequest = 50;
  const results = [];

  for (let i = 0; i < domainList.length; i += maxPerRequest) {
    const chunk = domainList.slice(i, i + maxPerRequest);
    const params = buildParams({
      Command: 'namecheap.domains.check',
      DomainList: chunk.join(',')
    });
    const qs = new URLSearchParams(params).toString();

    try {
      const response = await axios.get(`${getBaseUrl()}?${qs}`, { timeout: 20000 });
      const parsed = await parseXml(response.data);
      const apiResponse = parsed?.ApiResponse;

      if (apiResponse?.$?.Status !== 'OK') {
        const errors = apiResponse?.Errors?.[0]?.Error;
        const errMsg = Array.isArray(errors) ? errors[0]?._ : errors?._;
        console.warn(`[Namecheap] domains.check ERROR: ${errMsg || apiResponse?.$?.Status}`);
        chunk.forEach(d => {
          results.push({ domain: d, available: false, price: null, error: errMsg || 'Namecheap check failed' });
        });
        continue;
      }

      const items = apiResponse?.CommandResponse?.[0]?.DomainCheckResult || [];
      console.log(`[Namecheap] domains.check — ${items.length} results:`, items.map(i => `${i?.$?.Domain}=${i?.$?.Available}`));
      for (let j = 0; j < items.length; j++) {
        const attrs = items[j].$ || {};
        const available = attrs.Available === 'true';
        const tld = extractTLD(attrs.Domain || chunk[j]);
        const isPremium = attrs.IsPremiumName === 'true';
        const premiumUsd = parseFloat(attrs.PremiumRegistrationPrice || '0');

        const price = isPremium && premiumUsd > 0
          ? usdToGhs(premiumUsd)
          : (livePrices[tld] ?? null);

        results.push({
          domain: (attrs.Domain || chunk[j]).trim().toLowerCase(),
          available,
          price
        });
      }
    } catch (err) {
      chunk.forEach(d => {
        const tld = extractTLD(d);
        results.push({ domain: d, available: false, price: livePrices[tld] ?? getDefaultPrice(tld), error: err.message });
      });
    }
  }

  return results;
}

/**
 * Register a domain via Namecheap.
 * @param {string} domain
 * @param {number} years
 * @param {object} registrant
 * @param {object} [options]
 * @param {boolean} [options.useEazWorldNameservers] - If true, points domain to EazWorld hosting server automatically
 */
async function registerDomain(domain, years, registrant, options = {}) {
  if (!hasConfig()) {
    return { success: false, error: 'Namecheap API not configured' };
  }

  const {
    firstName = '', lastName = '', email = '', phone = '',
    address = '', city = '', country = 'GH', postalCode = '00233'
  } = registrant || {};

  const contact = {
    [`Registrant.FirstName`]: firstName, [`Registrant.LastName`]: lastName,
    [`Registrant.EmailAddress`]: email, [`Registrant.Phone`]: phone,
    [`Registrant.Address1`]: address, [`Registrant.City`]: city,
    [`Registrant.Country`]: country, [`Registrant.PostalCode`]: postalCode,
    [`Tech.FirstName`]: firstName, [`Tech.LastName`]: lastName,
    [`Tech.EmailAddress`]: email, [`Tech.Phone`]: phone,
    [`Tech.Address1`]: address, [`Tech.City`]: city,
    [`Tech.Country`]: country, [`Tech.PostalCode`]: postalCode,
    [`Admin.FirstName`]: firstName, [`Admin.LastName`]: lastName,
    [`Admin.EmailAddress`]: email, [`Admin.Phone`]: phone,
    [`Admin.Address1`]: address, [`Admin.City`]: city,
    [`Admin.Country`]: country, [`Admin.PostalCode`]: postalCode,
    [`AuxBilling.FirstName`]: firstName, [`AuxBilling.LastName`]: lastName,
    [`AuxBilling.EmailAddress`]: email, [`AuxBilling.Phone`]: phone,
    [`AuxBilling.Address1`]: address, [`AuxBilling.City`]: city,
    [`AuxBilling.Country`]: country, [`AuxBilling.PostalCode`]: postalCode,
  };

  // If the customer also ordered hosting, automatically point the domain
  // to EazWorld's cPanel server by setting custom nameservers at registration time.
  const nameserverParams = {};
  if (options.useEazWorldNameservers) {
    const ns1 = process.env.NAMESERVER_1 || 'ns1.eazworld.com';
    const ns2 = process.env.NAMESERVER_2 || 'ns2.eazworld.com';
    nameserverParams.Nameserver1 = ns1;
    nameserverParams.Nameserver2 = ns2;
    console.log(`[Namecheap] Registering ${domain} with EazWorld nameservers: ${ns1}, ${ns2}`);
  }

  try {
    const params = buildParams({
      Command: 'namecheap.domains.create',
      DomainName: domain.trim().toLowerCase(),
      Years: Math.min(10, Math.max(1, Number(years) || 1)),
      ...contact,
      ...nameserverParams,
    });
    const qs = new URLSearchParams(params).toString();
    const response = await axios.get(`${getBaseUrl()}?${qs}`, { timeout: 30000 });
    const parsed = await parseXml(response.data);
    const apiResponse = parsed?.ApiResponse;

    if (apiResponse?.$?.Status !== 'OK') {
      const errors = apiResponse?.Errors?.[0]?.Error;
      const errMsg = Array.isArray(errors)
        ? (errors[0]?.$?.['Description'] || errors[0]?._)?.trim()
        : (errors?.$?.['Description'] || errors?._)?.trim();
      return { success: false, error: errMsg || 'Domain registration failed' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Domain registration failed' };
  }
}

/**
 * Update nameservers for an already-registered domain to EazWorld's hosting server.
 * Call this after hosting is provisioned for a domain that was registered without hosting.
 * @param {string} domain - e.g. "mybusiness.com"
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function setEazWorldNameservers(domain) {
  if (!hasConfig()) {
    return { success: false, error: 'Namecheap API not configured' };
  }

  const ns1 = process.env.NAMESERVER_1 || 'ns1.eazworld.com';
  const ns2 = process.env.NAMESERVER_2 || 'ns2.eazworld.com';
  const [sld, ...tldParts] = domain.trim().toLowerCase().split('.');
  const tld = tldParts.join('.');

  try {
    const params = buildParams({
      Command: 'namecheap.domains.dns.setCustom',
      SLD: sld,
      TLD: tld,
      Nameservers: `${ns1},${ns2}`,
    });
    const qs = new URLSearchParams(params).toString();
    const response = await axios.get(`${getBaseUrl()}?${qs}`, { timeout: 15000 });
    const parsed = await parseXml(response.data);
    const apiResponse = parsed?.ApiResponse;

    if (apiResponse?.$?.Status !== 'OK') {
      const errors = apiResponse?.Errors?.[0]?.Error;
      const errMsg = Array.isArray(errors) ? errors[0]?._ : errors?._;
      return { success: false, error: errMsg || 'Nameserver update failed' };
    }

    console.log(`[Namecheap] Nameservers updated for ${domain} → ${ns1}, ${ns2}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Nameserver update failed' };
  }
}

module.exports = { checkDomain, checkMultipleDomains, registerDomain, setEazWorldNameservers, getPricing, hasConfig };
