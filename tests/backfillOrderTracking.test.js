// Backfill for orders created before createOrder started minting a tracking
// number. Without one, every tracking link in the app stays hidden (they are all
// guarded by `order.trackingNumber && …`), so the customer cannot follow the
// delivery and staff have nothing to open to post an update.
const Order = require("../models/Order");
const { backfillOrderTrackingNumbers } = require("../scripts/backfillOrderTrackingNumbers");
const { generateTrackingNumber } = require("../utils/trackingNumber");

const quiet = () => {};

async function makeOrder(over = {}) {
  return Order.create({
    orderNumber: `EZW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    items: [{ name: "Widget", price: 1000, qty: 1 }],
    subtotal: 1000,
    total: 1000,
    customer: { name: "A", phone: "0244000000" },
    status: "pending",
    ...over,
  });
}

// Insert without the field at all, which is what the legacy orders actually look
// like — Order.create would apply schema defaults.
async function makeLegacyOrder(over = {}) {
  const order = await makeOrder(over);
  await Order.collection.updateOne({ _id: order._id }, { $unset: { trackingNumber: "" } });
  return order;
}

describe("generateTrackingNumber", () => {
  it("produces the EZWTRK- format the app renders", () => {
    // base36 timestamp (so letters run past F) followed by 6 hex characters.
    expect(generateTrackingNumber()).toMatch(/^EZWTRK-[0-9A-Z]+[0-9A-F]{6}$/);
  });

  it("does not repeat itself within the same millisecond", () => {
    const batch = new Set(Array.from({ length: 200 }, () => generateTrackingNumber()));
    expect(batch.size).toBe(200);
  });
});

describe("backfillOrderTrackingNumbers", () => {
  it("reports what it would do and writes nothing on a dry run", async () => {
    const legacy = await makeLegacyOrder({ status: "shipped" });

    const result = await backfillOrderTrackingNumbers({ log: quiet });

    expect(result).toMatchObject({ scanned: 1, updated: 0, failed: 0 });
    const fresh = await Order.findById(legacy._id);
    expect(fresh.trackingNumber).toBeFalsy();
  });

  it("assigns a number to every order missing one", async () => {
    const a = await makeLegacyOrder();
    const b = await makeLegacyOrder({ status: "shipped" });

    const result = await backfillOrderTrackingNumbers({ apply: true, log: quiet });

    expect(result).toMatchObject({ scanned: 2, updated: 2, failed: 0 });
    const [freshA, freshB] = await Promise.all([Order.findById(a._id), Order.findById(b._id)]);
    expect(freshA.trackingNumber).toMatch(/^EZWTRK-/);
    expect(freshB.trackingNumber).toMatch(/^EZWTRK-/);
    expect(freshA.trackingNumber).not.toBe(freshB.trackingNumber);
  });

  it("never touches an order that already has one", async () => {
    // These are printed on receipts and shared with customers — regenerating one
    // would strand whoever is holding the old number.
    const existing = await makeOrder({ trackingNumber: "EZWTRK-KEEPME01" });
    await makeLegacyOrder();

    await backfillOrderTrackingNumbers({ apply: true, log: quiet });

    const fresh = await Order.findById(existing._id);
    expect(fresh.trackingNumber).toBe("EZWTRK-KEEPME01");
  });

  it("is idempotent — a second run finds nothing to do", async () => {
    await makeLegacyOrder();

    const first = await backfillOrderTrackingNumbers({ apply: true, log: quiet });
    const second = await backfillOrderTrackingNumbers({ apply: true, log: quiet });

    expect(first.updated).toBe(1);
    expect(second).toMatchObject({ scanned: 0, updated: 0, failed: 0 });
  });

  it("treats an empty-string tracking number as missing", async () => {
    const blank = await makeOrder();
    await Order.collection.updateOne({ _id: blank._id }, { $set: { trackingNumber: "" } });

    const result = await backfillOrderTrackingNumbers({ apply: true, log: quiet });

    expect(result.updated).toBe(1);
    const fresh = await Order.findById(blank._id);
    expect(fresh.trackingNumber).toMatch(/^EZWTRK-/);
  });

  it("leaves a fully-numbered collection alone", async () => {
    await makeOrder({ trackingNumber: "EZWTRK-ALLSET01" });

    const result = await backfillOrderTrackingNumbers({ apply: true, log: quiet });

    expect(result).toMatchObject({ scanned: 0, updated: 0, failed: 0 });
  });
});
