// GET /api/v1/domain/my (T26): the Paystack webhook already pushes a
// { domain, years, registeredAt, expiresAt, status } entry to `User.domains`
// once Namecheap registration succeeds — nothing ever exposed it back to the
// frontend. This endpoint reads it, sorted soonest-expiring first.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");

async function makeUser(domains = []) {
  const user = await User.create({
    name: "Cust",
    email: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role: "user",
    isVerified: true,
    domains,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

describe("GET /api/v1/domain/my — registered domains (T26)", () => {
  it("returns an empty list for a user with no registered domains", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .get("/api/v1/domain/my")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns the caller's domains sorted soonest-expiring first", async () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const later = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
    const { token } = await makeUser([
      { domain: "later.com", years: 1, registeredAt: new Date(), expiresAt: later, status: "active" },
      { domain: "soon.com", years: 1, registeredAt: new Date(), expiresAt: soon, status: "active" },
    ]);

    const res = await request(app)
      .get("/api/v1/domain/my")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((d) => d.domain)).toEqual(["soon.com", "later.com"]);
  });

  it("only returns the caller's own domains, not another user's", async () => {
    await makeUser([{ domain: "other-user.com", years: 1, registeredAt: new Date(), expiresAt: new Date(), status: "active" }]);
    const { token } = await makeUser([]);

    const res = await request(app)
      .get("/api/v1/domain/my")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/domain/my");
    expect(res.status).toBe(401);
  });
});
