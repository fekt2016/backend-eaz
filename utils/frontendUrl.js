// Returns the frontend base URL. In development we always link to localhost so
// payment callbacks (Paystack) and tracking links land on the local app. In
// production FRONTEND_URL/CLIENT_URL from .env are used.
//
// T119 — this used to return "" in production when neither was set. The value is
// interpolated into the Paystack `callback_url` and into customer tracking links,
// so an empty string produced a relative callback and a hostless SMS link, with
// nothing logged. utils/validateEnv.js now refuses to boot in that state; this
// throw is the backstop for anything that reaches here anyway (a worker or script
// that skipped validateEnv), because failing loudly beats texting a broken link.
const PROD = process.env.NODE_ENV === "production";

function frontendUrl() {
  if (!PROD) return "http://localhost:3000";

  const url = (process.env.FRONTEND_URL || process.env.CLIENT_URL || "").trim();
  if (!url) {
    throw new Error(
      "FRONTEND_URL (or CLIENT_URL) is not set. It is required in production — " +
      "Paystack callback URLs and customer tracking links are built from it."
    );
  }
  return url.replace(/\/$/, "");
}

module.exports = frontendUrl;
