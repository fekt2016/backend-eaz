// The catalogue replacement the owner asked for on 2026-09-04: wipe products,
// insert the 15 sample ones, add the rest by hand. This proves the data is
// valid against the real schema and that the insert behaves — run against
// mongodb-memory-server, never a live cluster.
const Product = require("../models/Product");
const catalogue = require("../scripts/data/sampleCatalogue");
const { backupProducts } = require("../scripts/replaceCatalogue");

describe("sample catalogue data", () => {
  it("is 15 products with 3 variants each", () => {
    expect(catalogue).toHaveLength(15);
    expect(catalogue.every((p) => p.variants.length === 3)).toBe(true);
  });

  it("has no duplicate SKU anywhere — the index is unique across both levels", () => {
    const skus = catalogue.flatMap((p) => [p.sku, ...p.variants.map((v) => v.sku)]);
    expect(new Set(skus).size).toBe(skus.length);
    expect(skus).toHaveLength(60); // 15 parents + 45 variants
  });

  it("has no duplicate slug", () => {
    const slugs = catalogue.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("prices are whole pesewas, never floats", () => {
    for (const p of catalogue) {
      expect(Number.isInteger(p.price)).toBe(true);
      expect(Number.isInteger(p.costPrice)).toBe(true);
      for (const v of p.variants) {
        expect(v.price === null || Number.isInteger(v.price)).toBe(true);
      }
    }
  });

  it("every product passes the real Product schema", () => {
    for (const p of catalogue) {
      const err = new Product(p).validateSync();
      expect(err).toBeUndefined();
    }
  });

  it("inserts cleanly and keeps its variants", async () => {
    const docs = await Product.insertMany(catalogue);
    expect(docs).toHaveLength(15);
    expect(await Product.countDocuments()).toBe(15);

    const iphone = await Product.findOne({ sku: "EZW-IPH-001" });
    expect(iphone.variants).toHaveLength(3);
    expect(iphone.price).toBe(1850000); // GH₵18,500.00
    // null means "inherit the base price", not free.
    expect(iphone.variants[0].price).toBeNull();
    expect(iphone.variants[1].price).toBe(2050000);
  });

  it("carries the repair-stock and pre-order cases through insert", async () => {
    await Product.insertMany(catalogue);

    const screen = await Product.findOne({ sku: "EZW-IPH-005" });
    expect(screen.useInRepairs).toBe(true);
    expect(screen.sellOnline).toBe(true);        // sold AND fitted
    expect(screen.allowNegativeStock).toBe(true);
    expect(screen.partCategory).toBe("Screen");

    const airpods = await Product.findOne({ sku: "EZW-AIR-010" });
    expect(airpods.preorder.enabled).toBe(true);
    expect(airpods.stock).toBe(0);
    // The per-variant pre-order overriding the product-level one.
    const engraved = airpods.variants.find((v) => v.sku === "EZW-AIR-010-WHIENG");
    expect(engraved.preorder.enabled).toBe(true);
    expect(engraved.preorder.maxQty).toBe(1);
  });

  it("backs up existing products before anything is deleted", async () => {
    await Product.create({ name: "Old Thing", slug: "old-thing", price: 1000, category: "Phones" });
    const { file, count } = await backupProducts();
    expect(count).toBe(1);
    const saved = JSON.parse(require("fs").readFileSync(file, "utf8"));
    expect(saved[0].name).toBe("Old Thing");
    require("fs").unlinkSync(file);
  });
});
