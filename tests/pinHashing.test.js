// verifyPin/twoFactorPin were stored and compared in plaintext (T49) — a DB read
// exposed a directly usable code. Now stored as a sha256 digest (same scheme as
// resetPasswordToken) and compared via timingSafeEqual; the plaintext code sent
// to the user is unaffected — capture it the way the real email delivery would.
jest.mock("../utils/email", () => {
  const actual = jest.requireActual("../utils/email");
  return {
    ...actual,
    sendVerificationPin: jest.fn(async () => {}),
    sendTwoFactorPin: jest.fn(async () => {}),
    sendWelcomeEmail: jest.fn(async () => {}),
  };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const { sendVerificationPin, sendTwoFactorPin } = require("../utils/email");
const { hashPin, pinMatches } = require("../controllers/authController");

function makeToken(user) {
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

describe("hashPin / pinMatches", () => {
  it("hashes deterministically and matches only the correct plaintext", () => {
    const hash = hashPin("123456");
    expect(hash).not.toBe("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pinMatches(hash, "123456")).toBe(true);
    expect(pinMatches(hash, "654321")).toBe(false);
  });

  it("is safe against missing/empty input", () => {
    expect(pinMatches(undefined, "123456")).toBe(false);
    expect(pinMatches(hashPin("123456"), undefined)).toBe(false);
    expect(pinMatches(undefined, undefined)).toBe(false);
  });
});

describe("POST /api/v1/auth/register — verifyPin is stored hashed", () => {
  it("stores a sha256 digest, not the plaintext code that was emailed", async () => {
    const email = `pin-${Date.now()}@t.com`;
    const res = await request(app).post("/api/v1/auth/register")
      .send({ name: "Pin Test", email, password: "Password123!" });
    expect(res.status).toBe(201);

    const [, plainPin] = sendVerificationPin.mock.calls.at(-1);
    expect(plainPin).toMatch(/^\d{6}$/);

    const stored = await User.findOne({ email }).select("+verifyPin");
    expect(stored.verifyPin).not.toBe(plainPin);
    expect(stored.verifyPin).toBe(hashPin(plainPin));
  });

  it("rejects the wrong 6-digit code and accepts the right one", async () => {
    const email = `pin-${Date.now()}-2@t.com`;
    await request(app).post("/api/v1/auth/register")
      .send({ name: "Pin Test", email, password: "Password123!" });
    const [, plainPin] = sendVerificationPin.mock.calls.at(-1);

    const wrong = await request(app).post("/api/v1/auth/verify-pin")
      .send({ email, pin: "000000" === plainPin ? "111111" : "000000" });
    expect(wrong.status).toBe(400);

    const right = await request(app).post("/api/v1/auth/verify-pin")
      .send({ email, pin: plainPin });
    expect(right.status).toBe(200);
  });
});

describe("2FA — twoFactorPin is stored hashed", () => {
  it("stores a sha256 digest at enable-time, and only the correct code confirms it", async () => {
    const user = await User.create({
      name: "2FA User",
      email: `2fa-${Date.now()}@t.com`,
      password: "Password123!",
      isVerified: true,
    });
    const token = makeToken(user);

    const enable = await request(app).post("/api/v1/auth/2fa/enable")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(enable.status).toBe(200);

    const [, plainPin] = sendTwoFactorPin.mock.calls.at(-1);
    const stored = await User.findById(user._id).select("+twoFactorPin");
    expect(stored.twoFactorPin).not.toBe(plainPin);
    expect(stored.twoFactorPin).toBe(hashPin(plainPin));

    const wrongCode = plainPin === "000000" ? "111111" : "000000";
    const wrong = await request(app).post("/api/v1/auth/2fa/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ pin: wrongCode });
    expect(wrong.status).toBe(400);

    const right = await request(app).post("/api/v1/auth/2fa/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ pin: plainPin });
    expect(right.status).toBe(200);

    const confirmed = await User.findById(user._id);
    expect(confirmed.twoFactorEnabled).toBe(true);
  });

  it("login-triggered 2FA code is hashed at rest and verified via /2fa/verify", async () => {
    const password = "Password123!";
    const user = await User.create({
      name: "2FA Login User",
      email: `2fa-login-${Date.now()}@t.com`,
      password,
      isVerified: true,
      twoFactorEnabled: true,
    });

    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: user.email, password });
    expect(login.status).toBe(200);
    expect(login.body.data.requiresTwoFactor).toBe(true);

    const [, plainPin] = sendTwoFactorPin.mock.calls.at(-1);
    const stored = await User.findById(user._id).select("+twoFactorPin");
    expect(stored.twoFactorPin).toBe(hashPin(plainPin));

    const verify = await request(app).post("/api/v1/auth/2fa/verify")
      .send({ email: user.email, pin: plainPin });
    expect(verify.status).toBe(200);
    expect(verify.headers["set-cookie"]).toBeTruthy();
  });
});
