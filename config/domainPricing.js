/**
 * Domain cost table — our wholesale cost per TLD, in USD, per year.
 *
 * Why this file exists: Spaceship's API has **no pricing endpoint**. Namecheap had
 * `users.getPricing`, which the old Namecheap service called live and cached for an
 * hour. Spaceship only returns a price for *premium* domains, inside the
 * availability response. So standard TLD costs have to live here.
 *
 * These are COST figures (what Spaceship charges us), not what the customer pays.
 * `services/spaceship.js` → `usdToGhs()` applies the admin-set rate and markup
 * on top, exactly as the Namecheap path did, so the sell price stays consistent.
 *
 * Renewal prices are used rather than first-year promos: we bill the customer every
 * year, and a promo price would leave us short at renewal.
 *
 * ⚠️  Keep this in sync with Spaceship. When their prices move, ours are wrong until
 * someone edits this file — that is the trade-off for the missing pricing endpoint.
 */

// Verified against Spaceship's published renewal pricing, 2026-08-25.
const VERIFIED_USD = {
  ".com": 10.18,
  ".net": 11.4,
  ".org": 11.59,
  ".io": 51.75,
};

// Not yet verified against a Spaceship invoice. Set deliberately on the high side:
// overcharging slightly is recoverable, selling below cost is not. Replace each with
// the real renewal price from the Spaceship dashboard, then move it up into
// VERIFIED_USD.
const UNVERIFIED_USD = {
  ".co": 34.0,
  ".shop": 39.0,
  ".store": 62.0,
  ".online": 42.0,
  ".site": 38.0,
  ".tech": 55.0,
  ".dev": 15.0,
  ".app": 16.0,
  ".xyz": 14.0,
  ".info": 24.0,
  ".biz": 22.0,
  ".me": 22.0,
  ".cloud": 22.0,
};

const TLD_COST_USD = { ...VERIFIED_USD, ...UNVERIFIED_USD };

// TLDs Spaceship cannot sell. The API answers `tldNotSupported` for these, so we
// filter them out of search rather than showing a customer a result they can't buy.
// `.gh` / `.com.gh` are registry-restricted (ghNIC requires proof of Ghana business
// registration) and no mainstream registrar resells them — see tasks.md T64.
const UNSUPPORTED_TLDS = [".gh", ".com.gh", ".org.gh", ".edu.gh", ".gov.gh", ".africa"];

// What the domain search offers by default. Namecheap's list included `.africa`,
// `.com.gh` and `.gh`; those are dropped here because Spaceship rejects them.
const DEFAULT_SEARCH_TLDS = [".com", ".net", ".org", ".io", ".co", ".shop", ".online"];

function isSupportedTld(tld) {
  return !UNSUPPORTED_TLDS.includes((tld || "").toLowerCase());
}

// Ghanaian TLDs are a different kind of "no" from the rest: they exist, the
// customer can have one, just not from us. Saying so — and where to go instead —
// is the difference between a dead end and a useful answer (T65).
const GH_TLDS = [".gh", ".com.gh", ".org.gh", ".edu.gh", ".gov.gh"];

function unsupportedTldMessage(tld) {
  const t = (tld || "").toLowerCase();
  if (GH_TLDS.includes(t)) {
    return `${t} is issued by ghNIC and needs proof of Ghana business registration, so it must be registered through a ghNIC-accredited registrar. Once you own it we'll connect it to your hosting free of charge.`;
  }
  if (t === ".africa") {
    return `${t} isn't available through our registrar. We can connect one you already own to your hosting.`;
  }
  return `${t} is not available through our registrar.`;
}

function getCostUsd(tld) {
  return TLD_COST_USD[(tld || "").toLowerCase()] ?? null;
}

module.exports = {
  TLD_COST_USD,
  VERIFIED_USD,
  UNVERIFIED_USD,
  UNSUPPORTED_TLDS,
  DEFAULT_SEARCH_TLDS,
  isSupportedTld,
  unsupportedTldMessage,
  getCostUsd,
};
