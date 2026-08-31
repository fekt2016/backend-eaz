const axios = require("axios");
const { extractTLD } = require("../utils/domainHelper");
const { getCostUsd, isSupportedTld, unsupportedTldMessage, DEFAULT_SEARCH_TLDS } = require("../config/domainPricing");
const logger = require("../utils/logger");

/**
 * Spaceship domain registrar — the sole registrar.
 *
 * Replaced services/namecheap.js, which was deleted 2026-08-31 once Spaceship
 * was confirmed as the reseller account. The comparisons below are kept because
 * they explain WHY this service behaves as it does, not because that file is
 * still around to look at.
 *
 * Deliberately exports the SAME six functions with the same signatures and return
 * shapes as the Namecheap service, so the eight call sites only change their
 * `require` line. Differences that matter:
 *
 *  - REST + JSON, not XML over query strings.
 *  - Registration is ASYNC: POST returns 202 with an operation id we then poll.
 *  - Contacts are created up front and referenced by id, rather than repeated
 *    across four contact blocks on every register call.
 *  - There is NO pricing endpoint — standard TLD costs come from
 *    config/domainPricing.js. Only premium domains carry a price from the API.
 *  - No sandbox environment exists. Every registration spends real money.
 */

const BASE_URL = "https://spaceship.dev/api/v1";

// Registration returns 202 immediately; the domain isn't ours until the async
// operation reports success. Poll rather than assume — a failure here means a
// customer paid and got nothing.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

function hasConfig() {
  return !!(process.env.SPACESHIP_API_KEY && process.env.SPACESHIP_API_SECRET);
}

function authHeaders() {
  return {
    "X-API-Key": process.env.SPACESHIP_API_KEY,
    "X-API-Secret": process.env.SPACESHIP_API_SECRET,
    "Content-Type": "application/json",
  };
}

/**
 * Spaceship errors come back as { detail: "..." }, sometimes with a `data` array
 * of field-level problems. Flatten to one line so callers can surface it.
 */
function errorMessage(err, fallback) {
  const body = err?.response?.data;
  if (!body) return err?.message || fallback;
  if (typeof body === "string") return body;
  const fields = Array.isArray(body.data)
    ? body.data.map((d) => d?.details || d?.field).filter(Boolean).join(", ")
    : "";
  return [body.detail, fields].filter(Boolean).join(" — ") || fallback;
}

/**
 * Convert USD to GH₵ using the admin-editable rate and markup in
 * Settings.pricing (defaults 15.5 and 1.2 — a 20% margin over registrar cost).
 * Read through services/pricingSettings, which caches so this stays synchronous.
 * Unchanged from the Namecheap service on purpose — the sell price a customer
 * sees must not move just because the registrar behind it did.
 */
function usdToGhs(usd) {
  // Admin-editable since 2026-08-31 (Settings.pricing), with the old env vars as
  // the fallback so nothing moves for a deployment that has not set them.
  const { getRate, getMarkup } = require('./pricingSettings');
  return Math.ceil(usd * getRate() * getMarkup());
}

/**
 * Sell price in GH₵ for a TLD, or `null` when we hold no cost for it (T65).
 * The single source for "what does this extension cost" — never hardcode a cedi
 * figure beside a call to this.
 */
function tldPriceGhs(tld) {
  const usd = getCostUsd(tld);
  return usd == null ? null : usdToGhs(usd);
}

/**
 * Price map in GHS, e.g. { '.com': 190, '.net': 213, ... }.
 *
 * Built from the local cost table rather than a network call, so unlike the
 * Namecheap version this never fails, never caches, and never returns {} because
 * a third party was down.
 */
async function getPricing() {
  const { TLD_COST_USD } = require("../config/domainPricing");
  const pricing = {};
  for (const [tld, usd] of Object.entries(TLD_COST_USD)) {
    pricing[tld] = usdToGhs(usd);
  }
  return pricing;
}

/**
 * Price a single availability result. A premium domain carries its own price from
 * the API (in USD) and must use it — the flat TLD cost would undercharge badly.
 */
function priceFromResult(entry, tld) {
  const premium = (entry?.premiumPricing || []).find((p) => p?.operation === "register");
  if (premium && Number(premium.price) > 0) {
    return usdToGhs(Number(premium.price));
  }
  const usd = getCostUsd(tld);
  return usd != null ? usdToGhs(usd) : null;
}

/**
 * Check a single domain's availability.
 * @returns {Promise<{domain: string, available: boolean, price: number|null, error?: string}>}
 */
async function checkDomain(domain) {
  const clean = String(domain || "").trim().toLowerCase();
  const tld = extractTLD(clean);

  if (!hasConfig()) {
    return { domain: clean, available: false, price: null };
  }

  // Answered locally: Spaceship would return `tldNotSupported`, and spending a
  // round-trip to be told what we already know helps nobody.
  if (!isSupportedTld(tld)) {
    return {
      domain: clean,
      available: false,
      price: null,
      error: unsupportedTldMessage(tld),
    };
  }

  try {
    const { data } = await axios.get(
      `${BASE_URL}/domains/${encodeURIComponent(clean)}/available`,
      { headers: authHeaders(), timeout: 15000 },
    );

    return {
      domain: data?.domain || clean,
      available: data?.result === "available",
      price: priceFromResult(data, tld),
    };
  } catch (err) {
    return {
      domain: clean,
      available: false,
      // T65: was a hardcoded GH₵ fallback that undercut real cost. A check that
      // failed has no price to report — the UI shows the error instead.
      price: tldPriceGhs(tld),
      error: errorMessage(err, "Domain check failed"),
    };
  }
}

/**
 * Check many domains at once.
 *
 * Same two calling styles as the Namecheap version: pass a base name plus a list
 * of TLDs, or a comma-separated list of full domains with `tlds` empty.
 */
async function checkMultipleDomains(name, tlds = DEFAULT_SEARCH_TLDS) {
  let domainList;
  if (Array.isArray(tlds) && tlds.length > 0) {
    const base = String(name || "").replace(/\s+/g, "").toLowerCase();
    domainList = tlds.map((tld) => `${base}${tld.startsWith(".") ? tld : "." + tld}`);
  } else {
    domainList = String(name || "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }

  if (domainList.length === 0) return [];
  if (!hasConfig()) return Promise.all(domainList.map((d) => checkDomain(d)));

  // Anything Spaceship can't sell is answered locally and never sent upstream.
  const results = [];
  const sendable = [];
  for (const d of domainList) {
    const tld = extractTLD(d);
    if (!isSupportedTld(tld)) {
      results.push({
        domain: d,
        available: false,
        price: null,
        error: unsupportedTldMessage(tld),
      });
    } else {
      sendable.push(d);
    }
  }

  // The bulk endpoint takes 1–20 domains per call.
  const maxPerRequest = 20;
  for (let i = 0; i < sendable.length; i += maxPerRequest) {
    const chunk = sendable.slice(i, i + maxPerRequest);
    try {
      const { data } = await axios.post(
        `${BASE_URL}/domains/available`,
        { domains: chunk },
        { headers: authHeaders(), timeout: 20000 },
      );

      for (const entry of data?.domains || []) {
        const tld = extractTLD(entry.domain);
        results.push({
          domain: String(entry.domain || "").trim().toLowerCase(),
          available: entry.result === "available",
          price: priceFromResult(entry, tld),
        });
      }
    } catch (err) {
      const message = errorMessage(err, "Domain check failed");
      logger.warn(`[Spaceship] availability check failed: ${message}`);
      for (const d of chunk) {
        results.push({
          domain: d,
          available: false,
          price: tldPriceGhs(extractTLD(d)),
          error: message,
        });
      }
    }
  }

  return results;
}

/**
 * Save a registrant contact and return its id. Spaceship keeps contacts as
 * reusable records rather than inline blocks, so this runs before every
 * registration.
 */
async function saveContact(registrant) {
  const {
    firstName = "",
    lastName = "",
    email = "",
    phone = "",
    address = "",
    city = "",
    country = "GH",
    postalCode = "00233",
  } = registrant || {};

  const { data } = await axios.put(
    `${BASE_URL}/contacts`,
    {
      firstName,
      lastName,
      email,
      // Spaceship wants E.164. Ghana numbers are commonly stored locally as
      // 0XXXXXXXXX, which the registry rejects.
      phone: toE164(phone, country),
      address1: address,
      city,
      country,
      postalCode,
    },
    { headers: authHeaders(), timeout: 20000 },
  );

  if (!data?.contactId) throw new Error("Spaceship did not return a contact id");
  return data.contactId;
}

/**
 * Normalise a phone number to E.164. Leaves an already-prefixed number alone and
 * assumes Ghana (+233) for a local 0-prefixed one, which is how numbers arrive
 * from the checkout form.
 */
function toE164(phone, country = "GH") {
  const raw = String(phone || "").replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  if (country.toUpperCase() === "GH") {
    return raw.startsWith("0") ? `+233${raw.slice(1)}` : `+233${raw}`;
  }
  return `+${raw}`;
}

/**
 * Poll an async operation until it settles.
 * Returns { success, error? }. A timeout is reported as a failure so the caller
 * records a registrationError and the admin "retry registration" path can pick
 * it up, rather than a customer's order silently looking complete.
 */
async function waitForOperation(operationId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const { data } = await axios.get(`${BASE_URL}/async-operations/${operationId}`, {
        headers: authHeaders(),
        timeout: 15000,
      });
      if (data?.status === "success") return { success: true };
      if (data?.status === "failed") {
        return {
          success: false,
          error: data?.details?.message || data?.detail || "Registration failed at the registrar",
        };
      }
    } catch (err) {
      // A transient poll failure isn't a registration failure — keep polling
      // until the deadline before giving up.
      logger.warn(`[Spaceship] operation poll failed: ${errorMessage(err, "poll error")}`);
    }
  }

  return {
    success: false,
    error: "Registration is still pending at the registrar — check before retrying.",
  };
}

/**
 * Register a domain.
 * @param {string} domain
 * @param {number} years
 * @param {object} registrant
 * @param {object} [options]
 * @param {boolean} [options.useEazWorldNameservers] - point the domain at our hosting
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function registerDomain(domain, years, registrant, options = {}) {
  if (!hasConfig()) {
    return { success: false, error: "Spaceship API not configured" };
  }

  const clean = String(domain || "").trim().toLowerCase();
  const tld = extractTLD(clean);
  if (!isSupportedTld(tld)) {
    return { success: false, error: unsupportedTldMessage(tld) };
  }

  try {
    const contactId = await saveContact(registrant);

    const { headers } = await axios.post(
      `${BASE_URL}/domains/${encodeURIComponent(clean)}`,
      {
        years: Math.min(10, Math.max(1, Number(years) || 1)),
        autoRenew: false, // renewals are driven by our own paid orders, not the registrar
        privacyProtection: { level: "high", userConsent: true },
        contacts: {
          registrant: contactId,
          admin: contactId,
          tech: contactId,
          billing: contactId,
        },
      },
      { headers: authHeaders(), timeout: 30000 },
    );

    const operationId = headers?.["spaceship-async-operationid"];
    if (!operationId) {
      // No id means we cannot confirm the outcome. Treat as a failure rather than
      // telling a paying customer their domain is registered when it may not be.
      return { success: false, error: "Registrar did not return an operation id" };
    }

    const settled = await waitForOperation(operationId);
    if (!settled.success) return settled;

    if (options.useEazWorldNameservers) {
      const ns = await setEazWorldNameservers(clean);
      if (!ns.success) {
        // The domain IS registered — that's the part money was spent on. Surface
        // the nameserver problem in logs; don't fail the registration back to the
        // caller and trigger a retry that would try to buy it twice.
        logger.warn(`[Spaceship] ${clean} registered but nameservers failed: ${ns.error}`);
      }
    }

    logger.info(`[Spaceship] Registered ${clean} for ${years} year(s)`);
    return { success: true };
  } catch (err) {
    return { success: false, error: errorMessage(err, "Domain registration failed") };
  }
}

/**
 * Point an already-registered domain at EazWorld's hosting nameservers.
 * @param {string} domain
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function setEazWorldNameservers(domain) {
  if (!hasConfig()) {
    return { success: false, error: "Spaceship API not configured" };
  }

  const ns1 = process.env.NAMESERVER_1 || "ns1.eazworld.com";
  const ns2 = process.env.NAMESERVER_2 || "ns2.eazworld.com";
  const clean = String(domain || "").trim().toLowerCase();

  try {
    await axios.put(
      `${BASE_URL}/domains/${encodeURIComponent(clean)}/nameservers`,
      { provider: "custom", hosts: [ns1, ns2] },
      { headers: authHeaders(), timeout: 15000 },
    );

    logger.info(`[Spaceship] Nameservers updated for ${clean} → ${ns1}, ${ns2}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: errorMessage(err, "Nameserver update failed") };
  }
}

module.exports = {
  checkDomain,
  checkMultipleDomains,
  registerDomain,
  setEazWorldNameservers,
  getPricing,
  hasConfig,
  tldPriceGhs,
  // exported for tests
  usdToGhs,
  toE164,
};
