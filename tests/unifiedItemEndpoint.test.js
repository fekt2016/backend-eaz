// One endpoint for both kinds of stock (owner request, 2026-09-04).
//
// The Marketplace form already covered shop products and bench parts; only the
// destination was split (/products vs /pos/inventory). Both now go to /products
// and declare themselves with `itemType`.
//
// Two things must survive that merge, and this suite pins both:
//   1. A bench part is still built the POS way — bench defaults applied, POS
//      vocabulary translated — so it is NOT published to the storefront.
//   2. The permission gap does not widen. /products allowed staff; the part
//      route never did. Staff must still be refused a part.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");

async function tokenFor(role) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const BASE = "/api/v1/products";

const partPayload = (over = {}) => ({
  itemType: "part",
  name: "iPhone 13 Screen",
  category: "Screen",
  quantity: 4,
  sellingPrice: 30000,
  costPrice: 18000,
  lowStockThreshold: 2,
  ...over,
});

describe("POST /products with itemType=part", () => {
  it("creates a bench part that is not published to the storefront", async () => {
    const token = await tokenFor("admin");
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send(partPayload());

    expect(res.status).toBe(201);
    const doc = await Product.findById(res.body.data._id);
    // The bench defaults createPart owns — the whole reason the routes were split.
    expect(doc.sellOnline).toBe(false);
    expect(doc.isActive).toBe(false);
    expect(doc.useInRepairs).toBe(true);
  });

  it("keeps the bench-only fields a product whitelist would have dropped", async () => {
    const token = await tokenFor("admin");
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send(partPayload({ barcode: "12345", compatibleWith: ["iPhone 13"] }));

    expect(res.status).toBe(201);
    const doc = await Product.findById(res.body.data._id);
    // POS vocabulary translated, not ignored.
    expect(doc.stock).toBe(4);              // quantity → stock
    expect(doc.price).toBe(30000);          // sellingPrice → price
    expect(doc.costPrice).toBe(18000);
    expect(doc.lowStockThreshold).toBe(2);
    expect(doc.barcode).toBe("12345");
    expect(doc.compatibleWith).toEqual(["iPhone 13"]);
    expect(doc.partCategory).toBe("Screen");
  });

  it("refuses a part from staff, who could never create one", async () => {
    const token = await tokenFor("staff");
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send(partPayload());

    expect(res.status).toBe(403);
    expect(await Product.countDocuments({ name: "iPhone 13 Screen" })).toBe(0);
  });

  it("still lets staff create an ordinary shop product", async () => {
    const token = await tokenFor("staff");
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Silicone Case", price: 5000, category: "Phone Cases & Covers" });

    expect(res.status).toBe(201);
    const doc = await Product.findById(res.body.data._id);
    expect(doc.isActive).toBe(true);
    expect(doc.sellOnline).toBe(true);
  });
});

describe("PATCH /products/:id with itemType=part", () => {
  it("updates a bench part through the inventory path", async () => {
    const token = await tokenFor("admin");
    const created = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send(partPayload());

    const res = await request(app)
      .patch(`${BASE}/${created.body.data._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ itemType: "part", quantity: 9, costPrice: 20000 });

    expect(res.status).toBe(200);
    const doc = await Product.findById(created.body.data._id);
    expect(doc.stock).toBe(9);
    expect(doc.costPrice).toBe(20000);
    // Still not published.
    expect(doc.sellOnline).toBe(false);
  });

  it("never writes itemType onto a product document", async () => {
    const token = await tokenFor("admin");
    const created = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Power Bank 10k", price: 22000, category: "Power Banks" });

    await request(app)
      .patch(`${BASE}/${created.body.data._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ itemType: "product", price: 23000 });

    const doc = await Product.findById(created.body.data._id).lean();
    expect(doc.itemType).toBeUndefined();
    expect(doc.price).toBe(23000);
  });
});

// One item type (owner request, 2026-09-04). The product/part distinction is
// gone from the UI: everything created through /products is sold online AND in
// store, and carries the fields that used to reach the model only via
// /pos/inventory. Those fields were dropped silently by createProduct's
// whitelist before, which is the failure this pins down.
describe("POST /products — one item type, all channels", () => {
  it("keeps the formerly bench-only fields a product payload used to lose", async () => {
    const token = await tokenFor("admin");
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Wooden Dining Table",
        price: 25000,
        category: "Furniture",
        costPrice: 15000,
        barcode: "555000111",
        lowStockThreshold: 3,
        compatibleWith: ["iPhone 13"],
        notes: "back room, shelf 2",
      });

    expect(res.status).toBe(201);
    const doc = await Product.findById(res.body.data._id);
    expect(doc.costPrice).toBe(15000);
    expect(doc.barcode).toBe("555000111");
    expect(doc.lowStockThreshold).toBe(3);
    expect(doc.compatibleWith).toEqual(["iPhone 13"]);
    expect(doc.notes).toBe("back room, shelf 2");
  });

  it("sells every new item online and in store", async () => {
    const token = await tokenFor("admin");
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Power Bank 20k", price: 30000, category: "Power Banks" });

    const doc = await Product.findById(res.body.data._id);
    expect(doc.sellOnline).toBe(true);
    expect(doc.sellInStore).toBe(true);
  });

  it("defaults useInRepairs on, and honours it when set false", async () => {
    const token = await tokenFor("admin");
    const on = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "iPhone 14 Screen", price: 40000, category: "Screen" });
    expect((await Product.findById(on.body.data._id)).useInRepairs).toBe(true);

    const off = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Gift Card", price: 5000, category: "Other", useInRepairs: false });
    expect((await Product.findById(off.body.data._id)).useInRepairs).toBe(false);
  });
});
