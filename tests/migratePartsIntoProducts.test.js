const mongoose = require("mongoose");
const Part = require("../models/Part");
const Product = require("../models/Product");
const {
  migratePartsIntoProducts,
  backfillProductChannels,
  preflightPlanned,
} = require("../scripts/migratePartsIntoProducts");

const silent = () => {};

async function makePart(overrides = {}) {
  return Part.create({
    name: "iPhone 14 Screen",
    category: "Screen",
    isRetail: true,
    quantity: 6,
    costPrice: 40000,
    sellingPrice: 65000,
    ...overrides,
  });
}

async function makeProduct(overrides = {}) {
  return Product.create({
    name: "Widget",
    slug: `widget-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 1000,
    category: "Accessories",
    stock: 5,
    ...overrides,
  });
}

describe("migratePartsIntoProducts", () => {
  it("writes nothing on a dry run", async () => {
    await makePart();
    const before = await Product.countDocuments();

    const res = await migratePartsIntoProducts({ log: silent });

    expect(res.migrated).toBe(0);
    expect(await Product.countDocuments()).toBe(before);
  });

  it("preserves the part's _id so existing refs still resolve", async () => {
    // The whole safety argument rests on this: Order/RepairJob/Sale/PartOrder/
    // RepairOrder hold this id in live financial history.
    const part = await makePart();

    await migratePartsIntoProducts({ apply: true, log: silent });

    const copied = await Product.findById(part._id);
    expect(copied).toBeTruthy();
    expect(String(copied._id)).toBe(String(part._id));
  });

  it("maps every field onto its product equivalent", async () => {
    const part = await makePart({
      sku: "SCR-14",
      barcode: "5901234123457",
      compatibleWith: ["iPhone 14"],
      lowStockThreshold: 2,
      allowNegativeStock: true,
      notes: "bench stock",
      images: ["https://res.cloudinary.com/demo/s.jpg"],
    });
    await Part.updateOne({ _id: part._id }, { $set: { views: 7, sold: 3 } });

    await migratePartsIntoProducts({ apply: true, log: silent });
    const p = await Product.findById(part._id).lean();

    expect(p.price).toBe(65000); // sellingPrice → price
    expect(p.costPrice).toBe(40000); // carried, so COGS finally works
    expect(p.stock).toBe(6); // quantity → stock
    expect(p.partCategory).toBe("Screen"); // repair taxonomy kept
    expect(p.category).toBe("Screen"); // required shop field populated
    expect(p.sku).toBe("SCR-14");
    expect(p.barcode).toBe("5901234123457");
    expect(p.compatibleWith).toEqual(["iPhone 14"]);
    expect(p.lowStockThreshold).toBe(2);
    expect(p.allowNegativeStock).toBe(true);
    expect(p.notes).toBe("bench stock");
    expect(p.images).toEqual(["https://res.cloudinary.com/demo/s.jpg"]);
    expect(p.views).toBe(7); // counters survive
    expect(p.sold).toBe(3);
  });

  it("sets the channel flags from isRetail", async () => {
    const retail = await makePart({ name: "Retail Screen", isRetail: true });
    const bench = await makePart({ name: "Bench Only Board", category: "Board", isRetail: false });

    await migratePartsIntoProducts({ apply: true, log: silent });

    const r = await Product.findById(retail._id).lean();
    expect(r.sellOnline).toBe(true);
    expect(r.sellInStore).toBe(true);
    expect(r.useInRepairs).toBe(true);

    const b = await Product.findById(bench._id).lean();
    expect(b.sellOnline).toBe(false); // never listed in the shop
    expect(b.sellInStore).toBe(false); // nor rung up at the counter
    expect(b.useInRepairs).toBe(true); // but still fits on a job
    expect(b.isActive).toBe(false); // legacy shop gate agrees with sellOnline
  });

  it("generates a unique slug, and does not collide with an existing product", async () => {
    await makeProduct({ name: "iPhone 14 Screen", slug: "iphone-14-screen" });
    const part = await makePart({ name: "iPhone 14 Screen" });

    await migratePartsIntoProducts({ apply: true, log: silent });

    const p = await Product.findById(part._id).lean();
    expect(p.slug).not.toBe("iphone-14-screen");
    expect(p.slug).toContain("iphone-14-screen");
    expect(await Product.countDocuments({ slug: p.slug })).toBe(1);
  });

  it("gives two identically-named parts different slugs in one run", async () => {
    const a = await makePart({ name: "Generic Cable", category: "Cable" });
    const b = await makePart({ name: "Generic Cable", category: "Cable" });

    await migratePartsIntoProducts({ apply: true, log: silent });

    const pa = await Product.findById(a._id).lean();
    const pb = await Product.findById(b._id).lean();
    expect(pa.slug).not.toBe(pb.slug);
  });

  it("is idempotent — a second run copies nothing", async () => {
    await makePart();
    await migratePartsIntoProducts({ apply: true, log: silent });
    const afterFirst = await Product.countDocuments();

    const second = await migratePartsIntoProducts({ apply: true, log: silent });

    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await Product.countDocuments()).toBe(afterFirst);
  });

  it("leaves the parts collection untouched, so rollback is doing nothing", async () => {
    const part = await makePart();
    await migratePartsIntoProducts({ apply: true, log: silent });

    const stillThere = await Part.findById(part._id).lean();
    expect(stillThere).toBeTruthy();
    expect(stillThere.quantity).toBe(6);
    expect(await Part.countDocuments()).toBe(1);
  });

  it("reports items with no cost price instead of inventing one", async () => {
    await makeProduct({ name: "Costless Widget" }); // products never stored a cost
    await makePart({ costPrice: 40000 });

    const res = await migratePartsIntoProducts({ apply: true, log: silent });

    const names = res.needCost.map((p) => p.name);
    expect(names).toContain("Costless Widget");
    expect(names).not.toContain("iPhone 14 Screen"); // it has a real cost
  });
});

describe("preflightPlanned", () => {
  it("passes a plan the Product schema accepts", async () => {
    const part = await makePart();
    const res = await migratePartsIntoProducts({ log: silent });

    expect(res.problems).toEqual([]);
    expect(await Product.findById(part._id)).toBeNull(); // still a dry run
  });

  it("names the schema failure instead of leaving it for --apply", async () => {
    const problems = await preflightPlanned(
      [{ _id: new mongoose.Types.ObjectId(), name: "Broken", slug: "broken", stock: 1 }],
      silent,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0].reasons.join(" ")).toMatch(/Price is required/);
    expect(problems[0].reasons.join(" ")).toMatch(/Category is required/);
  });

  it("catches a SKU that already belongs to a product", async () => {
    await makeProduct({ name: "Existing Widget", sku: "SCR-14" });
    await makePart({ sku: "SCR-14" });

    const res = await migratePartsIntoProducts({ log: silent });

    expect(res.problems).toHaveLength(1);
    expect(res.problems[0].reasons.join(" ")).toMatch(/already belongs to product "Existing Widget"/);
  });

  // Driven straight at the helper: Part's own unique SKU index means two such
  // parts cannot be created here, but the live collection predates that index
  // (hence `npm run check:duplicate-skus`), so the batch can still carry a pair.
  it("catches two planned documents sharing a SKU", async () => {
    const doc = (name) => ({
      _id: new mongoose.Types.ObjectId(),
      name,
      slug: name.toLowerCase().replace(/ /g, "-"),
      price: 1000,
      category: "Screen",
      stock: 1,
      sku: "DUP-1",
    });

    const problems = await preflightPlanned([doc("Screen A"), doc("Screen B")], silent);

    expect(problems).toHaveLength(1); // the second one is the collision
    expect(problems[0].name).toBe("Screen B");
    expect(problems[0].reasons.join(" ")).toMatch(/also used by "Screen A" in this batch/);
  });

  it("refuses to write a batch with any failure, rather than half-applying it", async () => {
    await makeProduct({ name: "Existing Widget", sku: "SCR-14" });
    await makePart({ name: "Clashing Screen", sku: "SCR-14" });
    const clean = await makePart({ name: "Fine Screen", sku: "SCR-15" });

    const res = await migratePartsIntoProducts({ apply: true, log: silent });

    expect(res.migrated).toBe(0);
    expect(res.failed).toBe(1);
    expect(await Product.findById(clean._id)).toBeNull(); // the good one waits too
  });
});

describe("backfillProductChannels", () => {
  it("mirrors sellOnline from isActive so an inactive product stays hidden", async () => {
    const live = await makeProduct({ name: "Live", isActive: true });
    const hidden = await makeProduct({ name: "Hidden", isActive: false });
    // Simulate documents written before the flags existed.
    await Product.collection.updateMany(
      {},
      { $unset: { sellOnline: "", sellInStore: "", useInRepairs: "" } },
    );

    const updated = await backfillProductChannels({ apply: true, log: silent });
    expect(updated).toBe(2);

    expect((await Product.findById(live._id).lean()).sellOnline).toBe(true);
    expect((await Product.findById(hidden._id).lean()).sellOnline).toBe(false);
    expect((await Product.findById(live._id).lean()).sellInStore).toBe(true);
    expect((await Product.findById(live._id).lean()).useInRepairs).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const p = await makeProduct();
    await Product.collection.updateMany({}, { $unset: { sellOnline: "" } });

    const updated = await backfillProductChannels({ log: silent });

    expect(updated).toBe(0);
    expect((await Product.findById(p._id).lean()).sellOnline).toBeUndefined();
  });

  it("does not overwrite a flag someone has already set", async () => {
    const p = await makeProduct({ isActive: true });
    await Product.updateOne({ _id: p._id }, { $set: { sellOnline: false } });

    await backfillProductChannels({ apply: true, log: silent });

    // sellOnline exists, so the backfill skipped this document entirely.
    expect((await Product.findById(p._id).lean()).sellOnline).toBe(false);
  });
});
