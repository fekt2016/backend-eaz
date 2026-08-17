/**
 * Normalize a Ghanaian phone number to a bare local form for matching/lookups:
 *   - strip all non-digits
 *   - convert a leading 233 country code to a leading 0 (e.g. 233201234567 → 0201234567)
 *
 * Unlike `sanitizePhone` in ./sanitize, this does NOT validate length and always
 * returns the normalized digits — use it for equality/lookup, not for storage.
 */
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('233')) digits = `0${digits.slice(3)}`;
  return digits;
}

module.exports = { normalizePhone };
