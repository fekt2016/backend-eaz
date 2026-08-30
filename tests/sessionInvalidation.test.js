// T91 — session invalidation, and T88 — unverified accounts.
//
// T91: logout cleared the cookie and nothing else, and no password path
// invalidated anything, so a captured JWT stayed valid for its full expiry
// (JWT_EXPIRES_IN, 90 days in production) through BOTH logout and a password
// change — the two actions a user takes precisely when they believe they are
// cutting off an intruder. The admin password reset on the new user-detail page
// had the same hole: it looked like "lock this account down" and was not.
//
// T88: `protect` checked the token, existence and isBlocked, but not whether
// the account had ever completed verification.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");

const BASE = "/api/v1";
const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

async function makeUser(over = {}) {
  const user = await User.create({
    name: "Ama",
    email: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@eaz.test`,
    password: "Password123!",
    role: "user",
    isVerified: true,
    ...over,
  });
  return user;
}

// Mint the way the app does, so the tv claim is present and correct.
const tokenFor = (user) => user.generateAuthToken();

describe("T91 — session invalidation", () => {
  it("accepts a normal session", async () => {
    const user = await makeUser();
    const res = await auth(request(app).get(`${BASE}/auth/me`), tokenFor(user));
    expect(res.status).toBe(200);
  });

  it("rejects a token captured before logout", async () => {
    const user = await makeUser();
    const stolen = tokenFor(user);

    // It works right up until logout.
    expect((await auth(request(app).get(`${BASE}/auth/me`), stolen)).status).toBe(200);

    await auth(request(app).post(`${BASE}/auth/logout`), stolen);

    const after = await auth(request(app).get(`${BASE}/auth/me`), stolen);
    expect(after.status).toBe(401);
    expect(after.body.error).toMatch(/session has ended/i);
  });

  it("rejects a token issued before a self-service password change", async () => {
    const user = await makeUser();
    const stolen = tokenFor(user);

    const changed = await auth(request(app).patch(`${BASE}/auth/change-password`), stolen)
      .send({ currentPassword: "Password123!", newPassword: "BrandNew123!" });
    expect(changed.status).toBe(200);

    const after = await auth(request(app).get(`${BASE}/auth/me`), stolen);
    expect(after.status).toBe(401);
  });

  // The reason this matters for the admin user-detail page: resetting a
  // compromised user's password must actually cut the intruder off.
  it("rejects the victim's token after an ADMIN resets their password", async () => {
    const admin = await makeUser({ role: "admin" });
    const victim = await makeUser();
    const stolen = tokenFor(victim);

    expect((await auth(request(app).get(`${BASE}/auth/me`), stolen)).status).toBe(200);

    const reset = await auth(request(app).patch(`${BASE}/auth/users/${victim._id}/password`), tokenFor(admin))
      .send({ newPassword: "AdminSet123!" });
    expect(reset.status).toBe(200);

    const after = await auth(request(app).get(`${BASE}/auth/me`), stolen);
    expect(after.status).toBe(401);
  });

  it("leaves OTHER users' sessions alone", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const bToken = tokenFor(b);

    await auth(request(app).post(`${BASE}/auth/logout`), tokenFor(a));

    expect((await auth(request(app).get(`${BASE}/auth/me`), bToken)).status).toBe(200);
  });

  // Logout decodes without verifying on purpose (it must never fail), but the
  // BUMP is gated on jwt.verify. Otherwise anyone could forge `{ id }` and log
  // any user out of every device.
  it("a forged logout token cannot end someone else's sessions", async () => {
    const victim = await makeUser();
    const good = tokenFor(victim);

    const forged = jwt.sign({ id: victim._id.toString() }, "not-the-real-secret");
    await auth(request(app).post(`${BASE}/auth/logout`), forged);

    const after = await auth(request(app).get(`${BASE}/auth/me`), good);
    expect(after.status).toBe(200); // untouched
  });

  // Tokens minted before this shipped carry no `tv`. Treating that as 0 keeps
  // live sessions working on deploy instead of logging out every customer.
  it("accepts a legacy token with no tv claim while the account is at version 0", async () => {
    const user = await makeUser();
    const legacy = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      process.env.JWT_SECRET,
    );
    expect((await auth(request(app).get(`${BASE}/auth/me`), legacy)).status).toBe(200);
  });

  it("but that legacy token dies once the account bumps", async () => {
    const user = await makeUser();
    const legacy = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      process.env.JWT_SECRET,
    );
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });

    expect((await auth(request(app).get(`${BASE}/auth/me`), legacy)).status).toBe(401);
  });
});

describe("T88 — unverified accounts reach nothing", () => {
  it("refuses an account still holding a verification PIN", async () => {
    const user = await makeUser({ isVerified: false, verifyPin: "hashed-pin-value" });
    const res = await auth(request(app).get(`${BASE}/auth/me`), tokenFor(user));

    expect(res.status).toBe(403);
    expect(res.body.requiresVerification).toBe(true);
  });

  it("allows a verified account", async () => {
    const user = await makeUser({ isVerified: true });
    expect((await auth(request(app).get(`${BASE}/auth/me`), tokenFor(user))).status).toBe(200);
  });

  // The carve-out that makes this safe to ship. Accounts predating the PIN
  // system have isVerified=false and NO verifyPin, and login has always let
  // them through. Refusing on `!isVerified` alone would lock them out of every
  // endpoint while still letting them log in.
  it("allows a legacy account: isVerified false but no PIN was ever issued", async () => {
    const user = await makeUser({ isVerified: false });
    const res = await auth(request(app).get(`${BASE}/auth/me`), tokenFor(user));
    expect(res.status).toBe(200);
  });

  it("does not affect admin-created staff, which are created verified", async () => {
    const staff = await makeUser({ role: "staff", isVerified: true });
    expect((await auth(request(app).get(`${BASE}/auth/me`), tokenFor(staff))).status).toBe(200);
  });
});
