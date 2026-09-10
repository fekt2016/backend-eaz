/**
 * Honeypot spam guard for public form endpoints (pre-launch audit #18).
 *
 * A public form renders a hidden field that a real person never sees and never
 * fills. Bots fill every field they find, so a non-empty value is a bot
 * submission. When one is caught the endpoint LOGS it — a distinct, greppable
 * `[honeypot]` line carrying the client IP and a timestamp, kept separate from
 * real submissions — and then returns the SAME success response it would for a
 * genuine submission WITHOUT storing or emailing anything. Telling the bot it
 * was caught only teaches it to adapt, so the response must be indistinguishable
 * from the real thing.
 *
 * The field is named `website`: innocuous, and the sort of thing a naive bot
 * fills without hesitation. It is accepted as an optional value on the request
 * shapes that reach these endpoints purely so it survives to the controller
 * (`validate()` strips keys a schema does not declare) — it is never persisted.
 *
 * Honeypot only. CAPTCHA / Turnstile is deliberately NOT implemented here.
 *
 * Independent of the rate limiter: this reads `req.body` and `req.ip` and never
 * touches the limiter's store, so the per-process MemoryStore caveat noted in
 * the audit has no bearing on it. A honeypot request still counts against the
 * IP's rate-limit bucket like any other request, which is fine.
 */
const logger = require('./logger');

const HONEYPOT_FIELD = 'website';

/**
 * @param {import('express').Request} req    the Express request
 * @param {string} source                    short label for the log line, e.g. 'contact' | 'review'
 * @returns {boolean}  true when the hidden field was filled — the caller should
 *                     then fake a success response and drop the submission.
 */
function isHoneypotTripped(req, source) {
  const raw = req && req.body ? req.body[HONEYPOT_FIELD] : undefined;
  const filled =
    typeof raw === 'string'
      ? raw.trim() !== ''
      : raw !== undefined && raw !== null && raw !== '';

  if (filled) {
    logger.warn(
      `[honeypot] ${source} submission rejected (hidden field "${HONEYPOT_FIELD}" filled) ` +
        `ip=${req.ip || 'unknown'} at=${new Date().toISOString()}`
    );
  }
  return filled;
}

module.exports = { isHoneypotTripped, HONEYPOT_FIELD };
