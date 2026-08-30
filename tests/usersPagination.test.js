// GET /auth/users used to be `User.find()` — every user, every field, no
// pagination and no lean, rendered into one response on a 512MB heap. Same
// class as T87.
//
// Search moved server-side in the same change, and the pairing matters: the
// list page filtered client-side over the full array, so paginating alone would
// have left search matching only within the current page. That is not a visible
// error, it is a wrong answer.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");

const BASE = "/api/v1";

async function makeUser(role, over = {}) {
  const user = await User.create({
    name: over.name || `${role}-person`,
    email: over.email || `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@eaz.test`,
    password: "Password123!",
    role, isVerified: true, ...over,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}
const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

describe("GET /auth/users — pagination", () => {
  it("returns a bounded page, not the whole collection", async () => {
    const admin = await makeUser("admin");
    for (let i = 0; i < 30; i++) await makeUser("user");

    const res = await auth(request(app).get(`${BASE}/auth/users?limit=10`), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(10);
    expect(res.body.data.total).toBe(31); // 30 + the admin
    expect(res.body.data.page).toBe(1);
  });

  it("walks pages without repeating or dropping anyone", async () => {
    const admin = await makeUser("admin");
    for (let i = 0; i < 12; i++) await makeUser("user");

    const p1 = await auth(request(app).get(`${BASE}/auth/users?limit=5&page=1`), admin.token);
    const p2 = await auth(request(app).get(`${BASE}/auth/users?limit=5&page=2`), admin.token);
    const p3 = await auth(request(app).get(`${BASE}/auth/users?limit=5&page=3`), admin.token);

    const ids = [...p1.body.data.users, ...p2.body.data.users, ...p3.body.data.users].map((u) => u._id);
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(13); // no duplicates across pages
  });

  it("clamps an oversized limit rather than hydrating the collection", async () => {
    const admin = await makeUser("admin");
    for (let i = 0; i < 5; i++) await makeUser("user");

    const res = await auth(request(app).get(`${BASE}/auth/users?limit=100000`), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBeLessThanOrEqual(100);
  });

  // The reason search had to move server-side at the same time.
  it("searches the WHOLE collection, not just the current page", async () => {
    const admin = await makeUser("admin");
    for (let i = 0; i < 30; i++) await makeUser("user");
    await makeUser("user", { name: "Findable Person", email: `findable-${Date.now()}@eaz.test` });

    // A page size of 5 means the target is nowhere near page 1.
    const res = await auth(request(app).get(`${BASE}/auth/users?limit=5&q=Findable`), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.users[0].name).toBe("Findable Person");
  });

  it("escapes regex metacharacters in the search term", async () => {
    const admin = await makeUser("admin");
    await makeUser("user", { name: "Normal Name" });

    // Unescaped, `(a+)+$` is a catastrophic-backtracking pattern.
    const res = await auth(request(app).get(`${BASE}/auth/users?q=${encodeURIComponent("(a+)+$")}`), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0); // treated literally, matches nobody
  });

  it("counts blocked users across the whole set, not just the page", async () => {
    const admin = await makeUser("admin");
    for (let i = 0; i < 10; i++) await makeUser("user");
    await makeUser("user", { isBlocked: true });
    await makeUser("user", { isBlocked: true });

    const res = await auth(request(app).get(`${BASE}/auth/users?limit=3`), admin.token);
    expect(res.body.data.users).toHaveLength(3);
    expect(res.body.data.blockedTotal).toBe(2);
  });

  it("filters by role", async () => {
    const admin = await makeUser("admin");
    await makeUser("staff");
    await makeUser("technician");

    const res = await auth(request(app).get(`${BASE}/auth/users?role=staff`), admin.token);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.users[0].role).toBe("staff");
  });

  // The Activity Log actor dropdown needs every user — a truncated dropdown
  // silently hides actors. The projection is what keeps that affordable.
  it("compact mode returns every user, projected to four fields", async () => {
    const admin = await makeUser("admin");
    for (let i = 0; i < 30; i++) await makeUser("user");

    const res = await auth(request(app).get(`${BASE}/auth/users?compact=1`), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(31); // not truncated to a page
    const sample = res.body.data.users[0];
    expect(Object.keys(sample).sort()).toEqual(["_id", "email", "name", "role"]);
    expect(sample.isBlocked).toBeUndefined();
  });

  it.each(["user", "staff", "technician"])("still refuses role %s", async (role) => {
    const caller = await makeUser(role);
    const res = await auth(request(app).get(`${BASE}/auth/users`), caller.token);
    expect(res.status).toBe(403);
  });
});
