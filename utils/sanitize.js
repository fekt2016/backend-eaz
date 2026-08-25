/**
 * Backend sanitisation helpers.
 * Note: xss-clean + express-mongo-sanitize middleware already strip XSS and
 * NoSQL injection from req.body globally. These helpers add field-level
 * trimming, length capping, and type coercion on top.
 */
const filterXSS = require('xss');

/** Trim + strip HTML tags. Returns undefined if result is empty. */
function sanitizeText(str, maxLen = 1000) {
  if (!str || typeof str !== 'string') return undefined;
  const cleaned = str.trim().replace(/<[^>]*>/g, '').slice(0, maxLen);
  return cleaned || undefined;
}

/** Trim + lowercase. Returns undefined if empty. */
function sanitizeEmail(str) {
  if (!str || typeof str !== 'string') return undefined;
  const cleaned = str.trim().toLowerCase().slice(0, 254);
  return cleaned || undefined;
}

/** Trim + strip HTML + cap length. Returns undefined if empty. */
function sanitizeName(str, maxLen = 100) {
  if (!str || typeof str !== 'string') return undefined;
  const cleaned = str.trim().replace(/<[^>]*>/g, '').slice(0, maxLen);
  return cleaned || undefined;
}

/**
 * Normalize a Ghana phone number to the local 10-digit format: 0XXXXXXXXX
 * Handles: +233XXXXXXXXX, 233XXXXXXXXX, 0XXXXXXXXX, with spaces/dashes.
 * Returns undefined if the result isn't 10 digits starting with 0.
 */
function sanitizePhone(str) {
  if (!str || typeof str !== 'string') return undefined;
  // Strip everything except digits
  let digits = str.replace(/\D/g, '');
  // +233 or 233 country code prefix → replace with leading 0
  if (digits.startsWith('233') && digits.length === 12) digits = '0' + digits.slice(3);
  // Must be exactly 10 digits starting with 0
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  // Accept 9-digit number (no leading 0) by prepending it
  if (digits.length === 9) return '0' + digits;
  return digits || undefined;
}

/** Lowercase + only valid hostname chars. Returns undefined if empty. */
function sanitizeDomain(str) {
  if (!str || typeof str !== 'string') return undefined;
  const cleaned = str.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 253);
  return cleaned || undefined;
}

/** Parse to integer, clamp to [min, max]. Returns undefined if NaN. */
function sanitizeInt(val, min, max) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return undefined;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

/** Long-form text (message bodies). Returns undefined if empty. */
function sanitizeMessage(str, maxLen = 5000) {
  if (!str || typeof str !== 'string') return undefined;
  const cleaned = str
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, maxLen);
  return cleaned || undefined;
}

/**
 * Blog post content (T42, defense-in-depth). Stored content is
 * markdown-flavoured plain text, rendered client-side by BlogArticle.jsx —
 * that render-time DOMPurify pass is the primary XSS defense (it sanitizes
 * the HTML BlogArticle *constructs* from this text, which is the actual
 * vulnerable step; a write-time filter on the raw markdown source can't see
 * HTML that doesn't exist yet, e.g. `[x](javascript:...)` has no `<`/`>`).
 * This still neutralizes any literal HTML tags an author pastes in — an
 * empty whiteList HTML-*encodes* disallowed tags rather than stripping them
 * (e.g. `<script>` -> `&lt;script&gt;`), inert either way — legitimate
 * markdown never contains real tags, so nothing intended is touched — plus
 * belt-and-suspenders removal of the literal `javascript:` scheme string.
 * Returns undefined if empty.
 */
function sanitizePostContent(str, maxLen = 50000) {
  if (!str || typeof str !== 'string') return undefined;
  const cleaned = filterXSS(str.trim(), { whiteList: {} })
    .replace(/javascript:/gi, '')
    .slice(0, maxLen);
  return cleaned || undefined;
}

/**
 * Validate password strength.
 * Returns an error message string if invalid, or null if valid.
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.length < 8)   return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password must not exceed 128 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one symbol (e.g. @, #, $, !).';
  return null;
}

module.exports = {
  sanitizeText,
  sanitizeEmail,
  sanitizeName,
  sanitizePhone,
  sanitizeDomain,
  sanitizeInt,
  sanitizeMessage,
  sanitizePostContent,
  validatePassword,
};
