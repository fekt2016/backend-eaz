// Admin user-detail page: a customer's orders and saved addresses.
//
// Two things these pin down:
//  1. Orders are GUEST checkouts with no `user` ref (T84), so they are matched
//     by the contact details captured at checkout. The admin view must use the
//     SAME rule as getMyOrders — if the two drift, an admin sees a different
//     set of orders than the customer sees for themselves, and nothing says
//     which is right. Both now go through utils/customerOrderMatch.
//  2. Reading a CUSTOMER's addresses lives on /admin, not on /addresses. That
//     router denies every staff-side role because a personal address book has
//     no meaning on a staff account — a different question with a different
//     answer.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");
const Address = require("../models/Address");

const BASE = "/api/v1";

async function makeUser(role, extra = {}) {
  const user = await User.create({
    name: `${role}-person`,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role, isVerified: true, ...extra,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}
const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

async function makeOrder(customer, n) {
  return Order.create({
    orderNumber: `ORD-${n}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    items: [{ product: "6a9377b3e842391fcae57fb7", name: "Thing", price: 1000, qty: 1 }],
    subtotal: 1000, total: 1000,
    customer,
    paystackReference: `ref_${Math.random().toString(36).slice(2)}`,
  });
}

describe("GET /admin/users/:id/orders", () => {
  it("finds guest orders by the customer's email", async () => {
    const admin = await makeUser("admin");
    const { user } = await makeUser("user");
    await makeOrder({ name: "A", phone: "0241234567", email: user.email }, 1);
    await makeOrder({ name: "B", phone: "0209999999", email: "someone-else@eaz.test" }, 2);

    const res = await auth(request(app).get(`${BASE}/admin/users/${user._id}/orders`), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.orders).toHaveLength(1);
    expect(res.body.data.orders[0].orderNumber).toMatch(/^ORD-1-/);
  });

  it("finds guest orders by normalized phone as well as email", async () => {
    const admin = await makeUser("admin");
    const { user } = await makeUser("user", { phone: "0241234567" });
    // No email match — only the phone links this one.
    await makeOrder({ name: "A", phone: "+233241234567", phoneDigits: "0241234567", email: "other@eaz.test" }, 3);

    const res = await auth(request(app).get(`${BASE}/admin/users/${user._id}/orders`), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
  });

  it("returns nothing — never every order — when the user has no contact details", async () => {
    const admin = await makeUser("admin");
    // A user with no phone; strip the email so there is nothing to match on.
    const { user } = await makeUser("user");
    await User.findByIdAndUpdate(user._id, { $unset: { email: 1 } });
    await makeOrder({ name: "A", phone: "0209999999", email: "unrelated@eaz.test" }, 4);

    const res = await auth(request(app).get(`${BASE}/admin/users/${user._id}/orders`), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.orders).toEqual([]);
  });

  it("paginates rather than returning an unbounded list", async () => {
    const admin = await makeUser("admin");
    const { user } = await makeUser("user");
    for (let i = 0; i < 12; i++) await makeOrder({ name: "A", phone: "0241234567", email: user.email }, i);

    const res = await auth(request(app).get(`${BASE}/admin/users/${user._id}/orders?limit=5`), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.data.orders).toHaveLength(5);
    expect(res.body.data.total).toBe(12);
  });

  it.each(["user", "staff", "technician"])("refuses role %s", async (role) => {
    const caller = await makeUser(role);
    const { user } = await makeUser("user");
    const res = await auth(request(app).get(`${BASE}/admin/users/${user._id}/orders`), caller.token);
    expect(res.status).toBe(403);
  });

  it("404s for an unknown user", async () => {
    const admin = await makeUser("admin");
    const res = await auth(request(app).get(`${BASE}/admin/users/6a9377b3e842391fcae57fb7/orders`), admin.token);
    expect(res.status).toBe(404);
  });
});

describe("GET /admin/users/:id/addresses", () => {
  it("returns the customer's addresses, default first", async () => {
    const admin = await makeUser("admin");
    const { user } = await makeUser("user");
    await Address.create({
      user: user._id, label: "Work", fullName: "Ama", phone: "0241234567",
      region: "Greater Accra", city: "Accra", neighborhood: "Osu", street: "1 Rd", isDefault: false,
    });
    await Address.create({
      user: user._id, label: "Home", fullName: "Ama", phone: "0241234567",
      region: "Greater Accra", city: "Accra", neighborhood: "East Legon", street: "2 Rd", isDefault: true,
    });

    const res = await auth(request(app).get(`${BASE}/admin/users/${user._id}/addresses`), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].label).toBe("Home"); // default first
  });

  it("returns only that user's addresses", async () => {
    const admin = await makeUser("admin");
    const a = await makeUser("user");
    const b = await makeUser("user");
    await Address.create({
      user: b.user._id, label: "Theirs", fullName: "Kofi", phone: "0209999999",
      region: "Greater Accra", city: "Accra", neighborhood: "Osu", street: "9 Rd",
    });

    const res = await auth(request(app).get(`${BASE}/admin/users/${a.user._id}/addresses`), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it.each(["user", "staff", "technician"])("refuses role %s", async (role) => {
    const caller = await makeUser(role);
    const { user } = await makeUser("user");
    const res = await auth(request(app).get(`${BASE}/admin/users/${user._id}/addresses`), caller.token);
    expect(res.status).toBe(403);
  });
});
