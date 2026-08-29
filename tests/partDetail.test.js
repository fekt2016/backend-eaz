const request = require("supertest");
const app = require("../app");
const Product = require("../models/Product");

// Prices are integer pesewas (GH₵1.00 = 100).
function makePart(overrides = {}) {
  return {
    name: "iPhone 11 LCD Screen",
    sku: "PT-IPH-SCN-11",
    category: "Screen", partCategory: "Screen",
    sellOnline: true, sellInStore: true, useInRepairs: true,
    stock: 8,
    costPrice: 22750,
    price: 35000, // GH₵350.00
    images: ["https://res.cloudinary.com/demo/x.jpg"],
    ...overrides,
  };
}

// `part-<id>` URLs were minted before parts and products became one model.
// They are in the wild — shared links, bookmarks — so they must keep resolving,
// even though the item now has a real slug of its own.
describe("GET /api/v1/products/part-:id (legacy part URL)", () => {
  it("still resolves a legacy part URL, and answers with the item's real slug", async () => {
    const part = await Product.create(makePart());

    const res = await request(app).get(`/api/v1/products/part-${part._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.slug).toBe("iphone-11-lcd-screen");
    expect(res.body.data.price).toBe(35000); // unchanged pesewas — not ×100
    expect(res.body.data.stock).toBe(8);
    expect(res.body.data.kind).toBe("part");
    expect(res.body.data.images).toHaveLength(1);
  });

  it("404s for an item that is not listed in the shop", async () => {
    const part = await Product.create(makePart({ sellOnline: false }));

    const res = await request(app).get(`/api/v1/products/part-${part._id}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("404s for a malformed part id", async () => {
    const res = await request(app).get("/api/v1/products/part-not-an-id");
    expect(res.status).toBe(404);
  });
});
