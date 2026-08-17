// Activity Log / Audit Log system.
// Verifies:
//   - Authorization is backend-enforced (admin/superadmin only; staff, customers
//     and unauthenticated callers are locked out).
//   - Key business + security events actually write records (login, failed
//     login, order status change, inventory stock adjustment).
//   - The admin read API supports pagination, filters, search, date range and
//     ascending sort.
//   - No secrets (passwords/tokens/cards) ever make it into stored records.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");
const Part = require("../models/Part");
const ActivityLog = require("../models/ActivityLog");

async function makeUser(role) {
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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

describe("GET /api/v1/activity-logs — authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/v1/activity-logs");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin roles with 403", async () => {
    for (const role of ["user", "staff", "technician"]) {
      const { token } = await makeUser(role);
      const res = await request(app)
        .get("/api/v1/activity-logs")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  });

  it("allows admin and superadmin", async () => {
    for (const role of ["admin", "superadmin"]) {
      const { token } = await makeUser(role);
      const res = await request(app)
        .get("/api/v1/activity-logs")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe("number");
    }
  });
});

describe("Events are recorded", () => {
  it("records a successful login (AUTH_LOGIN)", async () => {
    const { user } = await makeUser("admin");
    const res = await request(app).post("/api/v1/auth/login").send({
      email: user.email,
      password: "Password123!",
    });
    expect(res.status).toBe(200);

    const log = await ActivityLog.findOne({ action: "AUTH_LOGIN" }).lean();
    expect(log).toBeTruthy();
    expect(log.actorEmail).toBe(user.email);
    expect(log.actorRole).toBe("admin");
    expect(log.resourceType).toBe("AUTH");
    expect(log.status).toBe("success");
  });

  it("records a failed login (AUTH_LOGIN_FAILED) with reason, never the password", async () => {
    const { user } = await makeUser("admin");
    const res = await request(app).post("/api/v1/auth/login").send({
      email: user.email,
      password: "Wrong-Password-999",
    });
    expect(res.status).toBe(401);

    const log = await ActivityLog.findOne({ action: "AUTH_LOGIN_FAILED" }).lean();
    expect(log).toBeTruthy();
    expect(log.status).toBe("failure");
    expect(log.metadata.reason).toBe("invalid_password");
    expect(JSON.stringify(log)).not.toContain("Wrong-Password-999");
  });

  it("records an order status change (ORDER_STATUS_CHANGED) with before/after", async () => {
    const { token } = await makeUser("admin");
    const order = await Order.create({
      orderNumber: `EZW-AUDIT-${Date.now()}`,
      items: [{ name: "Screen", price: 5000, qty: 1 }],
      subtotal: 5000,
      total: 5000,
      customer: { name: "Ama", phone: "0245550000" },
      status: "pending",
    });

    const res = await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "processing" });
    expect(res.status).toBe(200);

    const log = await ActivityLog.findOne({ action: "ORDER_STATUS_CHANGED" }).lean();
    expect(log).toBeTruthy();
    expect(log.resourceId).toBe(order.orderNumber);
    expect(log.resourceType).toBe("ORDER");
    expect(log.changes).toEqual([
      { field: "status", label: "Order Status", before: "pending", after: "processing" },
    ]);
    expect(log.description).toContain("pending");
    expect(log.description).toContain("processing");
  });

  it("records an inventory stock adjustment (INVENTORY_STOCK_ADJUSTED)", async () => {
    const { token } = await makeUser("staff");
    const part = await Part.create({
      name: "Battery X",
      category: "Battery",
      quantity: 3,
      lowStockThreshold: 2,
      costPrice: 1000,
      sellingPrice: 2000,
    });

    const res = await request(app)
      .patch(`/api/v1/pos/inventory/${part._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 10 });
    expect(res.status).toBe(200);

    const log = await ActivityLog.findOne({ action: "INVENTORY_STOCK_ADJUSTED" }).lean();
    expect(log).toBeTruthy();
    expect(log.resourceType).toBe("INVENTORY");
    expect(log.changes).toContainEqual({ field: "quantity", label: "Quantity", before: "3", after: "10" });
  });
});

describe("Admin read API — pagination & filtering", () => {
  it("paginates and honours limit", async () => {
    const { token } = await makeUser("admin");
    for (let i = 0; i < 5; i += 1) {
      await ActivityLog.create({
        action: "AUTH_LOGIN", resourceType: "AUTH", description: `seed ${i}`,
      });
    }

    const res = await request(app)
      .get("/api/v1/activity-logs?limit=2&page=1")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.pages).toBe(3);
  });

  it("filters by action and role", async () => {
    const { user, token } = await makeUser("admin");
    await ActivityLog.create({ action: "AUTH_LOGIN", resourceType: "AUTH", actorRole: "admin", actorUser: user._id, description: "login" });
    await ActivityLog.create({ action: "USER_BLOCKED", resourceType: "USER", actorRole: "admin", actorUser: user._id, description: "blocked" });

    const byAction = await request(app)
      .get("/api/v1/activity-logs?action=USER_BLOCKED")
      .set("Authorization", `Bearer ${token}`);
    expect(byAction.body.data).toHaveLength(1);
    expect(byAction.body.data[0].action).toBe("USER_BLOCKED");

    const byRole = await request(app)
      .get("/api/v1/activity-logs?role=admin")
      .set("Authorization", `Bearer ${token}`);
    expect(byRole.body.total).toBe(2);
  });

  it("searches free text across descriptions", async () => {
    const { token } = await makeUser("admin");
    await ActivityLog.create({ action: "ORDER_CREATED", resourceType: "ORDER", description: "Order EZW-AUDIT-777 created by Kofi" });
    await ActivityLog.create({ action: "SALE_CREATED", resourceType: "SALE", description: "POS sale completed" });

    const res = await request(app)
      .get("/api/v1/activity-logs?q=Kofi")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].description).toContain("Kofi");
  });

  it("filters by date range (from/to, inclusive)", async () => {
    const { token } = await makeUser("admin");
    // Timestamps via raw collection so we control createdAt precisely.
    await ActivityLog.collection.insertMany([
      { action: "AUTH_LOGIN", resourceType: "AUTH", description: "today", createdAt: new Date() },
      { action: "AUTH_LOGIN", resourceType: "AUTH", description: "old", createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
    ]);

    const res = await request(app)
      .get(`/api/v1/activity-logs?from=${todayStr()}&to=${todayStr()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].description).toBe("today");
  });

  it("tolerates malformed actor/date filters without crashing", async () => {
    const { token } = await makeUser("admin");
    const res = await request(app)
      .get("/api/v1/activity-logs?actor=not-an-object-id&from=not-a-date")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("sorts oldest-first with sort=createdAt_asc", async () => {
    const { token } = await makeUser("admin");
    await ActivityLog.collection.insertMany([
      { action: "AUTH_LOGIN", resourceType: "AUTH", description: "first", createdAt: new Date(Date.now() - 5000) },
      { action: "AUTH_LOGIN", resourceType: "AUTH", description: "second", createdAt: new Date() },
    ]);

    const res = await request(app)
      .get("/api/v1/activity-logs?sort=createdAt_asc")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.data[0].description).toBe("first");
    expect(res.body.data[1].description).toBe("second");
  });
});

describe("Privacy — no secrets leak into audit records", () => {
  it("stores no password/token/card values across a realistic workflow", async () => {
    const { user, token } = await makeUser("admin");

    // Failed login (password attempt), order status change, inventory update,
    // and an admin user-role change — all logged by real endpoints.
    await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "Secret-Hunter2-42" });
    const order = await Order.create({
      orderNumber: `EZW-PRIV-${Date.now()}`,
      items: [], subtotal: 0, total: 0,
      customer: { name: "Kofi", phone: "0246000000" }, status: "pending",
    });
    await request(app)
      .patch(`/api/v1/orders/${order._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "processing" });
    const part = await Part.create({
      name: "Charging Port", category: "Charging Port", quantity: 1, lowStockThreshold: 1,
      costPrice: 500, sellingPrice: 900,
    });
    await request(app)
      .patch(`/api/v1/pos/inventory/${part._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 2 });

    const logs = await ActivityLog.find({}).lean();
    expect(logs.length).toBeGreaterThanOrEqual(3);

    const blobs = logs.map((l) => JSON.stringify({ ...l, _id: undefined }));
    for (const blob of blobs) {
      expect(blob).not.toContain("Secret-Hunter2-42");
      expect(blob).not.toContain("Password123!");
      expect(blob).not.toMatch(/"(password|token|cvv|verifyPin)"\s*:/i);
    }
  });
});
