// Returns the frontend base URL. In development we always link to localhost so
// payment callbacks (Paystack) and tracking links land on the local app. In
// production FRONTEND_URL/CLIENT_URL from .env are used.
const PROD = process.env.NODE_ENV === "production";

function frontendUrl() {
  const url = PROD
    ? process.env.FRONTEND_URL || process.env.CLIENT_URL || ""
    : "http://localhost:3000";
  return url.replace(/\/$/, "");
}

module.exports = frontendUrl;