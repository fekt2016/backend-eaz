// T80q — the bus-station pickup lifecycle: shipped → ready for pickup →
// collected, and what the customer sees at each step.
//
// T80 E2 deliberately reuses the existing `shipped` / `delivered` status values
// rather than adding enum members, so reports and forward-only transitions keep
// working. The pickup meaning is carried by two timestamps instead:
//
//   shipped   → readyForPickupAt  (the parcel reached the chosen station)
//   delivered → pickedUpAt        (the customer collected it)
//
// That reuse is exactly why this needs testing: nothing in the status value
// itself says "pickup", so if the timestamp branch stops firing, a pickup order
// looks identical to a delivered one and the tracking page tells the customer
// their parcel is on its way to an address they never gave.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");
const PickupLocation = require("../models/PickupLocation");
const { generateTrackingNumber } = require("../utils/trackingNumber");

const BASE = "/api/v1";

async function staffToken(role = "admin") {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await User.create({
    name: `${role}-${suffix}`,
    email: `${role}-${suffix}@eaz.test`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function makePickupOrder(over = {}) {
  const station = await PickupLocation.create({
    name: "Kumasi VIP Station",
    kind: "bus_station",
    region: "Ashanti",
    city: "Kumasi",
    address: "Kejetia Terminal",
  });
  const order = await Order.create({
    orderNumber: `EZW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    trackingNumber: generateTrackingNumber(),
    items: [{ name: "Widget", price: 1000, qty: 1 }],
    subtotal: 1000,
    total: 1000,
    customer: { name: "Ama", phone: "0244000000" },
    status: "paid",
    shippingMethod: "bus_station_pickup",
    shippingRegion: "Ashanti",
    pickupLocationId: station._id,
    pickupLocationName: station.name,
    ...over,
  });
  return { order, station };
}

async function makeDeliveryOrder(over = {}) {
  return Order.create({
    orderNumber: `EZW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    trackingNumber: generateTrackingNumber(),
    items: [{ name: "Widget", price: 1000, qty: 1 }],
    subtotal: 1000,
    total: 1000,
    customer: { name: "Kofi", phone: "0244000001" },
    status: "paid",
    shippingMethod: "in_house_delivery",
    ...over,
  });
}

async function setStatus(id, status, token) {
  return request(app)
    .patch(`${BASE}/orders/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status });
}

describe("bus-station pickup — ready-for-pickup → collected", () => {
  let token;
  beforeEach(async () => {
    token = await staffToken("admin");
  });

  it("stamps readyForPickupAt when the parcel reaches the station", async () => {
    const { order } = await makePickupOrder();
    expect(order.readyForPickupAt).toBeFalsy();

    const res = await setStatus(order._id, "shipped", token);

    expect(res.status).toBe(200);
    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe("shipped");
    expect(fresh.readyForPickupAt).toBeInstanceOf(Date);
    // Not collected yet — the two markers must not move together.
    expect(fresh.pickedUpAt).toBeFalsy();
  });

  it("stamps pickedUpAt when the customer collects", async () => {
    const { order } = await makePickupOrder();
    await setStatus(order._id, "shipped", token);
    await setStatus(order._id, "delivered", token);

    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe("delivered");
    expect(fresh.readyForPickupAt).toBeInstanceOf(Date);
    expect(fresh.pickedUpAt).toBeInstanceOf(Date);
  });

  it("does not move readyForPickupAt if the status is set to shipped twice", async () => {
    const { order } = await makePickupOrder();
    await setStatus(order._id, "shipped", token);
    const first = (await Order.findById(order._id)).readyForPickupAt;

    await setStatus(order._id, "shipped", token);

    // `!order.readyForPickupAt` guards the write: the customer was told the
    // parcel arrived at a particular time, and a staff re-save must not
    // rewrite that history.
    expect((await Order.findById(order._id)).readyForPickupAt).toEqual(first);
  });

  it("leaves both markers untouched on a home-delivery order", async () => {
    const order = await makeDeliveryOrder();

    await setStatus(order._id, "shipped", token);
    await setStatus(order._id, "delivered", token);

    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe("delivered");
    expect(fresh.readyForPickupAt).toBeFalsy();
    expect(fresh.pickedUpAt).toBeFalsy();
  });
});

describe("the same markers fire on the tracking-event door", () => {
  // POST /:id/tracking is a second way to move status, and it carries its own
  // copy of the pickup branch. A fix applied to only one door is the failure
  // this covers.
  it("POST /orders/:id/tracking stamps the pickup markers too", async () => {
    const token = await staffToken("staff");
    const { order } = await makePickupOrder();

    await request(app)
      .post(`${BASE}/orders/${order._id}/tracking`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "shipped", note: "Dropped at Kejetia", location: "Kumasi" });

    const afterShip = await Order.findById(order._id);
    expect(afterShip.readyForPickupAt).toBeInstanceOf(Date);

    await request(app)
      .post(`${BASE}/orders/${order._id}/tracking`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "delivered", note: "Collected by customer" });

    expect((await Order.findById(order._id)).pickedUpAt).toBeInstanceOf(Date);
  });
});

describe("public tracking shows the pickup, and only for pickup orders", () => {
  it("exposes the station and both timestamps", async () => {
    const token = await staffToken("admin");
    const { order } = await makePickupOrder();
    await setStatus(order._id, "shipped", token);

    const res = await request(app).get(`${BASE}/orders/track/${order.trackingNumber}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pickup).not.toBeNull();
    expect(res.body.data.pickup.name).toBe("Kumasi VIP Station");
    expect(res.body.data.pickup.region).toBe("Ashanti");
    expect(res.body.data.pickup.readyForPickupAt).toBeTruthy();
    expect(res.body.data.pickup.pickedUpAt).toBeNull();
  });

  it("never leaks the station's street address on the public endpoint", async () => {
    const { order } = await makePickupOrder();

    const res = await request(app).get(`${BASE}/orders/track/${order.trackingNumber}`);

    // Live address lookup is admin-only — the public door returns null even
    // though the PickupLocation row has "Kejetia Terminal" on it.
    expect(res.body.data.pickup.address).toBeNull();
    expect(JSON.stringify(res.body.data)).not.toContain("Kejetia");
  });

  it("returns pickup: null for a home-delivery order, so existing clients are unaffected", async () => {
    const order = await makeDeliveryOrder();

    const res = await request(app).get(`${BASE}/orders/track/${order.trackingNumber}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pickup).toBeNull();
  });
});
