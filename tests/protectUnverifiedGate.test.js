// T92 — `protect` refuses an unverified account. Nothing asserted this, and the
// predicate behind it is deliberately narrower than it looks:
//
//   needsVerification() = isVerified === false && Boolean(verifyPin)
//
// NOT `!isVerified`. Accounts predating the PIN system have isVerified=false and
// no verifyPin, and login has always let them through; refusing those here would
// lock real customers out of every endpoint while still letting them log in.
//
// So there are two ways to break this gate and only one of them looks like a
// bug in review: tightening it to `!isVerified` locks out every legacy account,
// and dropping it entirely lets an unverified signup roam the API. A test that
// only checked the happy path would catch neither.
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
const { hashPin } = require("../controllers/authController");

function tokenFor(user) {
  // Mirrors generateAuthToken: `tv` is the token version protect compares.
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
  );
}

async function makeUser(over = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return User.create({
    name: "Cust",
    email: `cust-${suffix}@t.com`,
    password: "Password123!",
    isVerified: true,
    ...over,
  });
}

// A signup that has been sent a PIN and has not entered it.
const pendingVerification = {
  isVerified: false,
  verifyPin: hashPin("123456"),
  verifyPinExpires: Date.now() + 60 * 60 * 1000,
};

describe("protect — unverified accounts (T92)", () => {
  it("403s a pending signup and says why, rather than 401", async () => {
    const user = await makeUser(pendingVerification);

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`);

    // 403, not 401: the token is valid and the client must be told the
    // difference — the frontend routes on `requiresVerification` to send them
    // to the PIN screen instead of the login screen.
    expect(res.status).toBe(403);
    expect(res.body.requiresVerification).toBe(true);
  });

  it("lets a verified account through", async () => {
    const user = await makeUser();

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
  });

  it("lets a LEGACY account through — isVerified false, but no PIN was ever issued", async () => {
    // The carve-out. These accounts predate the PIN system; login has always
    // admitted them, and `!isVerified` here would lock them out of every
    // endpoint while still letting them log in.
    const user = await makeUser({ isVerified: false, verifyPin: undefined });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
  });

  it("refuses across the API, not just on /auth/me", async () => {
    const user = await makeUser(pendingVerification);
    const token = tokenFor(user);

    // Three unrelated protected routers — the gate lives in `protect`, so it
    // must hold wherever protect is mounted.
    for (const path of ["/api/v1/orders/mine", "/api/v1/notifications", "/api/v1/addresses"]) {
      const res = await request(app).get(path).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.requiresVerification).toBe(true);
    }
  });

  it("does not leak the account's data in the refusal", async () => {
    const user = await makeUser({ ...pendingVerification, name: "Secret Person" });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Secret Person");
    expect(body).not.toContain(user.email);
  });

  it("still 401s an anonymous caller — the gate does not replace authentication", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });
});
