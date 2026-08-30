/**
 * One clamp for every list endpoint (T87).
 *
 * `.limit(Number(req.query.limit))` lets any authenticated caller ask for
 * `?limit=1000000` and hydrate a whole collection into a 512 MB heap, taking the
 * API down for everyone. Several controllers already clamped, each with its own
 * inline expression; the ones that did not were simply the ones nobody had
 * revisited. A helper means a new endpoint inherits the bound instead of
 * remembering it.
 *
 * Oversized values are clamped, never rejected: a caller asking for too much
 * gets the maximum page, which is what a paginated API should do. Junk
 * (`?limit=abc`, `?page=-3`) falls back to the default rather than producing
 * `NaN`, which Mongoose would otherwise pass through as "no limit".
 *
 *   const { page, limit, skip } = paginate(req.query); // 10 per page
 *
 * @param {object} query                  usually `req.query`
 * @param {number} [opts.defaultLimit=10] page size when none is asked for
 * @param {number} [opts.maxLimit=100]    the ceiling a caller cannot exceed
 * @returns {{ page: number, limit: number, skip: number }}
 */
function paginate(query = {}, { defaultLimit = 10, maxLimit = 100 } = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { paginate };
