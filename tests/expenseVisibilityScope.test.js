// T113: staff record their own spending and see only that. Admin sees their own
// plus every staff member's. Superadmin sees everything. The same scope gates
// edit and delete — an expense you cannot see is one you cannot touch, or the
// read restriction is cosmetic.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Expense = require("../models/Expense");

async function makeUser(role) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

async function expenseFor(user, description) {
  return Expense.create({
    amount: 5000, category: "tools", description, createdBy: user._id,
  });
}

const BASE = "/api/v1/pos/expenses";
const descriptions = (res) => res.body.data.map((e) => e.description).sort();

async function seedEveryone() {
  const staffA = await makeUser("staff");
  const staffB = await makeUser("staff");
  const admin = await makeUser("admin");
  const superadmin = await makeUser("superadmin");

  await expenseFor(staffA.user, "staffA tools");
  await expenseFor(staffB.user, "staffB tools");
  await expenseFor(admin.user, "admin rent");
  await expenseFor(superadmin.user, "superadmin salaries");

  return { staffA, staffB, admin, superadmin };
}

describe("GET /pos/expenses — visibility scope (T113)", () => {
  it("shows a staff member only their own", async () => {
    const { staffA } = await seedEveryone();

    const res = await request(app).get(BASE).set("Authorization", `Bearer ${staffA.token}`);

    expect(res.status).toBe(200);
    expect(descriptions(res)).toEqual(["staffA tools"]);
  });

  it("shows admin their own plus every staff member's, but not superadmin's", async () => {
    const { admin } = await seedEveryone();

    const res = await request(app).get(BASE).set("Authorization", `Bearer ${admin.token}`);

    expect(descriptions(res)).toEqual(["admin rent", "staffA tools", "staffB tools"]);
  });

  it("shows superadmin everything", async () => {
    const { superadmin } = await seedEveryone();

    const res = await request(app).get(BASE).set("Authorization", `Bearer ${superadmin.token}`);

    expect(descriptions(res)).toEqual([
      "admin rent", "staffA tools", "staffB tools", "superadmin salaries",
    ]);
  });

  it("scopes the count and the category summary too, not just the rows", async () => {
    const { staffA } = await seedEveryone();

    const res = await request(app).get(BASE).set("Authorization", `Bearer ${staffA.token}`);

    // A total covering rows the caller cannot see would leak the shop's spending.
    expect(res.body.total).toBe(1);
    expect(res.body.totalAmount).toBe(5000);
  });
});

describe("POST /pos/expenses — staff may record (T113)", () => {
  it("lets a staff member add one, stamped to them", async () => {
    const { staffA } = await makeUser("staff").then((s) => ({ staffA: s }));

    const res = await request(app).post(BASE)
      .set("Authorization", `Bearer ${staffA.token}`)
      .send({ amount: 1200, category: "transport", description: "Taxi to supplier" });

    expect(res.status).toBe(201);
    expect(String(res.body.data.createdBy._id || res.body.data.createdBy))
      .toBe(String(staffA.user._id));
  });

  it("still refuses a technician", async () => {
    const { token } = await makeUser("technician");

    const res = await request(app).post(BASE)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 1200, category: "transport", description: "Nope" });

    expect(res.status).toBe(403);
  });
});

describe("expense writes respect the same scope (T113)", () => {
  it("refuses an admin editing a superadmin's expense, and does not change it", async () => {
    const { admin, superadmin } = await seedEveryone();
    const target = await Expense.findOne({ createdBy: superadmin.user._id });

    const res = await request(app).patch(`${BASE}/${target._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ amount: 999999 });

    expect(res.status).toBe(403);
    expect((await Expense.findById(target._id)).amount).toBe(5000);
  });

  it("refuses an admin deleting a superadmin's expense, and does not delete it", async () => {
    const { admin, superadmin } = await seedEveryone();
    const target = await Expense.findOne({ createdBy: superadmin.user._id });

    const res = await request(app).delete(`${BASE}/${target._id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(403);
    expect(await Expense.findById(target._id)).not.toBeNull(); // survived
  });

  it("lets an admin edit a staff member's expense", async () => {
    const { admin, staffA } = await seedEveryone();
    const target = await Expense.findOne({ createdBy: staffA.user._id });

    const res = await request(app).patch(`${BASE}/${target._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ amount: 7500 });

    expect(res.status).toBe(200);
    expect((await Expense.findById(target._id)).amount).toBe(7500);
  });
});
