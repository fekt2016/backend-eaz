// Pagination sorted on a non-unique key is unstable: `createdAt` ties, and
// skip/limit over a tied sort can serve the same document on two pages while
// dropping another entirely. productController's list was fixed for this once;
// eight other paginated endpoints kept the bug.
//
// It is not a test-only problem. Users register in the same millisecond during a
// seed or an import, several sales share a second on a busy till, and most
// expenses carry a DATE rather than a timestamp — so ties there are the rule.
// An admin walking the list sees a duplicate and never learns what was hidden.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Expense = require("../models/Expense");

const BASE = "/api/v1";

async function admin() {
  const user = await User.create({
    name: "admin", email: `admin-${Date.now()}@t.com`,
    password: "Password123!", role: "admin", isVerified: true,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

/** Walk every page and collect the ids, the way an admin scrolling a list does. */
async function walk(url, token, pages, limit) {
  const ids = [];
  for (let p = 1; p <= pages; p += 1) {
    const res = await request(app).get(`${url}${url.includes("?") ? "&" : "?"}page=${p}&limit=${limit}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const rows = res.body.data.users || res.body.data.expenses || res.body.data;
    ids.push(...rows.map((r) => String(r._id)));
  }
  return ids;
}

describe("Paginated lists are stable when the sort key ties", () => {
  it("shows every user exactly once, even sharing a createdAt", async () => {
    const { token } = await admin();
    // The tie made explicit: one timestamp for all of them, which is what a
    // seed or a bulk import produces.
    const at = new Date("2026-01-01T00:00:00Z");
    await User.collection.insertMany(
      Array.from({ length: 12 }, (_, i) => ({
        name: `u${i}`, email: `u${i}-${Date.now()}@t.com`, password: "x",
        role: "user", isVerified: true, createdAt: at, updatedAt: at,
      })),
    );

    const ids = await walk(`${BASE}/auth/users`, token, 3, 5);

    // 12 seeded + the admin = 13, each seen once.
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(13);
  });

  it("shows every expense exactly once, even sharing a date", async () => {
    // Expenses are the worst case: `date` is a day, so every expense recorded
    // that day ties with every other.
    const { user, token } = await admin();
    const day = new Date("2026-02-02T00:00:00Z");
    // `createdBy` matters: expense visibility is scoped to the recorder (T113),
    // so an expense belonging to nobody is invisible to everybody.
    await Expense.collection.insertMany(
      Array.from({ length: 9 }, (_, i) => ({
        description: `e${i}`, amount: 1000, category: "other",
        createdBy: user._id, date: day, createdAt: day, updatedAt: day,
      })),
    );

    const ids = await walk(`${BASE}/pos/expenses`, token, 3, 4);

    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
  });
});
