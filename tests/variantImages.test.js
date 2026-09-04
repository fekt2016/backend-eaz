// The product page prefers variants[].images over the product gallery, but an
// empty array falls back to the product hero — so with no images anywhere,
// switching Black to Blue changes nothing and the picker looks broken. This
// covers the placeholder builder and the backfill that fills those gaps.
const Product = require("../models/Product");
const { variantPlaceholder, productPlaceholder, backgroundFor, labelFor } = require("../utils/variantPlaceholder");
const { planFor, applyPlan } = require("../scripts/backfillVariantImages");

describe("variantPlaceholder", () => {
  it("matches the background to the variant's colour", () => {
    expect(variantPlaceholder({ color: "Black" })).toContain("/111827/");
    expect(variantPlaceholder({ color: "Blue" })).toContain("/1d4ed8/");
  });

  it("reads a colour out of a multi-word value", () => {
    expect(backgroundFor({ color: "Blue Titanium" })).toBe("1d4ed8");
    expect(backgroundFor({ color: "Awesome Navy" })).toBe("1e3a8a");
  });

  it("puts dark text on a light background and light on dark", () => {
    expect(variantPlaceholder({ color: "White" })).toMatch(/f9fafb\/111827/);
    expect(variantPlaceholder({ color: "Black" })).toMatch(/111827\/ffffff/);
  });

  it("falls back to a neutral background when no value names a colour", () => {
    expect(backgroundFor({ grade: "Original Pull" })).toBe("334155");
    expect(backgroundFor({})).toBe("334155");
  });

  it("captions with the colour alone — the swatch renders at 56px", () => {
    expect(labelFor({ color: "Black", storage: "128GB" })).toBe("Black");
    expect(labelFor({ color: "Natural Titanium", storage: "512GB" })).toBe("Natural Titanium");
  });

  it("gives one colour ONE picture, whatever the storage", () => {
    // Captioning with every attribute made these differ, which is untrue — and
    // it fed the storefront two images for the size row, which then tried to
    // show a black phone beside a blue one on a row that chooses neither.
    const a = variantPlaceholder({ color: "Black", storage: "128GB" });
    const b = variantPlaceholder({ color: "Black", storage: "256GB" });
    expect(a).toBe(b);
  });

  it("still tells apart variants of a product that has no colour", () => {
    const a = variantPlaceholder({ grade: "Original Pull" });
    const b = variantPlaceholder({ grade: "Incell Copy" });
    expect(a).not.toBe(b);
  });

  it("uses placehold.co, which is already an allowed image host", () => {
    expect(productPlaceholder("iPhone 15 Pro")).toMatch(/^https:\/\/placehold\.co\//);
  });
});

describe("backfillVariantImages", () => {
  const seed = () => Product.create({
    name: "iPhone 15 Pro", slug: "ip15p", price: 1850000, category: "Phones", images: [],
    variants: [
      { sku: "V-BLA", attributes: { color: "Black" }, stock: 2, images: [] },
      { sku: "V-BLU", attributes: { color: "Blue" }, stock: 1, images: [] },
    ],
  });

  it("plans a hero and one image per variant that has none", async () => {
    await seed();
    const plan = planFor(await Product.find({}).lean());
    expect(plan).toHaveLength(1);
    expect(plan[0].hero).toBeTruthy();
    expect(plan[0].variants.map((v) => v.sku)).toEqual(["V-BLA", "V-BLU"]);
  });

  it("fills them, and each variant gets a different image", async () => {
    await seed();
    const r = await applyPlan(planFor(await Product.find({}).lean()));
    expect(r).toEqual({ products: 1, heroes: 1, variants: 2 });

    const doc = await Product.findOne({ slug: "ip15p" });
    expect(doc.images).toHaveLength(1);
    expect(doc.variants[0].images[0]).not.toBe(doc.variants[1].images[0]);
  });

  it("never overwrites a real photo", async () => {
    await Product.create({
      name: "Shot Already", slug: "shot", price: 1000, category: "Phones",
      images: ["https://res.cloudinary.com/eaz/real-hero.jpg"],
      variants: [{ sku: "V-1", attributes: { color: "Black" }, stock: 1, images: ["https://res.cloudinary.com/eaz/real-black.jpg"] }],
    });
    expect(planFor(await Product.find({}).lean())).toHaveLength(0);
  });

  it("fills only the gaps when a product is half photographed", async () => {
    await Product.create({
      name: "Half", slug: "half", price: 1000, category: "Phones",
      images: ["https://res.cloudinary.com/eaz/hero.jpg"],
      variants: [
        { sku: "H-1", attributes: { color: "Black" }, stock: 1, images: ["https://res.cloudinary.com/eaz/black.jpg"] },
        { sku: "H-2", attributes: { color: "Blue" }, stock: 1, images: [] },
      ],
    });
    const plan = planFor(await Product.find({}).lean());
    expect(plan[0].hero).toBeNull();
    expect(plan[0].variants.map((v) => v.sku)).toEqual(["H-2"]);

    await applyPlan(plan);
    const doc = await Product.findOne({ slug: "half" });
    expect(doc.variants[0].images[0]).toBe("https://res.cloudinary.com/eaz/black.jpg");
    expect(doc.variants[1].images[0]).toMatch(/placehold\.co/);
  });

  it("is idempotent — a second run has nothing to do", async () => {
    await seed();
    await applyPlan(planFor(await Product.find({}).lean()));
    expect(planFor(await Product.find({}).lean())).toHaveLength(0);
  });
});


// Regenerating captions must never cost anyone their photography.
describe("backfillVariantImages --refresh", () => {
  it("leaves real photos alone even when refreshing", async () => {
    await Product.create({
      name: "Shot", slug: "shot", price: 1000, category: "Phones",
      images: ["https://res.cloudinary.com/eaz/hero.jpg"],
      variants: [{ sku: "V-1", attributes: { color: "Black" }, stock: 1, images: ["https://res.cloudinary.com/eaz/black.jpg"] }],
    });
    expect(planFor(await Product.find({}).lean(), { refresh: true })).toHaveLength(0);
  });

  it("regenerates images that are our own placeholders", async () => {
    await Product.create({
      name: "Placeheld", slug: "ph", price: 1000, category: "Phones",
      images: ["https://placehold.co/800x800/334155/ffffff?text=old"],
      variants: [{ sku: "V-1", attributes: { color: "Black" }, stock: 1, images: ["https://placehold.co/800x800/111827/ffffff?text=Black%20128GB"] }],
    });
    const plan = planFor(await Product.find({}).lean(), { refresh: true });
    expect(plan).toHaveLength(1);

    await applyPlan(plan, { refresh: true });
    const doc = await Product.findOne({ slug: "ph" });
    // Colour only: no model name, no storage.
    expect(decodeURIComponent(doc.variants[0].images[0])).toContain("Black");
    expect(decodeURIComponent(doc.variants[0].images[0])).not.toContain("Placeheld");
    expect(decodeURIComponent(doc.variants[0].images[0])).not.toContain("128GB");
  });

  it("does nothing extra without --refresh", async () => {
    await Product.create({
      name: "Placeheld", slug: "ph2", price: 1000, category: "Phones",
      images: ["https://placehold.co/800x800/334155/ffffff?text=old"],
      variants: [{ sku: "V-1", attributes: { color: "Black" }, stock: 1, images: ["https://placehold.co/800x800/111827/ffffff?text=old"] }],
    });
    expect(planFor(await Product.find({}).lean())).toHaveLength(0);
  });
});
