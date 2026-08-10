const { amountMismatch } = require("../controllers/webhookController");

// Guards the Paystack webhook amount reconciliation. The bug this protects
// against: hosting/domain/service store amounts in MAJOR GHS units while
// Paystack reports pesewas, so callers pass Math.round(field * 100). A naive
// `field !== event.amount` check would reject every legitimate payment.
describe("amountMismatch (webhook amount reconciliation)", () => {
  const pesewas = (major) => Math.round(major * 100);

  it("passes when the charged pesewas matches the expected major-unit amount", () => {
    // GH₵50.00 order → 5000 pesewas charged
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, pesewas(50))).toBe(false);
  });

  it("rejects when the charged amount is lower than expected", () => {
    // Attacker pays GH₵1 (100 pesewas) against a GH₵50 order
    expect(amountMismatch({ amount: 100, currency: "GHS" }, pesewas(50))).toBe(true);
  });

  it("rejects a non-GHS currency", () => {
    expect(amountMismatch({ amount: 5000, currency: "USD" }, pesewas(50))).toBe(true);
  });

  it("does not block when no reliable expected amount is available", () => {
    // Legacy order with a missing/zero amount must still be able to fulfil.
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, 0)).toBe(false);
    expect(amountMismatch({ amount: 5000, currency: "GHS" }, NaN)).toBe(false);
  });
});
