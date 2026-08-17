const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Product = require("../models/Product");
const User = require("../models/User");
const ProductReview = require("../models/ProductReview");

let slugCounter = 0;
function makeProduct(overrides = {}) {
  slugCounter += 1;
  return {
    name: "Test Widget",
    slug: `test-widget-${Date.now()}-${slugCounter}`,
    price: 1500,
    category: "widgets",
    stock: 10,
    isActive: true,
    ...overrides,
  };
}

async function makeUser(role = "user") {
  const user = await User.create({
    name: role === "admin" ? "Admin" : "Reviewer",
    email: `${role}-${Date.now()}@t.com`,
    password: "Password123!",
    role,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

describe("Product reviews — create", () => {
  it("rejects unauthenticated submission with 401", async () => {
    const product = await Product.create(makeProduct());
    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .send({ rating: 5, comment: "Great product, exactly as described." });
    expect(res.status).toBe(401);
  });

  it("creates an approved review for an authenticated user", async () => {
    const product = await Product.create(makeProduct());
    const { token } = await makeUser();

    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Great product, exactly as described." });

    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.approved).toBe(true);
    expect(res.body.data.user.toString()).toBeTruthy();
  });

  it("rejects a rating outside 1-5 and a too-short comment", async () => {
    const product = await Product.create(makeProduct());
    const { token } = await makeUser();

    const badRating = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 9, comment: "Great product, exactly as described." });
    expect(badRating.status).toBe(400);

    const short = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 4, comment: "short" });
    expect(short.status).toBe(400);
  });

  it("blocks a second review from the same user with 409", async () => {
    const product = await Product.create(makeProduct());
    const { token } = await makeUser();
    const body = { rating: 5, comment: "Great product, exactly as described." };

    await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    const second = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ...body, rating: 4 });

    expect(second.status).toBe(409);
  });

  it("404s for an unknown product", async () => {
    const { token } = await makeUser();
    const res = await request(app).post("/api/v1/products/507f1f77bcf86cd799439011/reviews")
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Great product, exactly as described." });
    expect(res.status).toBe(404);
  });
});

describe("Product reviews — read", () => {
  it("returns only approved reviews, paginated, newest first", async () => {
    const product = await Product.create(makeProduct());
    const { user } = await makeUser();
    const { user: user2 } = await makeUser();
    await ProductReview.create({ product: product._id, user: user._id, rating: 5, comment: "Approved review one", approved: true });
    await ProductReview.create({ product: product._id, user: user2._id, rating: 1, comment: "Pending review two", approved: false });

    const res = await request(app).get(`/api/v1/products/${product._id}/reviews`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].comment).toBe("Approved review one");
    expect(res.body.data[0].userName).toBe("Reviewer");
    expect(res.body).toHaveProperty("pages", 1);
  });

  it("404s for an unknown product slug", async () => {
    const res = await request(app).get("/api/v1/products/nope/reviews");
    expect(res.status).toBe(404);
  });
});

describe("Product reviews — my review", () => {
  it("returns the current user's review via /mine", async () => {
    const product = await Product.create(makeProduct());
    const { user, token } = await makeUser();
    await ProductReview.create({ product: product._id, user: user._id, rating: 4, comment: "My own review text", approved: true });

    const res = await request(app).get(`/api/v1/products/${product._id}/reviews/mine`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.comment).toBe("My own review text");
  });

  it("updates the current user's review via PATCH /mine", async () => {
    const product = await Product.create(makeProduct());
    const { user, token } = await makeUser();
    await ProductReview.create({ product: product._id, user: user._id, rating: 3, comment: "Initial review text", approved: true });

    const res = await request(app).patch(`/api/v1/products/${product._id}/reviews/mine`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Updated review text here" });

    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.comment).toBe("Updated review text here");
  });

  it("404s on PATCH /mine when the user never reviewed", async () => {
    const product = await Product.create(makeProduct());
    const { token } = await makeUser();
    const res = await request(app).patch(`/api/v1/products/${product._id}/reviews/mine`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Updated review text here" });
    expect(res.status).toBe(404);
  });
});

describe("Product reviews — admin moderation", () => {
  it("lists all reviews incl. pending with resolved names (admin only)", async () => {
    const product = await Product.create(makeProduct());
    const { user } = await makeUser();
    await ProductReview.create({ product: product._id, user: user._id, rating: 2, comment: "A pending review here", approved: false });
    const { token } = await makeUser("admin");

    const res = await request(app).get("/api/v1/product-reviews/all")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].approved).toBe(false);
    expect(res.body.data[0].productName).toBe("Test Widget");
    expect(res.body.data[0].userName).toBe("Reviewer");
  });

  it("rejects non-admin access to the admin list", async () => {
    const { token } = await makeUser();
    const res = await request(app).get("/api/v1/product-reviews/all")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("approves/unapproves and deletes a review (admin only)", async () => {
    const product = await Product.create(makeProduct());
    const { user } = await makeUser();
    const review = await ProductReview.create({ product: product._id, user: user._id, rating: 2, comment: "A pending review here", approved: false });
    const { token } = await makeUser("admin");

    const approved = await request(app).patch(`/api/v1/product-reviews/${review._id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approved: true });
    expect(approved.status).toBe(200);
    expect(approved.body.data.approved).toBe(true);

    const deleted = await request(app).delete(`/api/v1/product-reviews/${review._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(200);
    expect(await ProductReview.findById(review._id)).toBeNull();
  });
});

describe("GET /api/v1/products/:slug — rating summary", () => {
  it("attaches average + count of approved reviews to the product", async () => {
    const product = await Product.create(makeProduct());
    const { user } = await makeUser();
    const { user: user2 } = await makeUser();
    const { user: user3 } = await makeUser();
    await ProductReview.create({ product: product._id, user: user._id, rating: 4, comment: "Approved review four", approved: true });
    await ProductReview.create({ product: product._id, user: user2._id, rating: 2, comment: "Approved review two", approved: true });
    await ProductReview.create({ product: product._id, user: user3._id, rating: 1, comment: "Pending review one", approved: false });

    const res = await request(app).get(`/api/v1/products/${product.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ratingSummary).toEqual({ average: 3, count: 2 });
  });
});

describe("End-to-end — real logged-in user flow (register → verify → submit → public page → admin)", () => {
  it("walks the full journey a customer would take in the browser", async () => {
    const product = await Product.create(makeProduct());
    const email = `e2e-${Date.now()}@t.com`;
    const password = "Password123!";

    // 1. Register (the real /auth/register endpoint)
    const reg = await request(app).post("/api/v1/auth/register")
      .send({ name: "E2E Shopper", email, password });
    expect(reg.status).toBe(201);
    expect(reg.body.data.requiresVerification).toBe(true);

    // 2. Verify the PIN the way the emailed code would be entered
    const unverified = await User.findOne({ email }).select("+verifyPin");
    expect(unverified.verifyPin).toBeTruthy();
    const verify = await request(app).post("/api/v1/auth/verify-pin")
      .send({ email, pin: unverified.verifyPin });
    expect(verify.status).toBe(200);
    const cookie = verify.headers["set-cookie"][0].split(";")[0];
    expect(cookie.startsWith("token=")).toBe(true);

    // 3. Submit a review while logged in via the httpOnly cookie
    const submit = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Cookie", cookie)
      .send({ rating: 4, comment: "Loved it — fast delivery and exactly as described." });
    expect(submit.status).toBe(201);
    expect(submit.body.data.approved).toBe(true);

    // 4. The public product page now shows the review + rating summary
    const pub = await request(app).get(`/api/v1/products/${product.slug}`);
    expect(pub.body.data.ratingSummary).toEqual({ average: 4, count: 1 });

    const list = await request(app).get(`/api/v1/products/${product._id}/reviews`);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].userName).toBe("E2E Shopper");
    expect(list.body.data[0].comment).toContain("fast delivery");

    // 5. Admin moderation sees it, with resolved names
    const { token: adminToken } = await makeUser("admin");
    const all = await request(app).get("/api/v1/product-reviews/all")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(1);
    expect(all.body.data[0].productName).toBe("Test Widget");
    expect(all.body.data[0].userName).toBe("E2E Shopper");

    // 6. Logging back in (now verified) keeps the review attached to the account
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email, password });
    expect(login.status).toBe(200);
    const loginCookie = login.headers["set-cookie"][0].split(";")[0];
    const mine = await request(app).get(`/api/v1/products/${product._id}/reviews/mine`)
      .set("Cookie", loginCookie);
    expect(mine.status).toBe(200);
    expect(mine.body.data.rating).toBe(4);
  });
});