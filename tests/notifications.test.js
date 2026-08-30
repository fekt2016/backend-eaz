// T12: in-app notifications — API + the two v1 triggers (job assigned to a
// technician, new shop order paid → admin/staff). Notifications are
// server-created only; there is no client-facing create endpoint.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const Order = require("../models/Order");
const Notification = require("../models/Notification");
const { fulfilShopOrder } = require("../utils/fulfilShopOrder");

async function makeUser(role = "user") {
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

async function makeCustomer() {
  const phone = `024${Math.floor(1000000 + Math.random() * 8999999)}`;
  return PosCustomer.create({ phone, name: "Cust" });
}


// notifyRoles() is deliberately fire-and-forget — utils/notifications.js
// documents it as best-effort, because failing to persist a notification must
// never break the business action that triggered it. So it is NOT awaited by
// fulfilShopOrder, and a test that queries immediately after fulfilment is
// racing it.
//
// These assertions used to pass only because the stock-decrement loop did enough
// database work to let the notification land first. T89 added an early `continue`
// for lines with no product reference — the fixture below is exactly that shape —
// which removed the incidental delay and exposed the race. Poll instead of
// assuming.
async function notificationsFor(userId, expected, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let found = await Notification.find({ recipient: userId });
  while (found.length < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    found = await Notification.find({ recipient: userId });
  }
  return found;
}

function pendingOrder(over = {}) {
  return {
    orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
    items: [{ name: "Phone case", price: 5000, qty: 1 }],
    subtotal: 5000,
    total: 5000,
    customer: { name: "Cust", phone: "0240000000" },
    status: "pending",
    paystackReference: `REF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...over,
  };
}

describe("Notification API", () => {
  it("lists only the current user's notifications, newest first", async () => {
    const { user, token } = await makeUser();
    const { user: other } = await makeUser();
    await Notification.create({ recipient: other._id, type: "x", title: "Not mine" });
    await Notification.create({ recipient: user._id, type: "x", title: "Older" });
    await Notification.create({ recipient: user._id, type: "x", title: "Newer" });

    const res = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map(n => n.title)).toEqual(["Newer", "Older"]);
  });

  it("unread-count only counts the current user's unread notifications", async () => {
    const { user, token } = await makeUser();
    await Notification.create({ recipient: user._id, type: "x", title: "A" });
    await Notification.create({ recipient: user._id, type: "x", title: "B", read: true, readAt: new Date() });

    const res = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });

  it("marks a single notification read (ownership-checked)", async () => {
    const { user, token } = await makeUser();
    const { token: otherToken } = await makeUser();
    const n = await Notification.create({ recipient: user._id, type: "x", title: "A" });

    const forbidden = await request(app)
      .patch(`/api/v1/notifications/${n._id}/read`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbidden.status).toBe(404); // not this user's — can't be found/marked

    const res = await request(app)
      .patch(`/api/v1/notifications/${n._id}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);
  });

  it("mark-all-read only touches the current user's unread notifications", async () => {
    const { user, token } = await makeUser();
    const { user: other } = await makeUser();
    await Notification.create({ recipient: user._id, type: "x", title: "A" });
    await Notification.create({ recipient: user._id, type: "x", title: "B" });
    await Notification.create({ recipient: other._id, type: "x", title: "C" });

    const res = await request(app).patch("/api/v1/notifications/read-all").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const mineUnread = await Notification.countDocuments({ recipient: user._id, read: false });
    const othersUnread = await Notification.countDocuments({ recipient: other._id, read: false });
    expect(mineUnread).toBe(0);
    expect(othersUnread).toBe(1);
  });
});

describe("T12 trigger — job assigned to technician", () => {
  it("notifies the assigned technician when a job is created", async () => {
    const { token } = await makeUser("staff");
    const { user: tech } = await makeUser("technician");
    const customer = await makeCustomer();

    const res = await request(app)
      .post("/api/v1/pos/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: customer._id, faultDescription: "Cracked screen", assignedTo: tech._id.toString() });

    expect(res.status).toBe(201);

    const notes = await Notification.find({ recipient: tech._id });
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("job_assigned");
    expect(notes[0].link).toBe(`/dashboard/pos/jobs/${res.body.data._id}`);
  });

  it("notifies the new technician on reassignment, not the original one", async () => {
    const { token } = await makeUser("staff");
    const { user: techA } = await makeUser("technician");
    const { user: techB } = await makeUser("technician");
    const customer = await makeCustomer();

    const created = await request(app)
      .post("/api/v1/pos/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: customer._id, faultDescription: "Battery issue", assignedTo: techA._id.toString() });

    await Notification.deleteMany({}); // clear the creation notification, isolate the reassignment one

    const res = await request(app)
      .patch(`/api/v1/pos/jobs/${created.body.data._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignedTo: techB._id.toString() });

    expect(res.status).toBe(200);

    const notesB = await Notification.find({ recipient: techB._id });
    const notesA = await Notification.find({ recipient: techA._id });
    expect(notesB).toHaveLength(1);
    expect(notesA).toHaveLength(0);
  });
});

describe("T12 trigger — new order paid", () => {
  it("notifies superadmin/admin/staff but not a technician or a plain customer", async () => {
    const { user: admin } = await makeUser("admin");
    const { user: staff } = await makeUser("staff");
    const { user: superadmin } = await makeUser("superadmin");
    const { user: tech } = await makeUser("technician");
    const { user: customer } = await makeUser("user");
    const order = await Order.create(pendingOrder());

    const paid = await fulfilShopOrder(order.paystackReference, { amountPesewas: order.total, currency: "GHS" });
    expect(paid).toBeTruthy();

    const [adminNotes, staffNotes, superNotes] = await Promise.all(
      [admin, staff, superadmin].map(u => notificationsFor(u._id, 1))
    );
    // These two must receive NOTHING, so there is nothing to wait for — read
    // them after the three above have landed, which bounds the wait.
    const [techNotes, custNotes] = await Promise.all(
      [tech, customer].map(u => Notification.find({ recipient: u._id }))
    );
    expect(adminNotes).toHaveLength(1);
    expect(staffNotes).toHaveLength(1);
    expect(superNotes).toHaveLength(1);
    expect(techNotes).toHaveLength(0);
    expect(custNotes).toHaveLength(0);
    expect(adminNotes[0].type).toBe("new_order");
  });

  it("does not double-notify on a duplicate fulfilment call (idempotent)", async () => {
    const { user: admin } = await makeUser("admin");
    const order = await Order.create(pendingOrder());

    await fulfilShopOrder(order.paystackReference, { amountPesewas: order.total, currency: "GHS" });
    const second = await fulfilShopOrder(order.paystackReference, { amountPesewas: order.total, currency: "GHS" }); // already paid — no-op

    expect(second).toBeNull();
    const notes = await notificationsFor(admin._id, 1);
    expect(notes).toHaveLength(1);
  });
});
