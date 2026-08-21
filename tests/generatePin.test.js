// authController.generatePin (T55): must be a crypto.randomInt-backed 6-digit PIN
// in the same [100000, 999999] range Math.random produced, just from a CSPRNG.
const { generatePin } = require("../controllers/authController");

describe("generatePin", () => {
  it("always returns a 6-digit numeric string in [100000, 999999]", () => {
    for (let i = 0; i < 500; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
      const n = Number(pin);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });

  it("produces a healthy spread of values, not a constant or narrow range", () => {
    const pins = new Set(Array.from({ length: 500 }, () => generatePin()));
    // 500 draws from a 900,000-value range should collide rarely; a near-1:1
    // unique ratio rules out a broken/constant generator.
    expect(pins.size).toBeGreaterThan(490);
  });
});
