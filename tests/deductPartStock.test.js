const { deductPartStock } = require("../utils/deductPartStock");
const Product = require("../models/Product");

// Prices are integer pesewas (GH₵1.00 = 100).
function makePart(overrides = {}) {
  return {
    name: "Test Screen",
    category: "Screen",
    partCategory: "Screen",
    stock: 5,
    costPrice: 10000,
    price: 20000,
    useInRepairs: true,
    ...overrides,
  };
}

describe("deductPartStock — repair/POS stock guard", () => {
  it("decrements stock when there is enough", async () => {
    const part = await Product.create(makePart({ stock: 5 }));

    const result = await deductPartStock(part._id, 3);

    expect(result.ok).toBe(true);
    expect(result.wentNegative).toBeUndefined();
    const fresh = await Product.findById(part._id);
    expect(fresh.stock).toBe(2);
  });

  it("refuses to drop below zero and leaves stock untouched", async () => {
    const part = await Product.create(makePart({ stock: 2 }));

    const result = await deductPartStock(part._id, 5);

    expect(result.ok).toBe(false);
    const fresh = await Product.findById(part._id);
    expect(fresh.stock).toBe(2); // unchanged — no oversell
    expect(fresh.stock).toBeGreaterThanOrEqual(0);
  });

  it("allows negative stock only when the Part opts in", async () => {
    const part = await Product.create(
      makePart({ stock: 1, allowNegativeStock: true }),
    );

    const result = await deductPartStock(part._id, 4);

    expect(result.ok).toBe(true);
    expect(result.wentNegative).toBe(true);
    const fresh = await Product.findById(part._id);
    expect(fresh.stock).toBe(-3);
  });

  it("coerces a fractional/invalid qty to a safe positive integer", async () => {
    const part = await Product.create(makePart({ stock: 5 }));

    const result = await deductPartStock(part._id, 2.9);

    expect(result.ok).toBe(true);
    const fresh = await Product.findById(part._id);
    expect(fresh.stock).toBe(3); // 5 - floor(2.9) = 3
  });
});
