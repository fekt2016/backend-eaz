/**
 * Escape HTML-opening characters in request input.
 *
 * Replaces `xss-clean`, which was abandoned in 2022 (last publish 0.1.4, the
 * repository archived) while sitting in the request path of every route. This
 * middleware is a faithful reimplementation, not an improvement: the escaping
 * it performs is byte-for-byte what `xss-clean` did, verified case by case in
 * tests/sanitizeInput.test.js against the old library's recorded output.
 *
 * Behaviour that MUST NOT drift, and why:
 *
 *   `<`  →  `&lt;`   the only character escaped. `&` and `>` are left alone,
 *                    because xss-filters' inHTMLData only needs `<` to stop a
 *                    tag from opening in an HTML data context.
 *   non-strings      numbers, booleans and null keep their type.
 *   whitespace       values are NOT trimmed. The old library trimmed the JSON
 *                    text it built internally, never the values inside it.
 *
 * That fidelity is not pedantry. Passwords pass through this middleware before
 * they are hashed, so a stored hash for a password containing `<` is a hash of
 * the ESCAPED string. Escaping one character more or fewer would lock those
 * accounts out with no way to diagnose it from the error.
 *
 * One deliberate difference, invisible in behaviour: the original serialised
 * the whole payload with JSON.stringify, ran a regex over the text and parsed
 * it back, on every request. This walks the object instead — materially less
 * garbage on a 512MB heap, and it cannot throw on a payload JSON refuses to
 * serialise. A body parser cannot produce a cycle, so the `seen` guard below is
 * defence for other callers rather than for the request path.
 */

/** Escape a single value, leaving anything that is not a string untouched. */
function escapeValue(value) {
  return typeof value === 'string' ? value.replace(/</g, '&lt;') : value;
}

/**
 * Walk a parsed request payload, escaping strings in place.
 *
 * Own enumerable keys only, so an inherited `__proto__` cannot be dragged onto
 * the object here. `express-mongo-sanitize` runs immediately after and remains
 * the guard for `$`- and `.`-prefixed keys.
 */
function sanitize(input, seen = new WeakSet()) {
  if (input && typeof input === 'object') {
    // A cycle would otherwise recurse until the stack gives out, taking the
    // process with it. Returning the object leaves it exactly as it was found.
    if (seen.has(input)) return input;
    seen.add(input);
  }

  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      input[i] = typeof input[i] === 'object' && input[i] !== null
        ? sanitize(input[i], seen)
        : escapeValue(input[i]);
    }
    return input;
  }

  if (input && typeof input === 'object') {
    for (const key of Object.keys(input)) {
      const value = input[key];
      input[key] = typeof value === 'object' && value !== null
        ? sanitize(value, seen)
        : escapeValue(value);
    }
    return input;
  }

  return escapeValue(input);
}

/** Express middleware — the shape `xss-clean` exported, so app.js is unchanged. */
module.exports = function sanitizeInput() {
  return function sanitizeInputMiddleware(req, _res, next) {
    if (req.body) req.body = sanitize(req.body);
    if (req.query) req.query = sanitize(req.query);
    if (req.params) req.params = sanitize(req.params);
    next();
  };
};

// Exported for the equivalence tests; not part of the middleware contract.
module.exports.sanitize = sanitize;
