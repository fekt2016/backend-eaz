const { amountMismatch } = require("../controllers/webhookController");

// Guards the Paystack webhook amount reconciliation. Two separate invariants
// live here:
//
// 1. Unit conversion. Hosting/domain/service store amounts in MAJOR GHS units
//    while Paystack reports pesewas, so callers pass the order's own
//    `*Pesewas` field. A naive `field !== event.amount` check would reject
//    every legitimate payment.
//
// 2. Fail closed when the expected amount is unknown (T90). This used to
//    return "no mismatch" whenever the expected amount was missing or zero,
//    so such an order fulfilled for ANY charged amount — including 1 pesewa.
//
// The function returns a REASON STRING or null, not a boolean: the caller logs
// it, so an operator can tell "we were charged the wrong amount" apart from
// "we could not tell what the right amount was".
describe("amountMismatch (webhook amount reconciliation)", () => {
  const pesewas = (major) => Math.round(major * 100);

  it("returns null when the charged pesewas matches the expected major-unit amount", () => {
    // GH₵50.00 order → 5000 pesewas charged
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, pesewas(50))).toBeNull();
  });

  it("reports amount_mismatch when the charged amount is lower than expected", () => {
    // Attacker pays GH₵1 (100 pesewas) against a GH₵50 order
    expect(amountMismatch({ amount: 100, currency: "GHS" }, pesewas(50))).toBe("amount_mismatch");
  });

  it("reports currency_mismatch for a non-GHS currency", () => {
    expect(amountMismatch({ amount: 5000, currency: "USD" }, pesewas(50))).toBe("currency_mismatch");
  });

  // T90 inverted this case. It previously asserted the function "does not block
  // when no reliable expected amount is available", which encoded the
  // vulnerability as the expected outcome: a missing expected amount was an
  // escape hatch that fulfilled an order for any charge. Verified against the
  // live database on 2026-08-29 — hostingorders, domainorders, serviceorders,
  // partorders and repairorders are all empty, so the hatch protected no real
  // data and the default is now to refuse.
  it("reports amount_unverifiable when no reliable expected amount is available", () => {
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, 0)).toBe("amount_unverifiable");
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, NaN)).toBe("amount_unverifiable");
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, undefined)).toBe("amount_unverifiable");
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, -1)).toBe("amount_unverifiable");
  });

  // Pins the precedence in the implementation: the amount is checked before the
  // currency, so a charge that is wrong on both reports the amount. Worth
  // fixing in a test because the reason string is what an operator triages on.
  it("reports the amount before the currency when both are wrong", () => {
    expect(amountMismatch({ amount: 100, currency: "USD" }, pesewas(50))).toBe("amount_mismatch");
  });

  // A missing currency is not treated as a mismatch — the implementation only
  // rejects a currency that is present and not GHS.
  it("accepts a charge with no currency field when the amount is right", () => {
    expect(amountMismatch({ amount: 5000 }, pesewas(50))).toBeNull();
  });
});
