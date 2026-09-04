// Fulfilment decrements variants.$.stock and never the top-level field, so a
// variant product's stored stock drifted with every sale — iPhone 15 Pro read 12
// while its variants held 7. Lists hid it by reporting the variant total, but the
// stored number still reached the admin edit form and the product page.
const Product = require("../models/Product");
const { syncVariantStock } = require("../utils/syncVariantStock");
const { findDrift, applyDrift } = require("../scripts/repairVariantStock");

const withVariants = (stock, variantStocks) => ({
  name: "iPhone 15 Pro", slug: `ip-${Math.random().toString(36).slice(2, 8)}`,
  price: 1850000, category: "Phones", stock,
  variants: variantStocks.map((s, i) => ({ sku: `V-${i}`, attributes: { storage: `${128 * (i + 1)}GB` }, stock: s })),
});

describe("syncVariantStock", () => {
  it("brings the stored stock back to the sum of its variants", async () => {
    const p = await Product.create(withVariants(12, [0, 4, 3]));
    const result = await syncVariantStock(p._id);

    expect(result).toEqual({ productId: p._id, from: 12, to: 7 });
    expect((await Product.findById(p._id)).stock).toBe(7);
  });

  it("does nothing when they already agree", async () => {
    const p = await Product.create(withVariants(7, [0, 4, 3]));
    expect(await syncVariantStock(p._id)).toBeNull();
  });

  it("leaves a product without variants alone — there the field IS the stock", async () => {
    const p = await Product.create({ name: "Plain", slug: "plain", price: 1000, category: "Phones", stock: 9 });
    expect(await syncVariantStock(p._id)).toBeNull();
    expect((await Product.findById(p._id)).stock).toBe(9);
  });

  it("counts a fully depleted product as zero, not as its old number", async () => {
    const p = await Product.create(withVariants(30, [0, 0, 0]));
    await syncVariantStock(p._id);
    expect((await Product.findById(p._id)).stock).toBe(0);
  });

  it("tolerates a missing product", async () => {
    expect(await syncVariantStock(new Product()._id)).toBeNull();
  });
});

describe("repairVariantStock", () => {
  it("finds and corrects only the drifted products", async () => {
    const drifted = await Product.create(withVariants(12, [0, 4, 3]));
    const fine = await Product.create(withVariants(5, [5]));
    await Product.create({ name: "No variants", slug: "nv", price: 100, category: "Phones", stock: 3 });

    const rows = await findDrift();
    expect(rows.map((r) => String(r._id))).toEqual([String(drifted._id)]);
    expect(rows[0]).toMatchObject({ stored: 12, actual: 7 });

    expect(await applyDrift(rows)).toBe(1);
    expect((await Product.findById(drifted._id)).stock).toBe(7);
    expect((await Product.findById(fine._id)).stock).toBe(5);
    expect(await findDrift()).toEqual([]);
  });
});
