// T5 — the Expenses role model had admin missing from BOTH read and write while
// staff could read, which matched nothing else in the app. Confirmed with the
// product owner 2026-08-26: admin gets full access (read + write), staff stays
// read-only, everyone else stays out.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");

async function makeUser(role) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@t.com`,
    password: "Password123!",
    role,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const body = () => ({
  description: "Diesel for generator",
  category: "utilities",
  amount: 250,
  date: "2026-08-26",
});

describe("Expenses role model (T5)", () => {
  it("admin can read and create expenses", async () => {
    const token = await makeUser("admin");

    const created = await request(app)
      .post("/api/v1/pos/expenses")
      .set("Authorization", `Bearer ${token}`)
      .send(body());
    expect(created.status).toBe(201);

    const list = await request(app)
      .get("/api/v1/pos/expenses")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((e) => e.description === "Diesel for generator")).toBe(true);
  });

  it("staff keeps read-only access — write is still refused", async () => {
    const token = await makeUser("staff");

    const list = await request(app)
      .get("/api/v1/pos/expenses")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);

    const created = await request(app)
      .post("/api/v1/pos/expenses")
      .set("Authorization", `Bearer ${token}`)
      .send(body());
    expect(created.status).toBe(403);
  });

  it.each(["user", "technician"])("%s is refused on read and write", async (role) => {
    const token = await makeUser(role);

    const list = await request(app)
      .get("/api/v1/pos/expenses")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(403);

    const created = await request(app)
      .post("/api/v1/pos/expenses")
      .set("Authorization", `Bearer ${token}`)
      .send(body());
    expect(created.status).toBe(403);
  });
});
