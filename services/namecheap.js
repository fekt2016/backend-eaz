const axios = require('axios');
const { parseString } = require('xml2js');
const { promisify } = require('util');
const { extractTLD, getDefaultPrice } = require('../utils/domainHelper');

const parseXml = promisify(parseString);

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
 * Check a single domain availability
 * @param {string} domain - Full domain name (e.g. example.com)
 * @returns {Promise<{ domain: string, available: boolean, price: number }>}
 */
async function checkDomain(domain) {
  if (!hasConfig()) {
    return {
      domain: domain.trim().toLowerCase(),
      available: false,
      price: getDefaultPrice(extractTLD(domain))
    };
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
    const status = apiResponse?.$?.Status;
    const ns = apiResponse?.$?.['xmlns'] || '';

    if (status !== 'OK') {
      const errors = apiResponse?.Errors?.[0]?.Error;
      const errMsg = Array.isArray(errors) ? errors[0]?.$?.['Number'] : errors?.$?.['Number'];
      return {
        domain: domain.trim().toLowerCase(),
        available: false,
        price: getDefaultPrice(extractTLD(domain)),
        error: errMsg || 'Namecheap check failed'
      };
    }

    const commandResponse = apiResponse?.CommandResponse?.[0];
    const domainCheckResult = commandResponse?.DomainCheckResult?.[0]?.$;
    if (!domainCheckResult) {
      return {
        domain: domain.trim().toLowerCase(),
        available: false,
        price: getDefaultPrice(extractTLD(domain))
      };
    }

    const available = domainCheckResult.Available === 'true';
    const isPremium = domainCheckResult.IsPremiumName === 'true';
    const premiumPrice = parseFloat(domainCheckResult.PremiumRegistrationPrice || '0', 10);
    const price = available && isPremium && premiumPrice > 0
      ? premiumPrice
      : getDefaultPrice(extractTLD(domainCheckResult.Domain || domain));

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
      error: err.response?.data || err.message || 'Namecheap check failed'
    };
  }
}

/**
 * Check multiple domains (e.g. baseName + tlds)
 * @param {string} name - Base name or comma-separated domain list
 * @param {string[]} [tlds] - TLDs to check (e.g. ['.com', '.net']). If not provided, name is treated as comma-separated domain list.
 * @returns {Promise<Array<{ domain: string, available: boolean, price: number }>>}
 */
async function checkMultipleDomains(name, tlds = ['.com', '.net', '.org', '.io', '.africa', '.com.gh', '.gh']) {
  let domainList;
  if (Array.isArray(tlds) && tlds.length > 0) {
    const base = name.replace(/\s+/g, '').toLowerCase();
    domainList = tlds.map(tld => `${base}${tld.startsWith('.') ? tld : '.' + tld}`);
  } else {
    domainList = name.split(',').map(d => d.trim()).filter(Boolean);
  }

  if (domainList.length === 0) {
    return [];
  }

  if (!hasConfig()) {
    return Promise.all(domainList.map(d => checkDomain(d)));
  }

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
      const status = apiResponse?.$?.Status;

      if (status !== 'OK') {
        chunk.forEach(d => {
          results.push({
            domain: d,
            available: false,
            price: getDefaultPrice(extractTLD(d)),
            error: 'Namecheap check failed'
          });
        });
        continue;
      }

      const commandResponse = apiResponse?.CommandResponse?.[0];
      const items = commandResponse?.DomainCheckResult || [];
      for (let j = 0; j < items.length; j++) {
        const attrs = items[j].$ || {};
        const available = attrs.Available === 'true';
        const isPremium = attrs.IsPremiumName === 'true';
        const premiumPrice = parseFloat(attrs.PremiumRegistrationPrice || '0', 10);
        const price = available && isPremium && premiumPrice > 0
          ? premiumPrice
          : getDefaultPrice(extractTLD(attrs.Domain || chunk[j]));
        results.push({
          domain: (attrs.Domain || chunk[j]).trim().toLowerCase(),
          available,
          price
        });
      }
    } catch (err) {
      chunk.forEach(d => {
        results.push({
          domain: d,
          available: false,
          price: getDefaultPrice(extractTLD(d)),
          error: err.message || 'Namecheap check failed'
        });
      });
    }
  }

  return results;
}

/**
 * Register a domain via Namecheap
 * @param {string} domain - Domain to register
 * @param {number} years - Registration years (1–10)
 * @param {Object} registrant - RegistrantInfo: firstName, lastName, email, phone, address, city, country, postalCode
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function registerDomain(domain, years, registrant) {
  if (!hasConfig()) {
    return { success: false, error: 'Namecheap API not configured' };
  }

  const {
    firstName = '',
    lastName = '',
    email = '',
    phone = '',
    address = '',
    city = '',
    country = 'GH',
    postalCode = '00233'
  } = registrant || {};

  try {
    const params = buildParams({
      Command: 'namecheap.domains.create',
      DomainName: domain.trim().toLowerCase(),
      Years: Math.min(10, Math.max(1, Number(years) || 1)),
      'Registrant.FirstName': firstName,
      'Registrant.LastName': lastName,
      'Registrant.EmailAddress': email,
      'Registrant.Phone': phone,
      'Registrant.Address1': address,
      'Registrant.City': city,
      'Registrant.Country': country,
      'Registrant.PostalCode': postalCode,
      'Tech.FirstName': firstName,
      'Tech.LastName': lastName,
      'Tech.EmailAddress': email,
      'Tech.Phone': phone,
      'Tech.Address1': address,
      'Tech.City': city,
      'Tech.Country': country,
      'Tech.PostalCode': postalCode,
      'Admin.FirstName': firstName,
      'Admin.LastName': lastName,
      'Admin.EmailAddress': email,
      'Admin.Phone': phone,
      'Admin.Address1': address,
      'Admin.City': city,
      'Admin.Country': country,
      'Admin.PostalCode': postalCode,
      'AuxBilling.FirstName': firstName,
      'AuxBilling.LastName': lastName,
      'AuxBilling.EmailAddress': email,
      'AuxBilling.Phone': phone,
      'AuxBilling.Address1': address,
      'AuxBilling.City': city,
      'AuxBilling.Country': country,
      'AuxBilling.PostalCode': postalCode
    });

    const qs = new URLSearchParams(params).toString();
    const response = await axios.get(`${getBaseUrl()}?${qs}`, { timeout: 30000 });
    const parsed = await parseXml(response.data);
    const apiResponse = parsed?.ApiResponse;
    const status = apiResponse?.$?.Status;

    if (status !== 'OK') {
      const errors = apiResponse?.Errors?.[0]?.Error;
      const errMsg = Array.isArray(errors)
        ? (errors[0]?.$?.['Description'] || errors[0]?._)?.trim()
        : (errors?.$?.['Description'] || errors?._)?.trim();
      return { success: false, error: errMsg || 'Domain registration failed' };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err.response?.data || err.message || 'Domain registration failed'
    };
  }
}

module.exports = {
  checkDomain,
  checkMultipleDomains,
  registerDomain,
  hasConfig
};
