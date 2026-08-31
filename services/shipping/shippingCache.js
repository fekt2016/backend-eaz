/**
 * In-process TTL cache for shipping configuration (zones, tiers, settings).
 *
 * The audit found no Redis and no shared cache anywhere in this app — a single
 * app instance behind LiteSpeed — so a plain Map with a TTL is all the quote path
 * needs to keep rate reads off the hot checkout path.
 *
 * TTL alone is NOT the invalidation story: every admin write calls
 * `invalidateAll()` explicitly (see controllers/adminShippingController.js), so
 * an admin sees their rate change immediately. The TTL is only a safety net
 * for a missed invalidation. If this app ever runs multiple instances, reads
 * can be stale up to TTL on the instances that didn't serve the write — move
 * to Redis pub/sub invalidation before scaling out.
 */
const DEFAULT_TTL_MS = 300_000; // 5 minutes

function createShippingCache({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const store = new Map(); // key -> { value, expiresAt }

  function get(key) {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  function set(key, value) {
    store.set(key, { value, expiresAt: now() + ttlMs });
    return value;
  }

  /** Get-or-load: returns the cached value or loads, stores, and returns it. */
  async function wrap(key, loader) {
    const hit = get(key);
    if (hit !== undefined) return hit;
    return set(key, await loader());
  }

  function invalidate(key) {
    store.delete(key);
  }

  function invalidateAll() {
    store.clear();
  }

  return { get, set, wrap, invalidate, invalidateAll };
}

// Shared instance for the running app. Tests build their own via
// createShippingCache({ ttlMs }) so TTL behaviour is testable without fake
// timers leaking between suites.
const shippingCache = createShippingCache();

module.exports = { createShippingCache, shippingCache, DEFAULT_TTL_MS };
