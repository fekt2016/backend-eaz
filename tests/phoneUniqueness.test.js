// Phone uniqueness (task T1).
// Verifies:
//   - Registration rejects a phone already in use (incl. cross-format: 0XXXXXXXXX
//     vs +233XXXXXXXXX), with 409.
//   - Accounts with no phone are unaffected (many can coexist).
//   - Admin create/update enforce the same rule (update excludes the user's own record).
//   - Login by phone is deterministic (any format resolves to the one account).
//   - The partial-unique index is the DB-level race backstop (11000 on duplicate).
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");

function tokenFor(user) {
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

let seq = 0;
async function makeUser({ role = "user", phone, email } = {}) {
  seq += 1;
  return User.create({
    name: role,
    email: email || `${role}-${Date.now()}-${seq}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
    ...(phone ? { phone } : {}),
  });
}

beforeAll(async () => {
  // Build the partial-unique phone index in the in-memory DB so the DB-level
  // backstop test is meaningful (indexes survive the per-test document wipe).
  await User.syncIndexes();
});

describe("Phone uniqueness (T1) — registration guard", () => {
  it("blocks a second registration that reuses a phone (cross-format) with 409", async () => {
    const first = await request(app).post("/api/v1/auth/register").send({
      name: "A", email: "a@t.com", phone: "0201234567", password: "Password123!",
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/v1/auth/register").send({
      name: "B", email: "b@t.com", phone: "+233201234567", password: "Password123!",
    });
    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.error).toMatch(/phone/i);
  });

  it("allows multiple accounts with no phone", async () => {
    await makeUser({}); // no phone
    await makeUser({}); // no phone
    expect(await User.countDocuments({})).toBe(2);
  });
});

describe("Phone uniqueness (T1) — admin guards", () => {
  it("rejects adminUpdateUser setting a phone owned by another account (409)", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeUser({ phone: "0201112222" }); // current owner
    const target = await makeUser({}); // no phone yet

    const res = await request(app)
      .patch(`/api/v1/auth/users/${target._id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ phone: "+233201112222" }); // same number, different format

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/phone/i);
  });

  it("allows adminUpdateUser to keep the user's own phone (no false conflict, 200)", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser({ phone: "0203334444" });

    const res = await request(app)
      .patch(`/api/v1/auth/users/${target._id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ phone: "0203334444" });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe("0203334444");
  });

  it("rejects adminCreateUser with an already-used phone (409)", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeUser({ phone: "0209998888" });

    const res = await request(app)
      .post("/api/v1/auth/users")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ name: "New", email: "new@t.com", phone: "0209998888", password: "Password123!", role: "staff" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/phone/i);
  });
});

describe("Phone uniqueness (T1) — login determinism & index", () => {
  it("logs in by phone in any format and returns the single matching account", async () => {
    await makeUser({ phone: "0207654321", email: "login@t.com" });

    const res = await request(app).post("/api/v1/auth/login").send({
      phone: "+233207654321", password: "Password123!",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("login@t.com");
  });

  it("DB-level unique index rejects a duplicate phone (race backstop)", async () => {
    await makeUser({ phone: "0201230000" });
    await expect(makeUser({ phone: "0201230000" })).rejects.toMatchObject({ code: 11000 });
  });
});
