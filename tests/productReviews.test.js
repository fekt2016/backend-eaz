// verifyPin is stored hashed (T49), so the E2E flow below can no longer read
// the code straight off the DB record — capture it the way the real emailed
// code would arrive, via the (mocked) send call.
jest.mock("../utils/email", () => {
  const actual = jest.requireActual("../utils/email");
  return { ...actual, sendVerificationPin: jest.fn(async () => {}) };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Product = require("../models/Product");
const User = require("../models/User");
const ProductReview = require("../models/ProductReview");
const Order = require("../models/Order");
const { sendVerificationPin } = require("../utils/email");

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

let orderCounter = 0;
// A verified-purchase fixture: a paid order for `email` containing `product`.
// Reviews now require this — see productReviewController.hasVerifiedPurchase.
async function makeVerifyingOrder({ product, email, status = "paid" }) {
  orderCounter += 1;
  return Order.create({
    orderNumber: `EZW-TEST-${Date.now()}-${orderCounter}`,
    items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
    subtotal: product.price,
    total: product.price,
    customer: { name: "Reviewer", phone: "0500000000", email },
    status,
  });
}

describe("Product reviews — create", () => {
  it("rejects unauthenticated submission with 401", async () => {
    const product = await Product.create(makeProduct());
    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .send({ rating: 5, comment: "Great product, exactly as described." });
    expect(res.status).toBe(401);
  });

  it("creates an approved review for an authenticated verified purchaser", async () => {
    const product = await Product.create(makeProduct());
    const { user, token } = await makeUser();
    await makeVerifyingOrder({ product, email: user.email });

    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Great product, exactly as described." });

    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.approved).toBe(true);
    expect(res.body.data.user.toString()).toBeTruthy();
  });

  it("rejects submission from a logged-in user with no verified purchase (403)", async () => {
    const product = await Product.create(makeProduct());
    const { token } = await makeUser();

    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Great product, exactly as described." });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PURCHASE_NOT_VERIFIED");
  });

  it("rejects submission when the user's only order for this product is still pending", async () => {
    const product = await Product.create(makeProduct());
    const { user, token } = await makeUser();
    await makeVerifyingOrder({ product, email: user.email, status: "pending" });

    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Great product, exactly as described." });

    expect(res.status).toBe(403);
  });

  it("rejects submission when the user's paid order is for a different product", async () => {
    const product = await Product.create(makeProduct());
    const otherProduct = await Product.create(makeProduct());
    const { user, token } = await makeUser();
    await makeVerifyingOrder({ product: otherProduct, email: user.email });

    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Great product, exactly as described." });

    expect(res.status).toBe(403);
  });

  it("verifies a purchase by phone match when the account has no matching email order", async () => {
    const product = await Product.create(makeProduct());
    const { user, token } = await makeUser();
    // Give the user a phone; the order is placed under that phone with a
    // different/blank checkout email — same match logic as getMyOrders.
    user.phone = "0244123456";
    await user.save();
    await Order.create({
      orderNumber: `EZW-TEST-PHONE-${Date.now()}`,
      items: [{ product: product._id, name: product.name, price: product.price, qty: 1 }],
      subtotal: product.price,
      total: product.price,
      customer: { name: "Reviewer", phone: "0244123456", email: "" },
      status: "delivered",
    });

    const res = await request(app).post(`/api/v1/products/${product._id}/reviews`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rating: 5, comment: "Great product, exactly as described." });

    expect(res.status).toBe(201);
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
    const { user, token } = await makeUser();
    await makeVerifyingOrder({ product, email: user.email });
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
    expect(sendVerificationPin).toHaveBeenCalledTimes(1);
    const [, pin] = sendVerificationPin.mock.calls[0];
    expect(pin).toMatch(/^\d{6}$/);
    const verify = await request(app).post("/api/v1/auth/verify-pin")
      .send({ email, pin });
    expect(verify.status).toBe(200);
    const cookie = verify.headers["set-cookie"][0].split(";")[0];
    expect(cookie.startsWith("token=")).toBe(true);

    // 2b. A real paid order under this email — reviews require a verified
    // purchase (CATALOG_CLEANUP_TASK.md follow-up: purchase-verified reviews).
    await makeVerifyingOrder({ product, email });

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