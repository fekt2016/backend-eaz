const axios = require("axios");
const { parseString } = require("xml2js");
const { promisify } = require("util");
const { extractTLD } = require("../utils/domainHelper");
const { getCostUsd, isSupportedTld, unsupportedTldMessage, DEFAULT_SEARCH_TLDS } = require("../config/domainPricing");
const logger = require("../utils/logger");

const parseXml = promisify(parseString);

/**
 * Namecheap domain registrar — the sole registrar.
 *
 * Restored 2026-08-31 by owner decision, reversing T130 (which had made Spaceship
 * the sole registrar earlier the same day). services/spaceship.js is deleted.
 *
 * This is a PORT, not a revert. The file T130 deleted is not the file here:
 *
 *  - Its `getDefaultPrice` table is NOT restored. That table sold `.com` at
 *    GH₵85 against a real cost near GH₵190 — below cost — and listed TLDs that
 *    cannot be sold. It is the single most expensive thing in the old file and
 *    it is gone for good. Prices now come from one place: config/domainPricing.js
 *    (USD cost) through `usdToGhs()`.
 *  - `usdToGhs()` reads the ADMIN-EDITABLE rate and markup from Settings.pricing
 *    via services/pricingSettings, not the USD_TO_GHS_RATE / DOMAIN_MARKUP env
 *    vars the old file used. Those env vars were retired on 2026-08-31 and
 *    setting them does nothing; reintroducing them would mean two places to look
 *    when a price is wrong.
 *
 * Deliberately exports the SAME surface as the Spaceship service it replaces, so
 * the call sites only change their `require` line.
 *
 * Differences from Spaceship that matter:
 *
 *  - XML over query strings, not REST + JSON.
 *  - Registration is SYNCHRONOUS: `domains.create` either succeeds or fails on
 *    the one call. There is no operation id and nothing to poll.
 *  - Contacts are repeated across four blocks on every register call, rather
 *    than created once and referenced by id.
 *  - There IS a pricing endpoint (`users.getPricing`), so live cost is available
 *    and config/domainPricing.js becomes the fallback rather than the only
 *    source. This is the main reason the local table's staleness stops mattering.
 *  - There IS a sandbox. Set NAMECHEAP_SANDBOX=true to exercise registration
 *    without spending money — the thing Spaceship made impossible.
 */

// Live pricing cache. Namecheap's getPricing is a large response and its prices
// move rarely, so an hour is generous without risking a stale sell price.
const PRICE_CACHE_TTL_MS = 60 * 60 * 1000;

// A FAILED fetch is cached too, briefly. Without this the TTL short-circuit
// never engages while Namecheap's pricing is down, so every single domain search
// re-attempts the whole catalogue behind a 15s timeout — on a 512MB heap, and
// adding 15s to every customer's search.
const PRICE_FAIL_TTL_MS = 5 * 60 * 1000;

let priceCache = { data: null, at: 0 };

/**
 * Keep serving the last good prices if we have them; otherwise remember the
 * failure for a short while so the next search does not re-fetch immediately.
 */
function cacheFailure() {
  if (priceCache.data) return priceCache.data;
  priceCache = { data: {}, at: Date.now() - (PRICE_CACHE_TTL_MS - PRICE_FAIL_TTL_MS) };
  return {};
}

/**
 * Refuse a live cost that is wildly below what we believe the TLD costs.
 *
 * This is the guard the review asked for after the ICANN-fee bug: reading the
 * wrong attribute produced $0.18 for every gTLD, which passed a bare `> 0` check
 * and was then enforced as the sell price at checkout. A schema change should
 * degrade to the local table, never to a giveaway. Only a FLOOR — a live price
 * above the local estimate is normal and must be honoured, since the local
 * figures are deliberately set high.
 */
const IMPLAUSIBLE_FRACTION = 0.25;

function isImplausibleCost(tld, usd) {
  const local = getCostUsd(tld);
  if (local == null) return false; // nothing to compare against
  return usd < local * IMPLAUSIBLE_FRACTION;
}

function hasConfig() {
  return !!(
    process.env.NAMECHEAP_API_USER &&
    process.env.NAMECHEAP_API_KEY &&
    process.env.NAMECHEAP_CLIENT_IP
  );
}

function isSandbox() {
  return (
    process.env.NAMECHEAP_SANDBOX === "true" ||
    process.env.NAMECHEAP_SANDBOX === "1"
  );
}

/**
 * Sandbox in production is the worst combination available: the sandbox happily
 * answers `Registered="true"`, so the webhook marks the order registered, adds
 * the domain to the customer's account and emails them — for a domain nobody
 * owns. Real money in, nothing delivered, and nothing in the logs to tell the
 * difference. Refuse rather than guess.
 */
function assertSandboxAllowed() {
  if (isSandbox() && process.env.NODE_ENV === "production") {
    throw new Error(
      "NAMECHEAP_SANDBOX is enabled in production — refusing to call the registrar. Unset it.",
    );
  }
}

function getBaseUrl() {
  assertSandboxAllowed();
  return isSandbox()
    ? "https://api.sandbox.namecheap.com/xml.response"
    : "https://api.namecheap.com/xml.response";
}

function buildParams(extra = {}) {
  return {
    ApiUser: process.env.NAMECHEAP_API_USER,
    ApiKey: process.env.NAMECHEAP_API_KEY,
    UserName: process.env.NAMECHEAP_API_USER,
    ClientIp: process.env.NAMECHEAP_CLIENT_IP,
    ...extra,
  };
}

/**
 * Namecheap reports failures inside a 200 response: `Status="ERROR"` with an
 * Errors block. Flatten it to one line so callers can surface it, preferring the
 * human-readable Description over the bare error number.
 */
function apiErrorMessage(apiResponse, fallback) {
  const errors = apiResponse?.Errors?.[0]?.Error;
  const first = Array.isArray(errors) ? errors[0] : errors;
  const msg = (first?.$?.Description || first?._ || "").trim();
  return msg || fallback;
}

async function callApi(params, timeout = 15000) {
  const qs = new URLSearchParams(buildParams(params)).toString();
  const response = await axios.get(`${getBaseUrl()}?${qs}`, { timeout });
  const parsed = await parseXml(response.data);
  return parsed?.ApiResponse;
}

/**
 * Convert USD to GH₵ using the admin-editable rate and markup in
 * Settings.pricing (defaults 15.5 and 1.2 — a 20% margin over registrar cost).
 * Read through services/pricingSettings, which caches so this stays synchronous.
 * Unchanged from the Spaceship service on purpose — the sell price a customer
 * sees must not move just because the registrar behind it did.
 */
function usdToGhs(usd) {
  const { getRate, getMarkup } = require("./pricingSettings");
  return Math.ceil(usd * getRate() * getMarkup());
}

/**
 * Sell price in GH₵ for a TLD, or `null` when we hold no cost for it (T65).
 * The single source for "what does this extension cost" — never hardcode a cedi
 * figure beside a call to this.
 *
 * Prefers live Namecheap cost when the cache holds it, falling back to the local
 * table. Synchronous by contract, so it never triggers the network itself.
 */
function tldPriceGhs(tld) {
  const key = (tld || "").toLowerCase();
  const liveUsd = priceCache.data?.[key];
  const usd = liveUsd != null ? liveUsd : getCostUsd(key);
  return usd == null ? null : usdToGhs(usd);
}

/**
 * Live wholesale cost per TLD in USD, from `users.getPricing`, cached for an
 * hour. Returns `{}` on any failure — callers fall back to the local table, so a
 * Namecheap outage degrades pricing rather than breaking search.
 */
async function refreshCostUsd() {
  if (!hasConfig()) return {};
  if (priceCache.data && Date.now() - priceCache.at < PRICE_CACHE_TTL_MS) {
    return priceCache.data;
  }

  try {
    const apiResponse = await callApi({
      Command: "namecheap.users.getPricing",
      ProductType: "DOMAIN",
      // RENEW, not REGISTER. REGISTER returns the first-year promo, and we bill
      // the customer every year — pricing off the promo sells year 2 below cost.
      ActionName: "RENEW",
    });

    if (apiResponse?.$?.Status !== "OK") {
      logger.warn(`[Namecheap] getPricing failed: ${apiErrorMessage(apiResponse, "non-OK status")}`);
      return cacheFailure();
    }

    // ProductType → ProductCategory → Product(.Name = tld) → Price(.Duration=1)
    const categories =
      apiResponse?.CommandResponse?.[0]?.UserGetPricingResult?.[0]
        ?.ProductType?.[0]?.ProductCategory || [];

    const costs = {};
    let rejected = 0;
    for (const category of categories) {
      for (const product of category?.Product || []) {
        const tld = product?.$?.Name;
        if (!tld) continue;
        const yearly = (product?.Price || []).find(
          (p) => p?.$?.Duration === "1" && p?.$?.DurationType === "YEAR",
        );
        if (!yearly) continue;

        // `YourPrice` is what Namecheap charges US. `YourAdditonalCost` (their
        // misspelling) is the ICANN fee — about $0.18 — billed ON TOP, not
        // instead. Reading the fee as the price is exactly the bug that shipped
        // in review: it cached .com at $0.18 and sold it for GH₵4 against a
        // ~GH₵169 cost, with the checkout guard enforcing the wrong figure.
        const price = parseFloat(yearly?.$?.YourPrice ?? yearly?.$?.Price ?? "");
        const icannFee = parseFloat(yearly?.$?.YourAdditonalCost ?? "0");
        const usd = price + (Number.isFinite(icannFee) ? icannFee : 0);

        const key = `.${tld.toLowerCase()}`;
        if (!Number.isFinite(price) || price <= 0) continue;
        if (isImplausibleCost(key, usd)) { rejected += 1; continue; }
        costs[key] = usd;
      }
    }

    if (rejected > 0) {
      logger.warn(`[Namecheap] getPricing: rejected ${rejected} implausibly low costs — using local fallback for those`);
    }

    if (Object.keys(costs).length > 0) {
      priceCache = { data: costs, at: Date.now() };
      logger.info(`[Namecheap] getPricing cached ${Object.keys(costs).length} TLD costs`);
      return priceCache.data;
    }

    logger.warn("[Namecheap] getPricing parsed no usable costs — schema may have changed");
    return cacheFailure();
  } catch (err) {
    logger.warn(`[Namecheap] getPricing error: ${err.message}`);
    return cacheFailure();
  }
}

/**
 * Price map in GH₵, e.g. { '.com': 190, '.net': 213, ... }.
 *
 * Union of the local cost table and whatever live pricing is available, so a TLD
 * we hold a cost for is always priced even if Namecheap omits it.
 */
async function getPricing() {
  const { TLD_COST_USD } = require("../config/domainPricing");
  const live = await refreshCostUsd();
  const merged = { ...TLD_COST_USD, ...live };

  const pricing = {};
  for (const [tld, usd] of Object.entries(merged)) {
    if (!isSupportedTld(tld)) continue;
    pricing[tld] = usdToGhs(usd);
  }
  return pricing;
}

/**
 * Price a single availability result. A premium domain carries its own price
 * from the API (in USD) and must use it — the flat TLD cost would undercharge
 * badly.
 */
function priceFromResult(attrs, tld) {
  // Premium names are NOT sellable end to end. Search could quote the premium
  // price, but createDomainPayment validates against the flat TLD price with a
  // ±5% band (so the quote is always rejected), and domains.create is sent
  // without IsPremiumDomain/PremiumPrice — so a premium either fails after the
  // customer paid, or registers and bills us the premium against a flat-rate
  // sale. Quoting the flat price for a premium is the worse half of that.
  //
  // Until the checkout and create paths carry premium params, price it null and
  // let the caller present it as unavailable.
  if (attrs?.IsPremiumName === "true") return null;
  return tldPriceGhs(tld);
}

const PREMIUM_MESSAGE =
  "This is a premium name and we can't sell it yet. Contact us and we'll quote it for you.";

/**
 * One place that turns a DomainCheckResult into our result shape, so the single
 * and bulk paths cannot drift. A name we cannot price is reported as not
 * available WITH a reason — the same shape unsupported TLDs use — rather than as
 * available with a blank price, which the storefront would render as "GH₵—" and
 * checkout would then reject anyway.
 */
function resultFromAttrs(attrs, domain) {
  const tld = extractTLD(domain);
  const available = attrs?.Available === "true";
  const price = priceFromResult(attrs, tld);

  if (available && price == null) {
    return {
      domain,
      available: false,
      price: null,
      error: attrs?.IsPremiumName === "true"
        ? PREMIUM_MESSAGE
        : `We don't have a price for ${tld} yet.`,
    };
  }
  return { domain, available, price };
}

/**
 * Namecheap wants a phone as `+CCC.NNNNNNNNN`. The old service passed the raw
 * user input straight through, which the API rejects for any Ghanaian number
 * typed the normal way (024…).
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

function toNamecheapPhone(phone, country = "GH") {
  const e164 = toE164(phone, country);
  if (!e164) return "";
  // Split the country code off the subscriber number: +233241234567 → +233.241234567
  const digits = e164.slice(1);
  const cc = country.toUpperCase() === "GH" ? "233" : digits.slice(0, Math.max(1, digits.length - 10));
  return digits.startsWith(cc) ? `+${cc}.${digits.slice(cc.length)}` : `+${digits.slice(0, 3)}.${digits.slice(3)}`;
}

/**
 * Check a single domain's availability.
 * @returns {Promise<{domain: string, available: boolean, price: number|null, error?: string}>}
 */
async function checkDomain(domain) {
  const clean = String(domain || "").trim().toLowerCase();
  const tld = extractTLD(clean);

  if (!isSupportedTld(tld)) {
    return { domain: clean, available: false, price: null, error: unsupportedTldMessage(tld) };
  }
  if (!hasConfig()) {
    return { domain: clean, available: false, price: null, error: "Namecheap API not configured" };
  }

  try {
    await refreshCostUsd();
    const apiResponse = await callApi({
      Command: "namecheap.domains.check",
      DomainList: clean,
    });

    if (apiResponse?.$?.Status !== "OK") {
      return {
        domain: clean,
        available: false,
        price: null,
        error: apiErrorMessage(apiResponse, "Namecheap check failed"),
      };
    }

    const attrs = apiResponse?.CommandResponse?.[0]?.DomainCheckResult?.[0]?.$;
    if (!attrs) {
      return { domain: clean, available: false, price: null, error: "Namecheap returned no result" };
    }

    return resultFromAttrs(attrs, (attrs.Domain || clean).trim().toLowerCase());
  } catch (err) {
    return { domain: clean, available: false, price: null, error: err.message || "Namecheap check failed" };
  }
}

/**
 * Check many domains at once.
 *
 * Two calling styles, same as the service this replaces: pass a base name plus a
 * list of TLDs to expand, or pass a comma-separated list of full domains with an
 * empty TLD list.
 *
 * Unsupported TLDs are filtered out of the upstream request but still returned
 * to the caller, carrying their reason — a customer who searched for `.gh` gets
 * told why rather than silently losing the row.
 */
async function checkMultipleDomains(name, tlds = DEFAULT_SEARCH_TLDS) {
  let domainList;
  if (Array.isArray(tlds) && tlds.length > 0) {
    const base = String(name || "").replace(/\s+/g, "").toLowerCase();
    domainList = tlds.map((tld) => `${base}${tld.startsWith(".") ? tld : `.${tld}`}`);
  } else {
    domainList = String(name || "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }

  if (domainList.length === 0) return [];

  const unsupported = [];
  const supported = [];
  for (const d of domainList) {
    const tld = extractTLD(d);
    if (isSupportedTld(tld)) supported.push(d);
    else unsupported.push({ domain: d, available: false, price: null, error: unsupportedTldMessage(tld) });
  }

  if (!hasConfig()) {
    return [
      ...supported.map((d) => ({ domain: d, available: false, price: null, error: "Namecheap API not configured" })),
      ...unsupported,
    ];
  }

  await refreshCostUsd();

  // Namecheap accepts up to 50 domains per domains.check call.
  const MAX_PER_REQUEST = 50;
  const results = [];

  for (let i = 0; i < supported.length; i += MAX_PER_REQUEST) {
    const chunk = supported.slice(i, i + MAX_PER_REQUEST);
    try {
      const apiResponse = await callApi(
        { Command: "namecheap.domains.check", DomainList: chunk.join(",") },
        20000,
      );

      if (apiResponse?.$?.Status !== "OK") {
        const error = apiErrorMessage(apiResponse, "Namecheap check failed");
        logger.warn(`[Namecheap] domains.check ERROR: ${error}`);
        chunk.forEach((d) => results.push({ domain: d, available: false, price: null, error }));
        continue;
      }

      const items = apiResponse?.CommandResponse?.[0]?.DomainCheckResult || [];
      for (const item of items) {
        const attrs = item?.$;
        if (!attrs?.Domain) continue;
        const d = attrs.Domain.trim().toLowerCase();
        results.push(resultFromAttrs(attrs, d));
      }
    } catch (err) {
      const error = err.message || "Namecheap check failed";
      chunk.forEach((d) => results.push({ domain: d, available: false, price: null, error }));
    }
  }

  return [...results, ...unsupported];
}

/**
 * Register a domain.
 *
 * Unlike Spaceship this is a single synchronous call — `domains.create` returns
 * the outcome directly, so there is no operation to poll.
 *
 * @param {string} domain
 * @param {number} years
 * @param {object} registrant
 * @param {object} [options]
 * @param {boolean} [options.useEazWorldNameservers] - point the domain at our hosting
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function registerDomain(domain, years, registrant, options = {}) {
  if (!hasConfig()) {
    return { success: false, error: "Namecheap API not configured" };
  }

  const clean = String(domain || "").trim().toLowerCase();
  const tld = extractTLD(clean);
  if (!isSupportedTld(tld)) {
    return { success: false, error: unsupportedTldMessage(tld) };
  }

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

  // Namecheap requires the same contact repeated across all four roles.
  const shared = {
    FirstName: firstName,
    LastName: lastName,
    EmailAddress: email,
    Phone: toNamecheapPhone(phone, country),
    Address1: address,
    City: city,
    // StateProvince is mandatory even where it is meaningless; the city is the
    // conventional stand-in for Ghanaian addresses.
    StateProvince: city || "Greater Accra",
    Country: country,
    PostalCode: postalCode,
  };
  const contact = {};
  for (const role of ["Registrant", "Tech", "Admin", "AuxBilling"]) {
    for (const [field, value] of Object.entries(shared)) {
      contact[`${role}.${field}`] = value;
    }
  }

  // If the customer also ordered hosting, point the domain at EazWorld's cPanel
  // server at registration time rather than in a second call.
  const nameserverParams = {};
  if (options.useEazWorldNameservers) {
    const ns1 = process.env.NAMESERVER_1 || "ns1.eazworld.com";
    const ns2 = process.env.NAMESERVER_2 || "ns2.eazworld.com";
    nameserverParams.Nameservers = `${ns1},${ns2}`;
    logger.info(`[Namecheap] Registering ${clean} with EazWorld nameservers: ${ns1}, ${ns2}`);
  }

  try {
    const apiResponse = await callApi(
      {
        Command: "namecheap.domains.create",
        DomainName: clean,
        Years: Math.min(10, Math.max(1, Number(years) || 1)),
        ...contact,
        ...nameserverParams,
        // WhoisGuard. Namecheap defaults BOTH of these to "no", so omitting them
        // publishes the buyer's name, phone and street address in public WHOIS —
        // while /services and the FAQ promise "WHOIS privacy included at no extra
        // cost". The service this replaced sent privacyProtection at level
        // "high", so leaving them off was a regression, not a missing feature.
        AddFreeWhoisguard: "yes",
        WGEnabled: "yes",
      },
      30000,
    );

    if (apiResponse?.$?.Status !== "OK") {
      return { success: false, error: apiErrorMessage(apiResponse, "Domain registration failed") };
    }

    const result = apiResponse?.CommandResponse?.[0]?.DomainCreateResult?.[0]?.$;
    if (result && result.Registered !== "true") {
      return { success: false, error: "Namecheap did not confirm registration" };
    }

    // Registration succeeded, so never fail the order here — the customer owns
    // the domain either way. But privacy not being enabled is a promise broken
    // to that customer, so it must be loud rather than invisible.
    if (result && result.WhoisguardEnable !== "true") {
      logger.error(
        `[Namecheap] ${clean} REGISTERED WITHOUT WHOIS PRIVACY — registrant PII is public. Enable WhoisGuard manually.`,
      );
    }

    logger.info(`[Namecheap] Registered ${clean}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || "Domain registration failed" };
  }
}

/**
 * Point an already-registered domain at EazWorld's hosting nameservers.
 * @param {string} domain
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function setEazWorldNameservers(domain) {
  if (!hasConfig()) {
    return { success: false, error: "Namecheap API not configured" };
  }

  const ns1 = process.env.NAMESERVER_1 || "ns1.eazworld.com";
  const ns2 = process.env.NAMESERVER_2 || "ns2.eazworld.com";
  const clean = String(domain || "").trim().toLowerCase();
  const [sld, ...tldParts] = clean.split(".");
  const tld = tldParts.join(".");

  try {
    const apiResponse = await callApi({
      Command: "namecheap.domains.dns.setCustom",
      SLD: sld,
      TLD: tld,
      Nameservers: `${ns1},${ns2}`,
    });

    if (apiResponse?.$?.Status !== "OK") {
      return { success: false, error: apiErrorMessage(apiResponse, "Nameserver update failed") };
    }

    logger.info(`[Namecheap] Nameservers updated for ${clean} → ${ns1}, ${ns2}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || "Nameserver update failed" };
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
  toNamecheapPhone,
  _resetPriceCache: () => { priceCache = { data: null, at: 0 }; },
};
