// T46: a strict rate limiter was mounted at the literal path `/api/v1/auth/verify`,
// which matches no real route — `verify-pin`, `resend-pin`, and `2fa/verify` fell
// through to only the global 150/15min limit. This can't be tested behaviorally
// (the limiter's own `skip` deliberately no-ops when NODE_ENV === 'test', set
// globally by tests/setup.js before any test file loads `../app`), so this test
// verifies the wiring itself: each real PIN path has a dedicated limiter layer
// mounted directly on the app, and the old dead path does not.
const app = require("../app");

// Express Layer#match() is the same routing check Express itself uses (unlike a
// raw `.regexp.test()`, it correctly special-cases pathless global middleware).
// A layer scoped to a *specific* path matches that path but not an unrelated
// one; pathless global middleware (helmet, json parser, the blanket /api/
// limiter, etc.) matches everything, so excluding anything that also matches
// an unrelated control path isolates just the path-specific limiters.
function pathSpecificLayersMatching(path) {
  return app._router.stack.filter(
    (layer) => layer.name !== "router" && layer.match(path) && !layer.match("/api/v1/products")
  );
}

describe("auth PIN endpoints — dedicated rate limiter wiring (T46)", () => {
  it("mounts a dedicated limiter on /verify-pin, /2fa/verify, and /resend-pin", () => {
    for (const path of [
      "/api/v1/auth/verify-pin",
      "/api/v1/auth/2fa/verify",
      "/api/v1/auth/resend-pin",
    ]) {
      expect(pathSpecificLayersMatching(path).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("no longer mounts a limiter at the dead literal /api/v1/auth/verify path", () => {
    expect(pathSpecificLayersMatching("/api/v1/auth/verify")).toHaveLength(0);
  });
});
