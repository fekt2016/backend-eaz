// GET /api/v1/auth/users/:id — added for the admin user-detail page.
//
// The list endpoint returns every user, so the page COULD have filtered
// client-side. Fetching one user by id is what makes a bookmarked or refreshed
// /dashboard/users/:id work without having come through the list.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");

const BASE = "/api/v1";

async function makeUser(role, extra = {}) {
  const user = await User.create({
    name: `${role}-person`,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role,
    isVerified: true,
    ...extra,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

describe("GET /auth/users/:id (admin user detail)", () => {
  it("returns the requested user to an admin", async () => {
    const admin = await makeUser("admin");
    const target = await makeUser("user", { phone: "0241234567" });

    const res = await auth(request(app).get(`${BASE}/auth/users/${target.user._id}`), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe(String(target.user._id));
    expect(res.body.data.email).toBe(target.user.email);
    expect(res.body.data.role).toBe("user");
  });

  it("never returns the password hash", async () => {
    const admin = await makeUser("admin");
    const target = await makeUser("user");

    const res = await auth(request(app).get(`${BASE}/auth/users/${target.user._id}`), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
  });

  it("is reachable by superadmin too — they manage users", async () => {
    const su = await makeUser("superadmin");
    const target = await makeUser("user");

    const res = await auth(request(app).get(`${BASE}/auth/users/${target.user._id}`), su.token);
    expect(res.status).toBe(200);
  });

  it.each(["user", "staff", "technician"])("refuses role %s", async (role) => {
    const caller = await makeUser(role);
    const target = await makeUser("user");

    const res = await auth(request(app).get(`${BASE}/auth/users/${target.user._id}`), caller.token);
    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated request", async () => {
    const target = await makeUser("user");
    const res = await request(app).get(`${BASE}/auth/users/${target.user._id}`);
    expect(res.status).toBe(401);
  });

  it("404s for a user that does not exist", async () => {
    const admin = await makeUser("admin");
    const res = await auth(request(app).get(`${BASE}/auth/users/6a9377b3e842391fcae57fb7`), admin.token);
    expect(res.status).toBe(404);
  });

  // A malformed id must not surface as a 500 — Mongoose throws CastError before
  // the query runs, and an unhandled one would reach the error handler as a
  // server fault for what is really a bad request path.
  it("404s for a malformed id rather than throwing a 500", async () => {
    const admin = await makeUser("admin");
    const res = await auth(request(app).get(`${BASE}/auth/users/not-an-object-id`), admin.token);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });
});
