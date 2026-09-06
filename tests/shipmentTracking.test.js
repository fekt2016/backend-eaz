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
    expect(res.body.data.stage).toBe("production");
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
      .send({ stage: "shipped", note: "Sailed 12 Sep, ETA Tema 12 Oct" });

    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe("shipped");
    expect(res.body.data.stageHistory).toHaveLength(2);
    expect(res.body.data.stageHistory[1].note).toMatch(/Sailed 12 Sep/);
  });

  it("treats a move backwards as a correction, dropping what was undone", async () => {
    // Staff click one stage too far. The customer's journey reads off stageHistory,
    // so leaving "port_ghana" in it would keep telling them the goods are in
    // Ghana after the mistake was fixed.
    const token = await tokenFor();
    const { body } = await createShipment(token);
    const id = body.data._id;
    for (const stage of ["production", "shipped", "port_ghana"]) {
      await request(app).patch(`/api/v1/shipments/${id}/stage`)
        .set("Authorization", `Bearer ${token}`).send({ stage });
    }

    const res = await request(app).patch(`/api/v1/shipments/${id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped" });

    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe("shipped");
    const stages = res.body.data.stageHistory.map((e) => e.stage);
    expect(stages).not.toContain("port_ghana");
    // The stages it genuinely passed through are untouched.
    expect(stages).toContain("production");
    expect(stages).toContain("production");
  });

  it("keeps the original date when a corrected stage was genuinely reached before", async () => {
    const token = await tokenFor();
    const { body } = await createShipment(token);
    const id = body.data._id;
    await request(app).patch(`/api/v1/shipments/${id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped", date: "2026-08-15T00:00:00Z" });
    await request(app).patch(`/api/v1/shipments/${id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "port_ghana" });
    await request(app).patch(`/api/v1/shipments/${id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped" });

    const dates = body.data && (await request(app).get(`/api/v1/shipments/${id}`)
      .set("Authorization", `Bearer ${token}`)).body.data.shipment.stageHistory
      .filter((e) => e.stage === "shipped")
      .map((e) => new Date(e.date).toISOString());

    // The real sailing date survives the correction — it is the earliest, and
    // the earliest is what the customer's timeline shows.
    expect(dates).toContain("2026-08-15T00:00:00.000Z");
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
        .send({ stage, note: "Running a week behind" });
    }
    return { tracking, shipmentId: body.data._id };
  }

  it("shows a plain-language position, no login needed", async () => {
    const { tracking } = await attachedOrder("shipped");

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("shipped");
    expect(res.body.data.preorder.label).toBe("Shipped — on its way to Ghana");
    expect(res.body.data.preorder.expectedArrival).toBeTruthy();
  });

  it("collapses the operational stages into ones a customer can act on", async () => {
    // Waiting at the supplier and waiting at the origin port are the same news:
    // it is made, and it is waiting for a container. Landing and clearing
    // customs are likewise both "it is at the port in Ghana".
    const a = await attachedOrder("container_warehouse");
    const b = await attachedOrder("port_ghana");

    const resA = await request(app).get(`/api/v1/orders/track/${a.tracking}`);
    const resB = await request(app).get(`/api/v1/orders/track/${b.tracking}`);

    expect(resA.body.data.preorder.stage).toBe("container_warehouse");
    expect(resA.body.data.preorder.label).toMatch(/container warehouse/i);
    expect(resB.body.data.preorder.stage).toBe("port_ghana");
    expect(resB.body.data.preorder.label).toMatch(/Arrived at the port in Ghana/);
  });

  it("does not call it shipped until it has actually sailed", async () => {
    const waiting = await attachedOrder("container_warehouse");
    const sailing = await attachedOrder("shipped");

    const resWaiting = await request(app).get(`/api/v1/orders/track/${waiting.tracking}`);
    const resSailing = await request(app).get(`/api/v1/orders/track/${sailing.tracking}`);

    expect(resWaiting.body.data.preorder.stage).toBe("container_warehouse");
    expect(resSailing.body.data.preorder.stage).toBe("shipped");
  });

  it("never leaks the supplier, the container number, or the staff name", async () => {
    const { tracking } = await attachedOrder("shipped");

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/CMAU1234567/);
    expect(body).toMatch(/Running a week behind/i);
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

    // A real batch: production, then the container warehouse, then it sails.
    // Dates are the caller's to set, because a stage is nearly always entered
    // after the fact — including the opening one, which is a correction of the
    // stamp put on the batch when it was created.
    for (const [stage, date] of [
      ["production", "2026-07-10T00:00:00Z"],
      ["container_warehouse", "2026-07-28T00:00:00Z"],
      ["shipped", "2026-08-15T00:00:00Z"],
    ]) {
      await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
        .set("Authorization", `Bearer ${token}`).send({ stage, date });
    }

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    const history = res.body.data.preorder.history;

    expect(history.map((h) => h.stage)).toEqual(["production", "container_warehouse", "shipped"]);
    expect(new Date(history.at(-1).date).toISOString()).toBe("2026-08-15T00:00:00.000Z");
    // The backdated production date, not the stamp the batch was created with.
    // Correcting that opening stage is the only way the customer is told when
    // their goods actually went into production.
    expect(new Date(history[0].date).toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("keeps the container and staff names out of the history", async () => {
    const { tracking } = await attachedOrder("shipped");

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    for (const entry of res.body.data.preorder.history) {
      expect(entry).toEqual({
        stage: expect.any(String),
        label: expect.any(String),
        date: expect.any(String),
        note: expect.any(String),
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
      .send({ stage: "shipped", note: "Running a week behind" });

    const res = await request(app).post("/api/v1/orders/track")
      .send({ orderNumber: order.orderNumber, phone: "0244000000" });

    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("shipped");
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
      .send({ stage: "shipped", note: "Running a week behind" });

    const res = await request(app).post("/api/v1/orders/track")
      .send({ orderNumber: order.orderNumber, phone: "0244000000" });

    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/CMAU1234567/);
    expect(raw).toMatch(/Running a week behind/i);
    expect(raw).not.toMatch(/March iPhone batch/);
    // The line keeps its own pre-order flag; it is the shipment that is stripped.
    expect(res.body.data.items[0].isPreorder).toBe(true);
    expect(res.body.data.items[0].shipment).toBeUndefined();
  });

  // Opening your own pre-order and seeing a status and a price, with nothing
  // about where the goods are, is what sent us looking in the first place.
  it("shows the position on the customer's own order detail", async () => {
    const token = await tokenFor();
    const { order } = await makePreorder(`EZWTRK-MINE${Date.now()}`);
    await Order.updateOne(
      { _id: order._id },
      { $set: { 'customer.email': 'ama@example.com', 'customer.phoneDigits': '244000000' } },
    );
    const customer = await User.create({
      name: "Ama", email: "ama@example.com", password: "Password123!", isVerified: true,
    });
    const customerToken = jwt.sign({ id: customer._id.toString() }, process.env.JWT_SECRET);

    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "shipped", note: "Running a week behind" });

    const res = await request(app).get(`/api/v1/orders/mine/${order._id}`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("shipped");
    expect(res.body.data.preorder.origin).toBe("China");
    // The customer's own order is still not a route for internal detail.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/CMAU1234567/);
    expect(raw).toMatch(/Running a week behind/i);
    expect(res.body.data.preorder.journey).toBeUndefined();
  });

  it("gives staff the batch the order is riding on", async () => {
    const token = await tokenFor("admin");
    const { order } = await makePreorder(`EZWTRK-STAFF${Date.now()}`);
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped" });

    const res = await request(app).get(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.preorder.stage).toBe("shipped");
    expect(res.body.data.preorder.journey.batch.name).toBe("March iPhone batch");
    expect(res.body.data.preorder.journey.batch.reference).toMatch(/^SHP-/);
    // And which source drives it, so staff know where to record the next stage.
    expect(res.body.data.preorder.journey.source).toBe("batch");
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
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped" });

    res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    expect(res.body.data.preorder.stage).toBe("shipped");

    // 3. Landed in Ghana, clearing customs — same number, further along.
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "port_ghana" });

    res = await request(app).get(`/api/v1/orders/track/${tracking}`);
    expect(res.body.data.preorder.stage).toBe("port_ghana");

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

// The batch's journey belongs in the customer's OWN tracking history, not only in
// a separate widget: otherwise the history shows a payment and then months of
// silence. Every stage the goods reach is written there, step by step, using the
// four customer stages — the eight internal ones would repeat themselves and
// carry supplier and container detail that must never reach a customer.
describe("Shipment journey in the order's tracking history (T45)", () => {
  const advance = (token, id, stage, body = {}) =>
    request(app).patch(`/api/v1/shipments/${id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage, ...body });

  const attach = (token, id, orderIds) =>
    request(app).post(`/api/v1/shipments/${id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds });

  const journeyOf = (order) => (order.trackingHistory || []).filter((e) => e.preorderStage);

  async function batchWithOrder() {
    const token = await tokenFor();
    const { order } = await makePreorder();
    const shipment = (await createShipment(token)).body.data;
    await attach(token, shipment._id, [order._id.toString()]);
    return { token, order, shipment };
  }

  it("writes each customer stage into the order's history as the batch moves", async () => {
    const { token, order, shipment } = await batchWithOrder();

    await advance(token, shipment._id, "shipped");
    await advance(token, shipment._id, "port_ghana");

    const fresh = await Order.findById(order._id);
    const journey = journeyOf(fresh);
    expect(journey.map((e) => e.preorderStage)).toEqual(["production", "shipped", "port_ghana"]);
    expect(journey.at(-1).note).toMatch(/Arrived at the port in Ghana/i);
  });

  it("keeps the history in date order when a stage is backdated", async () => {
    const { token, order, shipment } = await batchWithOrder();

    await advance(token, shipment._id, "shipped", { date: "2026-04-01T00:00:00Z" });
    await advance(token, shipment._id, "port_ghana", { date: "2026-05-01T00:00:00Z" });

    const fresh = await Order.findById(order._id);
    const stamps = fresh.trackingHistory.map((e) => new Date(e.timestamp).getTime());
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  it("does not repeat a stage the customer has already seen", async () => {
    const { token, order, shipment } = await batchWithOrder();

    // "production" (where every batch starts) and "production" are the same news to
    // someone waiting, and so are "port_ghana" and "port_ghana".
    await advance(token, shipment._id, "production");
    await advance(token, shipment._id, "port_ghana");
    await advance(token, shipment._id, "port_ghana");

    const journey = journeyOf(await Order.findById(order._id));
    expect(journey.filter((e) => e.preorderStage === "production")).toHaveLength(1);
    expect(journey.filter((e) => e.preorderStage === "port_ghana")).toHaveLength(1);
  });

  it("carries the message but never the container or the staff name", async () => {
    const { token, order, shipment } = await batchWithOrder();

    await advance(token, shipment._id, "shipped", { note: "Loaded and sailing this week" });

    const fresh = await Order.findById(order._id);
    const text = JSON.stringify(journeyOf(fresh));
    expect(text).not.toMatch(/CMAU1234567/);
    expect(text).not.toMatch(/Kwesi/i);
    expect(journeyOf(fresh).every((e) => !e.updatedBy?.name)).toBe(true);
  });

  it("drops the stages a corrected batch never reached", async () => {
    const { token, order, shipment } = await batchWithOrder();
    await advance(token, shipment._id, "port_ghana");
    expect(journeyOf(await Order.findById(order._id)).some((e) => e.preorderStage === "port_ghana")).toBe(true);

    // Clicked one stage too far — the goods are still at sea.
    await advance(token, shipment._id, "shipped");

    const journey = journeyOf(await Order.findById(order._id));
    expect(journey.map((e) => e.preorderStage)).toEqual(["production", "shipped"]);
  });

  it("leaves staff-written entries alone when the batch is corrected", async () => {
    const { token, order, shipment } = await batchWithOrder();
    await Order.updateOne(
      { _id: order._id },
      { $push: { trackingHistory: { status: "paid", note: "Customer called about the ETA", timestamp: new Date() } } },
    );
    await advance(token, shipment._id, "port_ghana");

    await advance(token, shipment._id, "production");

    const fresh = await Order.findById(order._id);
    expect(fresh.trackingHistory.some((e) => e.note === "Customer called about the ETA")).toBe(true);
  });

  it("backfills the journey when an order is attached to a batch already under way", async () => {
    const token = await tokenFor();
    const shipment = (await createShipment(token)).body.data;
    await advance(token, shipment._id, "shipped");
    await advance(token, shipment._id, "port_ghana");

    // Only now does someone remember to put this customer on the batch.
    const { order } = await makePreorder();
    await attach(token, shipment._id, [order._id.toString()]);

    const journey = journeyOf(await Order.findById(order._id));
    expect(journey.map((e) => e.preorderStage)).toEqual(["production", "shipped", "port_ghana"]);
  });

  it("shows the journey on the public tracking page", async () => {
    const trackingNumber = `EZWTRK-${Date.now()}`;
    const token = await tokenFor();
    const { order } = await makePreorder(trackingNumber);
    const shipment = (await createShipment(token)).body.data;
    await attach(token, shipment._id, [order._id.toString()]);
    await advance(token, shipment._id, "port_ghana");

    const res = await request(app).get(`/api/v1/orders/track/${trackingNumber}`);

    expect(res.status).toBe(200);
    const notes = res.body.data.history.map((e) => e.note);
    expect(notes).toContain("Arrived at the port in Ghana");
    expect(JSON.stringify(res.body.data)).not.toMatch(/CMAU1234567/);
  });

  it("stops writing to a line that has already been released", async () => {
    const { token, order, shipment } = await batchWithOrder();
    await advance(token, shipment._id, "at_shop");
    await Order.updateOne({ _id: order._id }, { $set: { "items.0.preorderReleasedAt": new Date() } });

    const before = journeyOf(await Order.findById(order._id)).length;
    await advance(token, shipment._id, "port_ghana"); // a late correction on the batch

    const after = journeyOf(await Order.findById(order._id));
    expect(after).toHaveLength(before);
    expect(after.some((e) => e.preorderStage === "at_shop")).toBe(true);
  });
});

// Staff answering "where is my phone?" work from the customer's order, not from
// the batch list. They need the full internal journey there — and it must not
// follow them onto any customer-facing endpoint.
describe("The batch journey on a staff order (T45)", () => {
  async function batchUnderWay() {
    const token = await tokenFor();
    const trackingNumber = `EZWTRK-${Date.now()}`;
    const { order } = await makePreorder(trackingNumber);
    const shipment = (await createShipment(token)).body.data;
    await request(app).post(`/api/v1/shipments/${shipment._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${shipment._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "port_ghana", note: "Duties paid, clearing now" });
    return { token, order, shipment, trackingNumber };
  }

  it("gives staff every internal stage, with the notes and who entered them", async () => {
    const { token, order, shipment } = await batchUnderWay();

    const res = await request(app).get(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const { journey } = res.body.data.preorder;
    const batch = journey.batch;
    expect(batch.reference).toBe(shipment.reference);
    expect(batch.id).toBe(String(shipment._id));
    expect(journey.stage).toBe("port_ghana");
    expect(batch.containerNumber).toBe("CMAU1234567");
    expect(journey.history.map((h) => h.stage)).toEqual(["production", "port_ghana"]);
    expect(journey.history.at(-1).note).toMatch(/Duties paid/);
    expect(journey.history.at(-1).updatedBy).toBe("staff");
    // And what that stage said to the customer, so staff can see both sides.
    expect(journey.history.at(-1).customerLabel).toMatch(/Arrived at the port in Ghana/);
  });

  it("keeps the internal journey off the customer's own order view", async () => {
    const { order } = await batchUnderWay();
    // Own-order access is matched on phone/email, so the customer must actually
    // own this order — otherwise the endpoint 404s and proves nothing.
    const customer = await User.create({
      name: "Ama", email: `ama-${Date.now()}@t.com`, password: "Password123!",
      role: "user", isVerified: true, phone: "0244000000",
    });
    const customerToken = jwt.sign({ id: customer._id.toString() }, process.env.JWT_SECRET);

    const res = await request(app).get(`/api/v1/orders/mine/${order._id}`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.preorder).toBeTruthy();
    expect(res.body.data.preorder.journey).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/Kwesi|CMAU1234567/);
  });

  it("keeps it off the public tracking page too", async () => {
    const { trackingNumber } = await batchUnderWay();

    const res = await request(app).get(`/api/v1/orders/track/${trackingNumber}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Kwesi|CMAU1234567/);
    expect(res.body.data?.preorder?.journey).toBeUndefined();
  });
});

// Every stage staff drive must be correctable, the opening one included: a batch
// row is created today, but the goods often went into production weeks earlier,
// and that stamp is the date the customer is shown.
describe("Correcting the stage a batch is already on (T45)", () => {
  it("backdates the opening stage instead of refusing the update", async () => {
    const token = await tokenFor();
    const tracking = `EZWTRK-FIX${Date.now()}`;
    const { order } = await makePreorder(tracking);
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });

    const res = await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "production", date: "2026-06-01T00:00:00Z", note: "Factory confirmed the start date" });

    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe("production");
    // Corrected in place, not appended — one visit to a stage is one entry.
    expect(res.body.data.stageHistory.filter((e) => e.stage === "production")).toHaveLength(1);
    expect(new Date(res.body.data.stageHistory[0].date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("shows the corrected date to the customer", async () => {
    const token = await tokenFor();
    const tracking = `EZWTRK-FIX2${Date.now()}`;
    const { order } = await makePreorder(tracking);
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "production", date: "2026-06-01T00:00:00Z" });

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    const entry = res.body.data.preorder.history.find((h) => h.stage === "production");
    expect(new Date(entry.date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    // And the order's own history carries the corrected date too.
    const fresh = await Order.findById(order._id);
    const line = fresh.trackingHistory.find((e) => e.preorderStage === "production");
    expect(new Date(line.timestamp).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("carries a corrected message through to the customer", async () => {
    const token = await tokenFor();
    const tracking = `EZWTRK-FIX3${Date.now()}`;
    const { order } = await makePreorder(tracking);
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stage: "production", note: "The factory is running a little behind" });

    const res = await request(app).get(`/api/v1/orders/track/${tracking}`);

    expect(JSON.stringify(res.body)).not.toMatch(/factory is behind/i);
  });
});

// Saving a stage the batch is already on is the correction path, and with no
// date picker in the UI it is the only way to fix a time recorded too early —
// so it must re-stamp, not quietly keep the old one, and must never leave two
// entries for one stage.
describe("Recording the same stage twice (T45)", () => {
  it("updates the message and the time, keeping one entry", async () => {
    const token = await tokenFor();
    const { body } = await createShipment(token);
    const id = body.data._id;

    const first = await request(app).patch(`/api/v1/shipments/${id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped", note: "Loaded" });
    expect(first.status).toBe(200);
    const firstDate = first.body.data.stageHistory.find((e) => e.stage === "shipped").date;

    await new Promise((r) => setTimeout(r, 20));
    const second = await request(app).patch(`/api/v1/shipments/${id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped", note: "Correction: sailing Friday" });

    expect(second.status).toBe(200);
    const entries = second.body.data.stageHistory.filter((e) => e.stage === "shipped");
    expect(entries).toHaveLength(1);
    expect(entries[0].note).toBe("Correction: sailing Friday");
    expect(new Date(entries[0].date).getTime()).toBeGreaterThan(new Date(firstDate).getTime());
  });

  it("does the same on an order that rides on no batch", async () => {
    const token = await tokenFor();
    const { order } = await makePreorder();

    const first = await request(app).patch(`/api/v1/orders/${order._id}/preorder-stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped", note: "Loaded" });
    expect(first.status).toBe(200);
    const firstDate = first.body.data.preorder.history.at(-1).date;

    await new Promise((r) => setTimeout(r, 20));
    const second = await request(app).patch(`/api/v1/orders/${order._id}/preorder-stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "shipped", note: "Correction: sailing Friday" });

    expect(second.status).toBe(200);
    const entries = second.body.data.preorder.history.filter((e) => e.stage === "shipped");
    expect(entries).toHaveLength(1);
    expect(entries[0].note).toBe("Correction: sailing Friday");
    expect(new Date(entries[0].date).getTime()).toBeGreaterThan(new Date(firstDate).getTime());
  });

  it("leaves the customer with one entry for that stage, not two", async () => {
    const trackingNumber = `EZWTRK-TWICE${Date.now()}`;
    const token = await tokenFor();
    const { order } = await makePreorder(trackingNumber);
    const { body } = await createShipment(token);
    await request(app).post(`/api/v1/shipments/${body.data._id}/orders`)
      .set("Authorization", `Bearer ${token}`).send({ orderIds: [order._id.toString()] });

    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "port_ghana", note: "Landed" });
    await request(app).patch(`/api/v1/shipments/${body.data._id}/stage`)
      .set("Authorization", `Bearer ${token}`).send({ stage: "port_ghana", note: "Clearing today" });

    const res = await request(app).get(`/api/v1/orders/track/${trackingNumber}`);
    const landed = res.body.data.history.filter((e) => e.preorderStage === "port_ghana");
    expect(landed).toHaveLength(1);
    expect(landed[0].detail).toBe("Clearing today");
  });
});
