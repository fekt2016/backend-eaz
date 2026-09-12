/*
 * T178 — GET /auth/me answers "is anyone signed in?" with 200 and a null user,
 * instead of a 401.
 *
 * The 401 was a correct status for a correct answer, but Chrome logs every 401
 * as a console error, so every logged-out visitor produced one on every page
 * view and the errors that mattered were buried under it. A browser's own
 * network log cannot be caught away in JS, so the request had to stop failing.
 *
 * ⚠️ This is a contract change on an auth endpoint, so what matters is what did
 * NOT change:
 *
 *   · `protect` is untouched. Every other route still 401s an anonymous caller
 *     — asserted here, not assumed.
 *   · No user data comes back when there is no usable session.
 *   · The reasons the old refusals carried are all still present, as `reason`,
 *     so a client that routed on the 403's `requiresVerification` can route on
 *     `reason === "unverified"`.
 */
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
const { hashPin } = require("../controllers/authController");

function tokenFor(user, over = {}) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role, tv: user.tokenVersion || 0, ...over },
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

describe("GET /auth/me — a question, not a gate (T178)", () => {
  it("answers 200 with a null user when nobody is signed in", async () => {
    const res = await request(app).get("/api/v1/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeNull();
    expect(res.body.data.reason).toBe("unauthenticated");
  });

  it("answers 200 for a junk token rather than 401", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer not-a-real-token");

    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeNull();
    expect(res.body.data.reason).toBe("invalid_token");
  });

  it("returns the user when one is signed in", async () => {
    const user = await makeUser({ name: "Ama Mensah" });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe("Ama Mensah");
    expect(res.body.data.reason).toBeNull();
  });

  it("never returns the password, even signed in", async () => {
    const user = await makeUser();
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`);

    expect(res.body.data.user.password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("Password123!");
  });

  it.each([
    ["a suspended account", { isBlocked: true }, "blocked"],
    ["a deactivated account", { isActive: false }, "deactivated"],
    ["a signup that has not entered its PIN", {
      isVerified: false,
      verifyPin: hashPin("123456"),
      verifyPinExpires: Date.now() + 3600_000,
    }, "unverified"],
  ])("gives %s a null user and says why, leaking nothing", async (_label, over, reason) => {
    const user = await makeUser({ ...over, name: "Secret Person" });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeNull();
    expect(res.body.data.reason).toBe(reason);
    // The refusal used to leak nothing; neither does the answer.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Secret Person");
    expect(body).not.toContain(user.email);
  });

  it("treats a token from a rotated session as signed out", async () => {
    // T91's tokenVersion gate — logging out or changing a password bumps it.
    const user = await makeUser({ tokenVersion: 3 });
    const stale = tokenFor(user, { tv: 1 });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${stale}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeNull();
    expect(res.body.data.reason).toBe("session_ended");
  });

  it("does NOT soften any other route — protect still refuses", async () => {
    /*
     * The whole risk of this change is that it weakens authentication
     * generally. It does not: attachUser is mounted on this one GET, and
     * everything else still carries protect.
     */
    for (const path of ["/api/v1/orders/mine", "/api/v1/notifications", "/api/v1/addresses"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  it("still requires a session to CHANGE the profile", async () => {
    // Only the GET moved. PATCH /me keeps protect.
    const res = await request(app).patch("/api/v1/auth/me").send({ name: "Nope" });
    expect(res.status).toBe(401);
  });
});
