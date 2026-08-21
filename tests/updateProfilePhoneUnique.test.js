// PATCH /api/v1/auth/me (T47): setting a phone already in use by another
// account used to fall through to the unique index and throw an unhandled
// 500 (11000 duplicate key). Now pre-checked, mirroring adminUpdateUser.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");

async function makeUser(over = {}) {
  const user = await User.create({
    name: "Test User",
    email: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    isVerified: true,
    ...over,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

describe("PATCH /api/v1/auth/me — phone uniqueness (T47)", () => {
  it("returns a friendly 409, not a 500, when the phone is already in use", async () => {
    await makeUser({ phone: "0244000111" });
    const { token } = await makeUser();

    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name", phone: "0244000111" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/i);
  });

  it("allows updating to a phone number nobody else has", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name", phone: "0244000222" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.phone).toBe("0244000222");
  });

  it("allows re-saving your own existing phone (no false conflict with self)", async () => {
    const { user, token } = await makeUser({ phone: "0244000333" });

    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name", phone: user.phone });

    expect(res.status).toBe(200);
    expect(res.body.data.user.phone).toBe("0244000333");
  });

  it("allows clearing the phone to empty even if some other logic would otherwise collide", async () => {
    const { token } = await makeUser({ phone: "0244000444" });

    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name", phone: "" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.phone).toBe("");
  });
});
