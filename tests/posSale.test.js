// POST /api/v1/pos/sales (T30/T31): createSale runs inside a real MongoDB
// transaction (session.startTransaction()), which mongodb-memory-server's
// default standalone instance can't support ("Transaction numbers are only
// allowed on a replica set member or mongos"). This file spins up its own
// single-node MongoMemoryReplSet instead of the shared tests/setup.js
// standalone instance — scoped to this file only, the other test files are
// unaffected and keep the fast standalone setup.
//
// T30's actual bug: `const [sale] = await Sale.create([{...}], { session })`
// destructures the single created doc into `sale`, but the post-commit
// logFromRequest call referenced `sale[0].saleNumber` etc. — `sale[0]` is
// undefined on a plain object, so it threw *after* the transaction had
// already committed (sale saved, stock deducted), producing a 500 with the
// sale silently persisted. Worse: the catch block's unconditional
// `session.abortTransaction()` then threw a second, unhandled
// MongoTransactionError ("Cannot call abortTransaction after calling
// commitTransaction") — and server.js treats unhandled rejections as fatal
// (process.exit(1)), so this bug crashed the whole server, not just the request.
//
// Also found and fixed while hardening this: createSale/voidSale used raw
// session.startTransaction()/commitTransaction() with no retry, so MongoDB's
// default 5ms maxTransactionLockRequestTimeoutMillis (an intentionally
// aggressive default — transactions are expected to retry on contention, via
// the driver's standard withTransaction() helper) meant ordinary concurrent
// writes to the same part/product could 500 a legitimate sale in production,
// not just in this test's rapid-fire loop. Both now use
// session.withTransaction(), which retries automatically on
// TransientTransactionError-labeled errors — confirmed by removing every
// test-side workaround for the flakiness this exposed and rerunning this
// file 15 times back to back with zero failures.
//
// T31: the same createSale path also handles shop products (`productId`),
// not just repair parts — verified here with a mixed cart.
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const MONGOD_VERSION = process.env.MONGOMS_VERSION || "7.0.14";

let replSet;

beforeAll(async () => {
  // The shared tests/setup.js already connected mongoose to a standalone
  // instance for this test file's module registry — disconnect and reconnect
  // to a transaction-capable replica set instead, for this file only.
  await mongoose.disconnect();
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: MONGOD_VERSION },
  });
  await mongoose.connect(replSet.getUri());
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

const app = require("../app");
const User = require("../models/User");
const Part = require("../models/Part");
const Product = require("../models/Product");
const Sale = require("../models/Sale");

async function makeUser(role = "staff") {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

async function makePart(over = {}) {
  return Part.create({
    name: "Screen", sku: `SKU-${Date.now()}`, category: "Screen",
    quantity: 10, costPrice: 1000, sellingPrice: 2000,
    ...over,
  });
}

async function makeProduct(over = {}) {
  return Product.create({
    name: "Phone Case", slug: `case-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 1500, category: "accessories", stock: 10,
    ...over,
  });
}

describe("POST /api/v1/pos/sales — parts-only sale (T30 regression)", () => {
  it("completes successfully: 201, sale persisted once, stock deducted", async () => {
    const { token } = await makeUser();
    const part = await makePart();

    const res = await request(app)
      .post("/api/v1/pos/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ partId: part._id.toString(), quantity: 2 }], paymentMethod: "cash", amountPaid: 4000 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.saleNumber).toBeTruthy();
    expect(res.body.data.total).toBe(4000);

    const saleCount = await Sale.countDocuments();
    expect(saleCount).toBe(1);

    const freshPart = await Part.findById(part._id);
    expect(freshPart.quantity).toBe(8); // 10 - 2
  });

  it("rejects an underpaid cash sale without touching stock", async () => {
    const { token } = await makeUser();
    const part = await makePart();

    const res = await request(app)
      .post("/api/v1/pos/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ partId: part._id.toString(), quantity: 1 }], paymentMethod: "cash", amountPaid: 500 });

    expect(res.status).toBe(400);
    const freshPart = await Part.findById(part._id);
    expect(freshPart.quantity).toBe(10); // unchanged — transaction rolled back
  });
});

describe("POST /api/v1/pos/sales — mixed parts + products (T31 verification)", () => {
  it("completes a sale mixing a repair part and a shop product", async () => {
    const { token } = await makeUser();
    const part = await makePart();
    const product = await makeProduct();

    const res = await request(app)
      .post("/api/v1/pos/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { partId: part._id.toString(), quantity: 1 },
          { productId: product._id.toString(), quantity: 2 },
        ],
        paymentMethod: "cash",
        amountPaid: 5000, // 2000 (part) + 2*1500 (product) = 5000
      });

    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(5000);
    expect(res.body.data.items).toHaveLength(2);

    const freshPart = await Part.findById(part._id);
    expect(freshPart.quantity).toBe(9);
    const freshProduct = await Product.findById(product._id);
    expect(freshProduct.stock).toBe(8);
  });

  it("completes a products-only sale (no parts at all)", async () => {
    const { token } = await makeUser();
    const product = await makeProduct();

    const res = await request(app)
      .post("/api/v1/pos/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ productId: product._id.toString(), quantity: 3 }], paymentMethod: "cash", amountPaid: 4500 });

    expect(res.status).toBe(201);
    const freshProduct = await Product.findById(product._id);
    expect(freshProduct.stock).toBe(7);
  });

  it("rejects insufficient product stock without deducting anything", async () => {
    const { token } = await makeUser();
    const product = await makeProduct({ stock: 1 });

    const res = await request(app)
      .post("/api/v1/pos/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ productId: product._id.toString(), quantity: 5 }], paymentMethod: "cash", amountPaid: 7500 });

    expect(res.status).toBe(400);
    const freshProduct = await Product.findById(product._id);
    expect(freshProduct.stock).toBe(1); // unchanged
  });
});

describe("POST /api/v1/pos/sales — concurrent writes to the same part (withTransaction retry)", () => {
  it("completes both of two simultaneous sales against the same part, not one 500", async () => {
    const { token: token1 } = await makeUser();
    const { token: token2 } = await makeUser();
    const part = await makePart({ quantity: 10 });

    const fire = (token) =>
      request(app)
        .post("/api/v1/pos/sales")
        .set("Authorization", `Bearer ${token}`)
        .send({ items: [{ partId: part._id.toString(), quantity: 1 }], paymentMethod: "cash", amountPaid: 2000 });

    // Two requests hitting the same document at (as close to) the same
    // instant as the test can force — this is exactly the contention
    // session.withTransaction()'s automatic retry exists to absorb.
    const [res1, res2] = await Promise.all([fire(token1), fire(token2)]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const freshPart = await Part.findById(part._id);
    expect(freshPart.quantity).toBe(8); // 10 - 1 - 1, both sales landed

    const saleCount = await Sale.countDocuments();
    expect(saleCount).toBe(2);
  });
});
