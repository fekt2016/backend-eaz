// T87: `.limit(Number(req.query.limit))` let any authenticated staff or admin
// session ask for ?limit=1000000 and hydrate a whole collection into a 512 MB
// heap, taking the API down for everyone. Five list endpoints did it. The clamp
// now lives in one helper so a new endpoint inherits the bound.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const { paginate } = require("../utils/pagination");

async function token(role = "admin") {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

describe("paginate() (T87)", () => {
  it("defaults when nothing is asked for", () => {
    expect(paginate({}, { defaultLimit: 30 })).toEqual({ page: 1, limit: 30, skip: 0 });
  });

  it("clamps an oversized limit to the maximum rather than erroring", () => {
    // A caller asking for too much gets the biggest page there is — that is what
    // a paginated API should do, and it is what keeps the heap intact.
    expect(paginate({ limit: "1000000" }, { defaultLimit: 30, maxLimit: 100 }).limit).toBe(100);
  });

  it("falls back to the default on junk rather than producing NaN", () => {
    // NaN would reach Mongoose as "no limit at all" — the very bug being fixed.
    expect(paginate({ limit: "abc" }, { defaultLimit: 30 }).limit).toBe(30);
    expect(paginate({ limit: "" }, { defaultLimit: 30 }).limit).toBe(30);
    expect(paginate({ limit: "0" }, { defaultLimit: 30 }).limit).toBe(30);
  });

  it("never returns a page below 1, or a negative skip", () => {
    expect(paginate({ page: "-3" }).page).toBe(1);
    expect(paginate({ page: "0" }).skip).toBe(0);
    expect(paginate({ page: "abc" }).page).toBe(1);
  });

  it("computes skip from the clamped values, not the raw ones", () => {
    expect(paginate({ page: "3", limit: "10" })).toEqual({ page: 3, limit: 10, skip: 20 });
    // page 2 of a clamped 100 starts at 100, not at 2 × 1000000.
    expect(paginate({ page: "2", limit: "1000000" }, { maxLimit: 100 }).skip).toBe(100);
  });

  it("leaves ordinary values exactly as they were", () => {
    expect(paginate({ page: "2", limit: "25" }, { defaultLimit: 30 }))
      .toEqual({ page: 2, limit: 25, skip: 25 });
  });
});

describe("GET /pos/inventory — the clamp end to end (T87)", () => {
  async function seed(n) {
    await Product.insertMany(
      Array.from({ length: n }, (_, i) => ({
        name: `Item ${String(i).padStart(3, "0")}`,
        slug: `t87-item-${i}`,
        price: 1000 + i,
        category: "Phones",
        stock: 5,
      })),
    );
  }

  it("returns the maximum page for a hostile limit, not the whole collection", async () => {
    const t = await token();
    await seed(120);

    const res = await request(app)
      .get("/api/v1/pos/inventory?limit=1000000")
      .set("Authorization", `Bearer ${t}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(100); // the ceiling, not 120 and not 1000000
    expect(res.body.total).toBe(120);       // the true count is still reported
  });

  it("still honours an ordinary limit", async () => {
    const t = await token();
    await seed(120);

    const res = await request(app)
      .get("/api/v1/pos/inventory?limit=25&page=2")
      .set("Authorization", `Bearer ${t}`);

    expect(res.body.data).toHaveLength(25);
  });

  it("defaults to 50 when no limit is given", async () => {
    const t = await token();
    await seed(120);

    const res = await request(app)
      .get("/api/v1/pos/inventory")
      .set("Authorization", `Bearer ${t}`);

    expect(res.body.data).toHaveLength(50);
  });
});
