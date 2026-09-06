/**
 * Backend sanitisation helpers.
 * Note: middleware/sanitizeInput + express-mongo-sanitize already strip XSS and
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

// ── Rich-text stripping (T42) ───────────────────────────────────────────────
// Defence in depth for stored text that may later be rendered as HTML (blog post
// bodies especially — see frontend BlogArticle, which does the primary escaping).
//
// A whole <script>…</script> block, plus tags that can execute or exfiltrate on
// their own. <svg>/<math> are here because they carry event handlers; <base> and
// <form> because they can redirect a page's links and submissions.
const SCRIPT_BLOCK    = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const DANGEROUS_TAG   = /<\s*\/?\s*(?:script|iframe|object|embed|style|link|meta|base|form|svg|math)\b[^>]*>?/gi;
// Any inline event handler: onerror=, onload=, onclick=… quoted or bare.
const EVENT_ATTR      = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
// Executable URL schemes. `data:` is only stripped for the two payload-carrying
// types, so a legitimate data:image/png in content still survives.
//
// Browsers strip tab/newline/CR from inside a URL *before* parsing its scheme, so
// `java&#9;script:alert(1)` runs. The scheme names are therefore built to tolerate
// those characters between every letter. Only control characters are allowed in the
// gaps — not spaces — so ordinary prose like "Java Script:" is left alone.
const CTRL = '[\\t\\n\\r\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]*';
const withGaps = (word) => word.split('').join(CTRL);
const DANGEROUS_SCHEME = new RegExp(
  `(?:${withGaps('javascript')}|${withGaps('vbscript')})${CTRL}:`
    + `|data${CTRL}:${CTRL}(?:text\\/html|image\\/svg\\+xml)`,
  'gi',
);

/**
 * Strip executable markup, repeatedly, until the string stops changing.
 *
 * The loop is the point. A single pass can *create* a payload it just removed:
 * `<scr<script></script>ipt>alert(1)</script>` has its inner `<script></script>`
 * deleted, and the remains close up into a live `<script>alert(1)</script>`. The
 * same trick reconstructs `javascript:` out of `javasjavascript:cript:`. Each pass
 * only deletes, so the string shrinks monotonically and this terminates; the cap is
 * belt-and-braces against a pathological input.
 */
function stripExecutableMarkup(str) {
  let out = str;
  for (let i = 0; i < 10; i++) {
    const before = out;
    out = out
      .replace(SCRIPT_BLOCK, '')
      .replace(DANGEROUS_TAG, '')
      .replace(EVENT_ATTR, '')
      .replace(DANGEROUS_SCHEME, '');
    if (out === before) break;
  }
  return out;
}

/** Long-form text (message bodies). Returns undefined if empty. */
function sanitizeMessage(str, maxLen = 5000) {
  if (!str || typeof str !== 'string') return undefined;
  // Truncate first so a huge hostile payload can't make the strip loop do more work
  // than necessary, then strip, then trim the whitespace stripping may have left.
  const cleaned = stripExecutableMarkup(str.trim().slice(0, maxLen)).trim();
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
