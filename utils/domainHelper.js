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

const generateFallbackSuggestions = (query) => {
  if (!query || query.trim().length < 2) return [];
  const cleanQuery = query.trim().toLowerCase();
  // T65: dropped '.gh' and '.com.gh' — the /domain/suggest endpoint was handing
  // customers names that fail the moment they try to check out.
  const tlds = ['.com', '.net', '.org', '.co', '.shop', '.io'];
  const prefixes = ['get', 'go', 'my', 'try', 'the'];
  const suffixes = ['shop', 'hub', 'tech', 'web', 'studio'];
  const suggestions = [];
  tlds.forEach(tld => suggestions.push(`${cleanQuery}${tld}`));
  prefixes.forEach(prefix => suggestions.push(`${prefix}${cleanQuery}.com`));
  suffixes.forEach(suffix => suggestions.push(`${cleanQuery}${suffix}.com`));
  return [...new Set(suggestions)].slice(0, 20);
};

const normalizeDomain = (domain) => {
  if (!domain) return '';
  return domain.trim().toLowerCase();
};

module.exports = {
  validateDomain,
  extractSLD,
  extractTLD,
  generateFallbackSuggestions,
  normalizeDomain,
};

// `getDefaultPrice` used to live here: a hardcoded GH₵ table that priced .com at
// 85 against a real cost of ~190, i.e. below cost, and that two callers then
// mistook for USD and converted a second time (T65). Prices now come from one
// place — config/domainPricing.js (USD) through namecheap.usdToGhs(), which
// prefers live cost from Namecheap's users.getPricing and falls back to that
// table. The old private copy in the registrar service is gone for good: it
// priced .com below cost.
