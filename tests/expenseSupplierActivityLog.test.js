// expenseController (T45): supplier search escapes regex metacharacters, and
// expense/supplier create/update/delete now write activity log entries
// (previously invisible, unlike customer/inventory/job mutations).
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Expense = require("../models/Expense");
const Supplier = require("../models/Supplier");
const ActivityLog = require("../models/ActivityLog");

async function makeUser(role = "superadmin") {
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

describe("GET /api/v1/pos/suppliers — regex-safe search (T45)", () => {
  it("treats regex metacharacters in q as literal text, not a pattern", async () => {
    const { token } = await makeUser();
    await Supplier.create({ name: "Acme Parts", createdBy: (await makeUser()).user._id });

    // A bare regex metacharacter like "(" used to throw or match unintended
    // rows if treated as a live pattern instead of literal text.
    const res = await request(app)
      .get("/api/v1/pos/suppliers")
      .query({ q: "(unmatched" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("still finds a real match by name", async () => {
    const { token } = await makeUser();
    const { user: creator } = await makeUser();
    await Supplier.create({ name: "Acme Parts", createdBy: creator._id });

    const res = await request(app)
      .get("/api/v1/pos/suppliers")
      .query({ q: "Acme" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("Expense mutations write activity logs (T45)", () => {
  it("logs EXPENSE_CREATED on create", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/pos/expenses")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 5000, category: "rent", description: "Shop rent — August" });

    expect(res.status).toBe(201);
    const log = await ActivityLog.findOne({ action: "EXPENSE_CREATED" }).lean();
    expect(log).toBeTruthy();
    expect(log.resourceType).toBe("EXPENSE");
  });

  it("logs EXPENSE_UPDATED with a before/after diff on update", async () => {
    const { user, token } = await makeUser();
    const expense = await Expense.create({
      amount: 5000, category: "rent", description: "Shop rent", createdBy: user._id,
    });

    const res = await request(app)
      .patch(`/api/v1/pos/expenses/${expense._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 6000 });

    expect(res.status).toBe(200);
    const log = await ActivityLog.findOne({ action: "EXPENSE_UPDATED" }).lean();
    expect(log).toBeTruthy();
    expect(log.changes.some((c) => c.field === "amount" && c.before === "5000" && c.after === "6000")).toBe(true);
  });

  it("logs EXPENSE_DELETED on delete", async () => {
    const { user, token } = await makeUser();
    const expense = await Expense.create({
      amount: 5000, category: "rent", description: "Shop rent", createdBy: user._id,
    });

    const res = await request(app)
      .delete(`/api/v1/pos/expenses/${expense._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const log = await ActivityLog.findOne({ action: "EXPENSE_DELETED" }).lean();
    expect(log).toBeTruthy();
  });
});

describe("Supplier mutations write activity logs (T45)", () => {
  it("logs SUPPLIER_CREATED on create", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/pos/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Parts" });

    expect(res.status).toBe(201);
    const log = await ActivityLog.findOne({ action: "SUPPLIER_CREATED" }).lean();
    expect(log).toBeTruthy();
    expect(log.resourceType).toBe("SUPPLIER");
  });

  it("logs SUPPLIER_UPDATED with a before/after diff on update", async () => {
    const { user, token } = await makeUser();
    const supplier = await Supplier.create({ name: "Acme Parts", createdBy: user._id });

    const res = await request(app)
      .patch(`/api/v1/pos/suppliers/${supplier._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Parts Ltd" });

    expect(res.status).toBe(200);
    const log = await ActivityLog.findOne({ action: "SUPPLIER_UPDATED" }).lean();
    expect(log).toBeTruthy();
    expect(log.changes.some((c) => c.field === "name" && c.before === "Acme Parts" && c.after === "Acme Parts Ltd")).toBe(true);
  });

  it("logs SUPPLIER_DELETED on delete", async () => {
    const { user, token } = await makeUser();
    const supplier = await Supplier.create({ name: "Acme Parts", createdBy: user._id });

    const res = await request(app)
      .delete(`/api/v1/pos/suppliers/${supplier._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const log = await ActivityLog.findOne({ action: "SUPPLIER_DELETED" }).lean();
    expect(log).toBeTruthy();
  });
});
