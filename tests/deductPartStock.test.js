const Part = require("../models/Part");
const { deductPartStock } = require("../utils/deductPartStock");

// Prices are integer pesewas (GH₵1.00 = 100).
function makePart(overrides = {}) {
  return {
    name: "Test Screen",
    category: "Screen",
    quantity: 5,
    costPrice: 10000,
    sellingPrice: 20000,
    ...overrides,
  };
}

describe("deductPartStock — repair/POS stock guard", () => {
  it("decrements stock when there is enough", async () => {
    const part = await Part.create(makePart({ quantity: 5 }));

    const result = await deductPartStock(part._id, 3);

    expect(result.ok).toBe(true);
    expect(result.wentNegative).toBeUndefined();
    const fresh = await Part.findById(part._id);
    expect(fresh.quantity).toBe(2);
  });

  it("refuses to drop below zero and leaves stock untouched", async () => {
    const part = await Part.create(makePart({ quantity: 2 }));

    const result = await deductPartStock(part._id, 5);

    expect(result.ok).toBe(false);
    const fresh = await Part.findById(part._id);
    expect(fresh.quantity).toBe(2); // unchanged — no oversell
    expect(fresh.quantity).toBeGreaterThanOrEqual(0);
  });

  it("allows negative stock only when the Part opts in", async () => {
    const part = await Part.create(
      makePart({ quantity: 1, allowNegativeStock: true }),
    );

    const result = await deductPartStock(part._id, 4);

    expect(result.ok).toBe(true);
    expect(result.wentNegative).toBe(true);
    const fresh = await Part.findById(part._id);
    expect(fresh.quantity).toBe(-3);
  });

  it("coerces a fractional/invalid qty to a safe positive integer", async () => {
    const part = await Part.create(makePart({ quantity: 5 }));

    const result = await deductPartStock(part._id, 2.9);

    expect(result.ok).toBe(true);
    const fresh = await Part.findById(part._id);
    expect(fresh.quantity).toBe(3); // 5 - floor(2.9) = 3
  });
});
