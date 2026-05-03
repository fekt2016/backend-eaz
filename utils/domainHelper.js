/**
 * Domain validation and helper utilities
 */

/**
 * Validate domain format
 * @param {string} domain - Domain name to validate
 * @returns {boolean} - True if valid domain format
 */
const validateDomain = (domain) => {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  // Domain regex: allows alphanumeric, hyphens, and dots
  // Must have at least one dot and valid TLD (2+ characters)
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  
  return domainRegex.test(domain.trim());
};

/**
 * Extract base name from domain (without TLD)
 * @param {string} domain - Full domain name
 * @returns {string} - Base name without TLD
 */
const extractBaseName = (domain) => {
  if (!domain) return '';
  const parts = domain.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : domain;
};

/**
 * Extract TLD from domain name
 * @param {string} domain - Full domain name
 * @returns {string} - TLD (e.g., '.com', '.net')
 */
const extractTLD = (domain) => {
  if (!domain) return '.com';
  const parts = domain.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : '.com';
};

/**
 * Generate domain suggestions with alternative TLDs
 * @param {string} baseName - Base domain name without TLD
 * @param {string[]} tlds - Array of TLDs to suggest
 * @returns {string[]} - Array of suggested domains
 */
const generateSuggestions = (baseName, tlds = ['.net', '.org', '.co', '.gh', '.online']) => {
  if (!baseName || baseName.trim().length === 0) {
    return [];
  }

  const cleanBase = baseName.trim().toLowerCase();
  return tlds.map(tld => `${cleanBase}${tld}`);
};

/**
 * Generate fallback domain suggestions with prefixes and suffixes
 * @param {string} query - Search query
 * @returns {string[]} - Array of suggested domains
 */
const generateFallbackSuggestions = (query) => {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const cleanQuery = query.trim().toLowerCase();
  const tlds = ['.com', '.net', '.org', '.co', '.gh', '.online'];
  const prefixes = ['get', 'go', 'my', 'try', 'join', 'buy', 'the'];
  const suffixes = ['shop', 'host', 'cloud', 'tech', 'web', 'hub', 'studio', 'design'];

  const suggestions = [];

  // Direct TLD variations
  tlds.forEach(tld => {
    suggestions.push(`${cleanQuery}${tld}`);
  });

  // With prefixes
  prefixes.forEach(prefix => {
    suggestions.push(`${prefix}${cleanQuery}.com`);
  });

  // With suffixes
  suffixes.forEach(suffix => {
    suggestions.push(`${cleanQuery}${suffix}.com`);
  });

  // Remove duplicates and limit to 20
  return [...new Set(suggestions)].slice(0, 20);
};

/**
 * Get default price for a TLD
 * @param {string} tld - TLD extension (e.g., '.com')
 * @returns {number} - Default price in USD
 */
const getDefaultPrice = (tld) => {
  const priceMap = {
    '.com': 12.99,
    '.net': 14.99,
    '.org': 13.99,
    '.co': 24.99,
    '.gh': 19.99,
    '.online': 34.99,
    '.io': 39.99,
    '.tech': 29.99,
    '.xyz': 9.99,
    '.info': 15.99,
    '.biz': 16.99,
    '.me': 19.99,
  };

  return priceMap[tld.toLowerCase()] || 12.99;
};

/**
 * Normalize domain name (lowercase, trim)
 * @param {string} domain - Domain name
 * @returns {string} - Normalized domain
 */
const normalizeDomain = (domain) => {
  if (!domain) return '';
  return domain.trim().toLowerCase();
};

module.exports = {
  validateDomain,
  extractBaseName,
  extractTLD,
  generateSuggestions,
  generateFallbackSuggestions,
  getDefaultPrice,
  normalizeDomain,
};

