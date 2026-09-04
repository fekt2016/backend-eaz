// T45 shipment tracking: pre-ordered goods come in as a batch — typically a
// container from China carrying many customers' items — so the journey is tracked
// on the SHIPMENT and every attached pre-order line follows from one update.
//
// The other half of this is what the customer is allowed to see: their public
// tracking page shows a simplified position and never the supplier, the container
// number, or a staff note.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");
const Product = require("../models/Product");

async function tokenFor(role = "staff") {
  const user = await User.create({
    name: role, email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!", role, isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function makePreorder(trackingNumber = `EZWTRK-${Date.now()}`) {
  const product = await Product.create({
    name: "Imported Phone", slug: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 500000, category: "Phones", stock: 0, preorder: { enabled: true },
  });
  const order = await Order.create({
    orderNumber: `EZW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    items: [{ product: product._id, name: product.name, price: 500000, qty: 1, isPreorder: true }],
    subtotal: 500000, total: 500000,
    customer: { name: "Ama", phone: "0244000000" },
    status: "paid", trackingNumber,
  });
  return { product, order };
}

const createShipment = (token, body = {}) =>
  request(app).post("/api/v1/shipments").set("Authorization", `Bearer ${token}`)
    .send({ name: "March iPhone batch", containerNumber: "CMAU1234567", ...body });

describe("Shipments (T45 tracking)", () => {
  it("creates a batch with a readable reference and an opening stage", async () => {
    const token = await tokenFor();

    const res = await createShipment(token);

    expect(res.status).toBe(201);
    expect(res.body.data.reference).toMatch(/^SHP-\d{6}-\d{5}$/);
    expect(res.body.data.stage).toBe("ordered");
    expect(res.body.data.stageHistory).toHaveLength(1);
  });

  it("gives concurrent batches distinct references", async () => {
    // Same atomic counter as sale numbers (T47) — a count would collide here too.
    const token = await tokenFor();
    const made = await Promise.all([1, 2, 3, 4].map(() => createShipment(token)));
    const refs = made.map((r) => r.body.data?.reference);
    expect(new Set(refs).size).toBe(4);
  });

  it("moves through stages, keeping the history and who entered it", async () => {
    const token = await tokenFor();
    const { body } = await createShipment(token);

    const res = await request(app)
      .patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "in_transit", note: "Sailed 12 Sep, ETA Tema 12 Oct" });

    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe("in_transit");
    expect(res.body.data.stageHistory).toHaveLength(2);
    expect(res.body.data.stageHistory[1].note).toMatch(/Sailed 12 Sep/);
  });

  it("refuses a stage it does not recognise", async () => {
    const token = await tokenFor();
    const { body } = await createShipment(token);

    const res = await request(app)
      .patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "somewhere_at_sea" });

    expect(res.status).toBe(400);
  });

  it("attaches waiting pre-order lines, and counts them on the list", async () => {
    const token = await tokenFor();
    const { body } = await createShipment(token);
    const { order } = await makePreorder();

    const attach = await request(app)
      .post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderIds: [order._id.toString()] });

    expect(attach.status).toBe(200);
    expect(attach.body.data.attached).toBe(1);

    const list = await request(app).get("/api/v1/shipments").set("Authorization", `Bearer ${token}`);
    expect(list.body.data[0].waitingLines).toBe(1);
  });

  it("will not attach a line that has already been handed over", async () => {
    // Telling a customer their delivered order is still at sea would be worse
    // than telling them nothing.
    const token = await tokenFor();
    const { body } = await createShipment(token);
    const { order } = await makePreorder();
    await Order.updateOne(
      { _id: order._id },
      { $set: { "items.0.preorderReleasedAt": new Date() } },
    );

    const res = await request(app)
      .post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderIds: [order._id.toString()] });

    expect(res.body.data.attached).toBe(0);
  });

  it("is closed to customers", async () => {
    const token = await tokenFor("user");
    const res = await request(app).get("/api/v1/shipments").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("What the customer sees on their tracking page (T45)", () => {
  async function attachedOrder(stage) {
    const token = await tokenFor();
    const tracking = `EZWTRK-CUST${Date.now()}`;
    const { order } = await makePreorder(tracking);
    const { body } = await createShipment(token, { expectedArrival: "2026-10-12T00:00:00Z" });
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    if (stage) {
      await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
        .set("Authorization", `Bearer ${token}`)
        .send({ stage, note: "Internal: supplier delayed us a week" });
    }
    return { tracking, shipmentId: body.data._id };
  }

  it("shows a plain-language position, no login needed", async () => {
    const { tracking } = await attachedOrder("in_transit");

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("on_the_way");
    expect(res.body.data.preorder.label).toBe("On its way");
    expect(res.body.data.preorder.expectedArrival).toBeTruthy();
  });

  it("collapses the operational stages into ones a customer can act on", async () => {
    // "At origin port" and "in transit" are the same news to someone waiting.
    const a = await attachedOrder("at_port_origin");
    const b = await attachedOrder("customs");

    const resA = await request(app).get(`/api/v1/orders/track/${a.tracking}`);
    const resB = await request(app).get(`/api/v1/orders/track/${b.tracking}`);

    expect(resA.body.data.preorder.stage).toBe("on_the_way");
    expect(resB.body.data.preorder.stage).toBe("in_ghana");
    expect(resB.body.data.preorder.label).toMatch(/Arrived in Ghana/);
  });

  it("never leaks the supplier, the container number, or a staff note", async () => {
    const { tracking } = await attachedOrder("in_transit");

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/CMAU1234567/);
    expect(body).not.toMatch(/supplier delayed/i);
    expect(body).not.toMatch(/March iPhone batch/);
  });

  it("says something honest before a shipment is attached", async () => {
    const tracking = `EZWTRK-NOSHIP${Date.now()}`;
    await makePreorder(tracking);

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    expect(res.body.data.preorder.label).toMatch(/awaiting shipment/i);
    expect(res.body.data.preorder.stage).toBeNull();
  });

  it("names the origin so the customer knows the goods are still abroad", async () => {
    const { tracking } = await attachedOrder("production");

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    expect(res.body.data.preorder.origin).toBe("China");
  });

  it("says China even before a batch exists to say it", async () => {
    // Someone who has just paid for goods being made abroad should not read
    // "awaiting shipment" and assume we are sitting on their item.
    const tracking = `EZWTRK-ORIGIN${Date.now()}`;
    await makePreorder(tracking);

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    expect(res.body.data.preorder.origin).toBe("China");
    expect(res.body.data.preorder.history).toEqual([]);
  });

  it("gives the journey so far with a date against each stage", async () => {
    const token = await tokenFor();
    const tracking = `EZWTRK-HIST${Date.now()}`;
    const { order } = await makePreorder(tracking);
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });

    // A real batch: three supplier stages, then it sails. Dates are the caller's
    // to set, because a stage is often entered after the fact.
    for (const [stage, date] of [
      ["production", "2026-07-10T00:00:00Z"],
      ["ready_supplier", "2026-07-28T00:00:00Z"],
      ["in_transit", "2026-08-15T00:00:00Z"],
    ]) {
      await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
        .set("Authorization", `Bearer ${token}`).send({ stage, date });
    }

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    const history = res.body.data.preorder.history;

    // Four staff stages, but only two customer ones: "ordered", "production" and
    // "ready_supplier" all mean "preparing".
    expect(history.map((h) => h.stage)).toEqual(["preparing", "on_the_way"]);
    expect(new Date(history[1].date).toISOString()).toBe("2026-08-15T00:00:00.000Z");
    // The EARLIEST of the three, not the first recorded. "ordered" is stamped
    // when the batch row is created, which is often after the supplier actually
    // started — here that stamp is today, later than the backdated sailing date.
    // Taking the minimum is what keeps the timeline from reading out of order.
    expect(new Date(history[0].date).toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("keeps internal notes and staff names out of the history", async () => {
    const { tracking } = await attachedOrder("in_transit");

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    for (const entry of res.body.data.preorder.history) {
      expect(entry).toEqual({
        stage: expect.any(String),
        label: expect.any(String),
        date: expect.any(String),
      });
    }
  });

  // The order-number-and-phone lookup is the tracking page reached from the site.
  // It is a different endpoint from the tracking-number page, and it used to
  // return a bare "Paid" for goods that were still being made in China.
  it("shows the pre-order position on the order-number lookup too", async () => {
    const token = await tokenFor();
    const tracking = `EZWTRK-LOOKUP${Date.now()}`;
    const { order } = await makePreorder(tracking);
    const { body } = await createShipment(token, { expectedArrival: "2026-10-12T00:00:00Z" });
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "in_transit", note: "Internal: supplier delayed us a week" });

    const res = await request(app).post("/api/v1/orders/track")
      .send({ orderNumber: order.orderNumber, phone: "0244000000" });

    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("on_the_way");
    expect(res.body.data.preorder.origin).toBe("China");
    expect(res.body.data.preorder.history.length).toBeGreaterThan(0);
  });

  // This endpoint returns the whole order, so populating the shipment to derive
  // the position would have carried the container number and the staff note out
  // with it. Only the derived block may cross.
  it("never leaks the shipment behind that lookup", async () => {
    const token = await tokenFor();
    const { order } = await makePreorder(`EZWTRK-LEAK${Date.now()}`);
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "in_transit", note: "Internal: supplier delayed us a week" });

    const res = await request(app).post("/api/v1/orders/track")
      .send({ orderNumber: order.orderNumber, phone: "0244000000" });

    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/CMAU1234567/);
    expect(raw).not.toMatch(/supplier delayed/i);
    expect(raw).not.toMatch(/March iPhone batch/);
    // The line keeps its own pre-order flag; it is the shipment that is stripped.
    expect(res.body.data.items[0].isPreorder).toBe(true);
    expect(res.body.data.items[0].shipment).toBeUndefined();
  });

  it("leaves an ordinary order's lookup untouched", async () => {
    const orderNumber = `EZW-${Date.now()}-plainlookup`;
    await Order.create({
      orderNumber,
      items: [{ name: "Case", price: 5000, qty: 1 }],
      subtotal: 5000, total: 5000,
      customer: { name: "Kofi", phone: "0244000002" },
      status: "paid",
    });

    const res = await request(app).post("/api/v1/orders/track")
      .send({ orderNumber, phone: "0244000002" });

    expect(res.status).toBe(200);
    expect(res.body.data.preorder).toBeNull();
    expect(res.body.data.items[0].name).toBe("Case");
  });

  it("leaves an ordinary order's tracking exactly as it was", async () => {
    const tracking = `EZWTRK-PLAIN${Date.now()}`;
    await Order.create({
      orderNumber: `EZW-${Date.now()}-plain`,
      items: [{ name: "Case", price: 5000, qty: 1 }],
      subtotal: 5000, total: 5000,
      customer: { name: "Kofi", phone: "0244000001" },
      status: "paid", trackingNumber: tracking,
    });

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    expect(res.status).toBe(200);
    expect(res.body.data.preorder).toBeNull();
  });
});

// The customer's whole journey hangs off ONE number, issued when they check out and
// never reissued: while the goods are in China it shows the shipment's position, and
// once they land and the pre-order is released the same number carries the ordinary
// delivery timeline. This is the thing that makes the tracking number worth giving
// them at payment time.
describe("One tracking number, start to finish (T45)", () => {
  it("carries a pre-order from checkout in China through to delivery in Ghana", async () => {
    const token = await tokenFor();
    const tracking = `EZWTRK-JOURNEY${Date.now()}`;
    const { product, order } = await makePreorder(tracking);

    // 1. Straight after checkout — the number already works, before any shipment.
    let res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    expect(res.status).toBe(200);
    expect(res.body.data.preorder.label).toMatch(/awaiting shipment/i);

    // 2. Attached to a batch and sailing.
    const { body } = await createShipment(token, { expectedArrival: "2026-10-12T00:00:00Z" });
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "in_transit" });

    res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    expect(res.body.data.preorder.stage).toBe("on_the_way");

    // 3. Landed in Ghana, clearing customs — same number, further along.
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "arrived_port" });

    res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    expect(res.body.data.preorder.stage).toBe("in_ghana");

    // 4. Received and released to the customer. The pre-order block retires and the
    //    order's own delivery timeline takes over — on the SAME tracking number.
    await Product.updateOne({ _id: product._id }, { $set: { stock: 5 } });
    const release = await request(app)
      .patch(`/api/v1/orders/${order._id}/preorder-release`)
      .set("Authorization", `Bearer ${token}`);
    expect(release.status).toBe(200);

    res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    expect(res.body.data.trackingNumber).toBe(tracking.toUpperCase());
    expect(res.body.data.preorder).toBeNull();
    expect(res.body.data.latestEvent.note).toMatch(/Pre-order released/i);
  });

  it("never reissues the number along the way", async () => {
    const tracking = `EZWTRK-STABLE${Date.now()}`;
    const { order } = await makePreorder(tracking);
    const before = (await Order.findById(order._id)).trackingNumber;

    const token = await tokenFor();
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "at_shop" });

    expect((await Order.findById(order._id)).trackingNumber).toBe(before);
  });
});
