// The product/part distinction is gone (owner request, 2026-09-04): everything
// is sold online and in store. New stock is created that way, but items
// migrated in earlier still carry the bench defaults and stay invisible. This
// covers the script that flips them over.
const Product = require("../models/Product");
const { planPublish, publishParts, summarise } = require("../scripts/publishPartsToShop");

async function seed() {
  await Product.create([
    // Hidden bench stock — the migration's target.
    { name: "iPhone 13 Screen", slug: "s1", price: 30000, category: "Screen",
      sellOnline: false, isActive: false, useInRepairs: true, images: ["a.jpg"] },
    { name: "Samsung Battery", slug: "s2", price: 12000, category: "Battery",
      sellOnline: false, isActive: false, useInRepairs: true },
    // Already on sale — must not be touched or double-counted.
    { name: "Silicone Case", slug: "s3", price: 5000, category: "Phone Cases & Covers",
      sellOnline: true, isActive: true },
  ]);
}

describe("publishPartsToShop", () => {
  it("plans only the items the shop cannot currently show", async () => {
    await seed();
    const plan = await planPublish();
    expect(plan.map((p) => p.name).sort()).toEqual(["Samsung Battery", "iPhone 13 Screen"]);
  });

  it("reports the gaps a customer would see, without blocking on them", async () => {
    await seed();
    const s = summarise(await planPublish());
    expect(s.total).toBe(2);
    expect(s.noImage).toBe(1);        // the battery
    expect(s.noDescription).toBe(2);  // both
    expect(s.byCategory).toEqual({ Screen: 1, Battery: 1 });
  });

  it("publishes hidden stock and leaves everything else alone", async () => {
    await seed();
    const changed = await publishParts();
    expect(changed).toBe(2);

    const screen = await Product.findOne({ slug: "s1" });
    expect(screen.sellOnline).toBe(true);
    expect(screen.isActive).toBe(true);
    // Untouched: price, stock, category and repair eligibility.
    expect(screen.price).toBe(30000);
    expect(screen.category).toBe("Screen");
    expect(screen.useInRepairs).toBe(true);
  });

  it("is idempotent — a second run has nothing to do", async () => {
    await seed();
    expect(await publishParts()).toBe(2);
    expect(await publishParts()).toBe(0);
    expect(await planPublish()).toEqual([]);
  });

  it("can publish only the photographed items when staging the rollout", async () => {
    await seed();
    const changed = await publishParts({ withImagesOnly: true });
    expect(changed).toBe(1);
    expect((await Product.findOne({ slug: "s1" })).sellOnline).toBe(true);  // has an image
    expect((await Product.findOne({ slug: "s2" })).sellOnline).toBe(false); // does not
  });
});
