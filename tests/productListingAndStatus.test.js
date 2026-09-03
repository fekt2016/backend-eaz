const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");

async function makeStaff() {
  const user = await User.create({
    name: "Staff",
    email: `staff-${Date.now()}@t.com`,
    password: "Password123!",
    role: "staff",
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

// ── #12: merged product + retail-part listing, sorted/paginated in the DB ──
describe("GET /api/v1/products (merged listing)", () => {
  it("includes sellable retail parts shaped like products, priced in pesewas", async () => {
    await Product.create({
      name: "Cable", slug: "cable", price: 2000, category: "Accessory", stock: 5, isActive: true,
    });
    const part = await Product.create({
      name: "iPhone 12 Battery", category: "Battery", partCategory: "Battery", sellOnline: true, sellInStore: true, stock: 4,
      costPrice: 8000, price: 15000, useInRepairs: true});

    const res = await request(app).get("/api/v1/products?limit=50");
    expect(res.status).toBe(200);

    const partRow = res.body.data.find((d) => d.kind === "part");
    expect(partRow).toBeTruthy();
    // A part has a real slug of its own now — the synthetic `part-<id>` URL
    // still resolves (see partDetail.test.js) but is no longer its identity.
    expect(partRow.slug).toBe("iphone-12-battery");
    expect(partRow.price).toBe(15000); // sellingPrice pesewas, not ×100
    expect(partRow.stock).toBe(4);
    expect(res.body.total).toBe(2); // product + part
  });

  it("excludes retail parts with no stock", async () => {
    await Product.create({
      name: "Dead Stock Screen", category: "Screen", partCategory: "Screen", sellOnline: true, sellInStore: true, stock: 0,
      costPrice: 100, price: 200, useInRepairs: true});
    const res = await request(app).get("/api/v1/products");
    expect(res.body.data.find((d) => d.kind === "part")).toBeFalsy();
  });

  it("sorts by price ascending across products and parts", async () => {
    await Product.create({ name: "Pricey", slug: "pricey", price: 90000, category: "x", stock: 1 });
    await Product.create({ name: "Cheap Part", category: "Other", partCategory: "Other", sellOnline: true, sellInStore: true, stock: 2, costPrice: 100, price: 500, useInRepairs: true});

    const res = await request(app).get("/api/v1/products?sort=price-asc&limit=50");
    const prices = res.body.data.map((d) => d.price);
    const sorted = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

it("kind=product returns only real shop products, excluding retail parts", async () => {
    await Product.create({
      name: "Cable", slug: "cable", price: 2000, category: "Accessory", stock: 5, isActive: true,
    });
    await Product.create({
      name: "iPhone 12 Battery", category: "Battery", partCategory: "Battery", sellOnline: true, sellInStore: true, stock: 4,
      costPrice: 8000, price: 15000, useInRepairs: true});

    const res = await request(app).get("/api/v1/products?kind=product&limit=50");
    expect(res.status).toBe(200);
    expect(res.body.data.every((d) => d.kind === "product")).toBe(true);
    expect(res.body.data.find((d) => d.slug === "cable")).toBeTruthy();
    expect(res.body.data.find((d) => d.kind === "part")).toBeFalsy();
    expect(res.body.total).toBe(1);
  });

  // CATALOG_CLEANUP_TASK.md Phase D fix: parts used to be unioned in
  // regardless of category/search, polluting every filtered listing.
  it("excludes retail parts entirely once a category filter is active", async () => {
    await Product.create({
      name: "Screen Guard", slug: "screen-guard", price: 1000,
      category: "Screen Protectors", stock: 10, isActive: true,
    });
    await Product.create({
      name: "iPhone Screen Replacement", category: "Screen", partCategory: "Screen", sellOnline: true, sellInStore: true,
      stock: 3, costPrice: 100, price: 5000, useInRepairs: true});

    const res = await request(app).get("/api/v1/products?category=Screen%20Protectors&limit=50");
    expect(res.body.total).toBe(1);
    expect(res.body.data.every((d) => d.kind === "product")).toBe(true);
  });

  it("matches parts by the search query instead of including them unconditionally", async () => {
    await Product.create({
      name: "Widget", slug: "widget", price: 1000, category: "x", stock: 10, isActive: true,
    });
    await Product.create({
      name: "iPhone 12 Battery", category: "Battery", partCategory: "Battery", sellOnline: true, sellInStore: true,
      stock: 3, costPrice: 100, price: 5000, useInRepairs: true});

    const noMatch = await request(app).get("/api/v1/products?q=nonexistentxyz123");
    expect(noMatch.body.total).toBe(0);

    const match = await request(app).get("/api/v1/products?q=battery");
    expect(match.body.total).toBe(1);
    expect(match.body.data[0].kind).toBe("part");
  });
});

// ── #14: forward-only order status transitions ──
describe("PATCH /api/v1/orders/:id (status flow)", () => {
  async function makeOrder(status = "pending") {
    return Order.create({
      orderNumber: `EZW-${Date.now()}`,
      items: [{ name: "Item", price: 1000, qty: 1 }],
      subtotal: 1000, total: 1000,
      customer: { name: "A", phone: "0244000000" },
      status,
    });
  }

  it("rejects a backward transition (delivered → pending)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("delivered");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("allows a valid forward transition (pending → paid)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("pending");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("paid");
  });

  it("allows a forward skip (paid → delivered)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("paid");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "delivered" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("delivered");
  });

  it("allows cancelling a live order but not changing a cancelled one", async () => {
    const token = await makeStaff();
    const order = await makeOrder("processing");

    const cancel = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });
    expect(cancel.status).toBe(200);

    const revive = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });
    expect(revive.status).toBe(400); // cancelled is terminal
  });

  it("rejects a backward skip (shipped → paid)", async () => {
    const token = await makeStaff();
    const order = await makeOrder("shipped");

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/products?preorder=true (pre-order filter)", () => {
  it("returns only products that are pre-orderable (product or any variant)", async () => {
    await Product.create([
      // Product-level pre-order on
      {
        name: "Preorder Phone", slug: "po-phone", price: 90000, category: "Phones",
        stock: 0, isActive: true, preorder: { enabled: true, note: "ships in 3 weeks" },
      },
      // Variant-level pre-order on (one 0-stock variant while another is stocked)
      {
        name: "Variant Preorder", slug: "po-var", price: 50000, category: "Phones",
        stock: 0, isActive: true,
        variants: [
          { sku: "v1", attributes: { storage: "128GB" }, stock: 0, preorder: { enabled: true } },
          { sku: "v2", attributes: { storage: "256GB" }, stock: 3 },
        ],
      },
      // Not a pre-order (flag off)
      { name: "Plain Phone", slug: "plain", price: 10000, category: "Phones", stock: 4, isActive: true },
    ]);

    const res = await request(app).get("/api/v1/products?preorder=true&limit=50");

    expect(res.status).toBe(200);
    const names = res.body.data.map((d) => d.name).sort();
    expect(names).toEqual(["Preorder Phone", "Variant Preorder"]);
    expect(names).not.toContain("Plain Phone");
    // The projection must carry pre-order flags through to the card, or the
    // "Pre-order" badge cannot render.
    const byName = Object.fromEntries(res.body.data.map((d) => [d.name, d]));
    expect(byName["Preorder Phone"].preorder.enabled).toBe(true);
    expect(byName["Variant Preorder"].variants.some((v) => v.preorder.enabled)).toBe(true);
  });

  it("returns everything when preorder is not set", async () => {
    await Product.create({
      name: "Any Phone", slug: "any", price: 10000, category: "Phones", stock: 4, isActive: true,
    });
    const res = await request(app).get("/api/v1/products?limit=50");
    expect(res.status).toBe(200);
    expect(res.body.data.map((d) => d.name)).toContain("Any Phone");
  });
});
