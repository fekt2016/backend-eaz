/**
 * Domain cost table — our wholesale cost per TLD, in USD, per year.
 *
 * Why this file exists: it is the FALLBACK cost source. Namecheap does publish
 * pricing (`users.getPricing`), and services/namecheap.js prefers it, caching it
 * for an hour. This table is what prices a domain when that call fails, when a
 * TLD is missing from the response, or before the first successful fetch — so
 * search never breaks because a third party was down.
 *
 * These are COST figures (what the registrar charges us), not what the customer
 * pays. `services/namecheap.js` → `usdToGhs()` applies the admin-set rate and
 * markup on top, so the sell price stays consistent whichever source the cost
 * came from.
 *
 * Renewal prices are used rather than first-year promos: we bill the customer
 * every year, and a promo price would leave us short at renewal.
 *
 * ⚠️  These figures were verified against SPACESHIP, not Namecheap (2026-08-25),
 * and the registrar changed on 2026-08-31. Until they are re-verified they are
 * only a fallback for the live Namecheap prices — treat a value here as an upper
 * bound, not a fact. Re-verify against a Namecheap invoice and update.
 */

// Carried over from the Spaceship price list (2026-08-25) — NOT yet re-verified
// against Namecheap. See the warning above.
const VERIFIED_USD = {
  ".com": 10.18,
  ".net": 11.4,
  ".org": 11.59,
  ".io": 51.75,
};

// Never verified against any invoice. Set deliberately on the high side:
// overcharging slightly is recoverable, selling below cost is not. Replace each with
// the real renewal price from the Namecheap dashboard, then move it up into
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
  // Back on sale with the move to Namecheap (2026-08-31); cost not yet invoiced.
  ".africa": 22.0,
};

const TLD_COST_USD = { ...VERIFIED_USD, ...UNVERIFIED_USD };

// TLDs we cannot sell, so search filters them out rather than showing a customer
// a result they can't buy. `.gh` / `.com.gh` are registry-restricted (ghNIC
// requires proof of Ghana business registration) and no mainstream registrar
// resells them — see tasks.md T64.
//
// `.africa` is NOT in this list any more: Spaceship could not sell it, Namecheap
// can. It returned to DEFAULT_SEARCH_TLDS with the registrar change.
const UNSUPPORTED_TLDS = [".gh", ".com.gh", ".org.gh", ".edu.gh", ".gov.gh"];

// What the domain search offers by default. `.africa` is back now that Namecheap
// is the registrar; `.com.gh` and `.gh` stay out — they are registry-restricted,
// not registrar-limited.
const DEFAULT_SEARCH_TLDS = [".com", ".net", ".org", ".io", ".co", ".africa", ".shop", ".online"];

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
