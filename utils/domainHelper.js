/**
 * Domain validation and helper utilities
 */

// Two-part TLDs that must be matched as a whole
const MULTI_PART_TLDS = [
  '.com.gh', '.org.gh', '.gov.gh', '.edu.gh', '.mil.gh',
  '.co.uk', '.org.uk', '.me.uk', '.net.uk',
  '.co.za', '.org.za',
];

const validateDomain = (domain) => {
  if (!domain || typeof domain !== 'string') return false;
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  return domainRegex.test(domain.trim());
};

/**
 * Extract TLD — handles multi-part TLDs like .com.gh
 */
const extractTLD = (domain) => {
  if (!domain) return '.com';
  const lower = domain.trim().toLowerCase();
  for (const tld of MULTI_PART_TLDS) {
    if (lower.endsWith(tld)) return tld;
  }
  const parts = lower.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : '.com';
};

/**
 * Extract the SLD (e.g. "mybusiness" from "mybusiness.com.gh" or "mybusiness.com")
 */
const extractSLD = (domain) => {
  if (!domain) return '';
  const lower = domain.trim().toLowerCase();
  const tld = extractTLD(lower);
  return lower.endsWith(tld) ? lower.slice(0, -tld.length) : lower.split('.')[0];
};

const extractBaseName = (domain) => {
  if (!domain) return '';
  const parts = domain.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : domain;
};

const generateSuggestions = (baseName, tlds = ['.net', '.org', '.co', '.gh', '.online']) => {
  if (!baseName || baseName.trim().length === 0) return [];
  const cleanBase = baseName.trim().toLowerCase();
  return tlds.map(tld => `${cleanBase}${tld}`);
};

const generateFallbackSuggestions = (query) => {
  if (!query || query.trim().length < 2) return [];
  const cleanQuery = query.trim().toLowerCase();
  const tlds = ['.com', '.net', '.org', '.gh', '.com.gh', '.io'];
  const prefixes = ['get', 'go', 'my', 'try', 'the'];
  const suffixes = ['shop', 'hub', 'tech', 'web', 'studio'];
  const suggestions = [];
  tlds.forEach(tld => suggestions.push(`${cleanQuery}${tld}`));
  prefixes.forEach(prefix => suggestions.push(`${prefix}${cleanQuery}.com`));
  suffixes.forEach(suffix => suggestions.push(`${cleanQuery}${suffix}.com`));
  return [...new Set(suggestions)].slice(0, 20);
};

/**
 * Prices in GHS — matches frontend TLD_PRICES
 */
const getDefaultPrice = (tld) => {
  const priceMap = {
    '.com': 85,
    '.net': 75,
    '.org': 70,
    '.io': 180,
    '.africa': 95,
    '.com.gh': 60,
    '.gh': 60,
    '.org.gh': 60,
    '.co': 120,
    '.online': 65,
    '.tech': 130,
    '.xyz': 45,
    '.info': 70,
    '.biz': 75,
    '.me': 90,
  };
  return priceMap[(tld || '').toLowerCase()] || 85;
};

const normalizeDomain = (domain) => {
  if (!domain) return '';
  return domain.trim().toLowerCase();
};

module.exports = {
  validateDomain,
  extractBaseName,
  extractSLD,
  extractTLD,
  generateSuggestions,
  generateFallbackSuggestions,
  getDefaultPrice,
  normalizeDomain,
};
