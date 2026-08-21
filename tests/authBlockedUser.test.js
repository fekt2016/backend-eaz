// resetPassword/verifyPin didn't check isBlocked (T50) — a blocked user with a
// still-valid reset token or verification PIN could get a fresh session token,
// even though login already rejects blocked accounts.
const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
const { hashPin } = require("../controllers/authController");

async function makeUser(over = {}) {
  return User.create({
    name: "Blocked",
    email: `blocked-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    isVerified: true,
    isBlocked: true,
    blockedReason: "Suspicious activity",
    ...over,
  });
}

describe("PATCH /api/v1/auth/reset-password/:token — blocked user (T50)", () => {
  it("rejects a blocked user's still-valid reset token with 403, not a token", async () => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    await makeUser({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: Date.now() + 60 * 60 * 1000,
    });

    const res = await request(app)
      .patch(`/api/v1/auth/reset-password/${rawToken}`)
      .send({ password: "NewPassword123!" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("still allows a non-blocked user's reset to succeed", async () => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    await makeUser({
      isBlocked: false,
      resetPasswordToken: hashedToken,
      resetPasswordExpires: Date.now() + 60 * 60 * 1000,
    });

    const res = await request(app)
      .patch(`/api/v1/auth/reset-password/${rawToken}`)
      .send({ password: "NewPassword123!" });

    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/auth/verify-pin — blocked user (T50)", () => {
  it("rejects a blocked user's still-valid PIN with 403, not a token", async () => {
    const user = await makeUser({
      isVerified: false,
      verifyPin: hashPin("123456"),
      verifyPinExpires: Date.now() + 60 * 60 * 1000,
    });

    const res = await request(app)
      .post("/api/v1/auth/verify-pin")
      .send({ email: user.email, pin: "123456" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("still allows a non-blocked user's PIN verification to succeed", async () => {
    const user = await makeUser({
      isBlocked: false,
      isVerified: false,
      verifyPin: hashPin("123456"),
      verifyPinExpires: Date.now() + 60 * 60 * 1000,
    });

    const res = await request(app)
      .post("/api/v1/auth/verify-pin")
      .send({ email: user.email, pin: "123456" });

    expect(res.status).toBe(200);
  });
});
