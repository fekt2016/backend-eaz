// Account self-service: deactivation and Ghana Card identity verification.
//
// Two owner decisions shape these:
//   - deactivation is REVERSIBLE — orders and history survive, an admin can
//     switch the account back on
//   - Ghana Card is MANUAL admin review, not an automated NIA check
//
// The Ghana Card handling deliberately differs from every other upload in this
// app, and most of what is asserted below is that difference: the number is
// never returned in full, and the images are not publicly fetchable.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");

const BASE = "/api/v1";
const auth = (req, token) => req.set("Cookie", [`token=${token}`]);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function makeUser(over = {}) {
  const user = await User.create({
    name: "Ama", email: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@eaz.test`,
    password: "Password123!", role: "user", isVerified: true, ...over,
  });
  return { user, token: user.generateAuthToken() };
}

describe("POST /account/deactivate", () => {
  it("requires the current password", async () => {
    const { token } = await makeUser();
    const res = await auth(request(app).post(`${BASE}/account/deactivate`), token).send({});
    expect(res.status).toBe(400);
  });

  it("refuses a wrong password", async () => {
    const { token } = await makeUser();
    const res = await auth(request(app).post(`${BASE}/account/deactivate`), token)
      .send({ password: "WrongPassword1!" });
    expect(res.status).toBe(401);
  });

  it("deactivates with the correct password and ends every session", async () => {
    const { user, token } = await makeUser();

    const res = await auth(request(app).post(`${BASE}/account/deactivate`), token)
      .send({ password: "Password123!", reason: "Taking a break" });
    expect(res.status).toBe(200);

    const fresh = await User.findById(user._id);
    expect(fresh.isActive).toBe(false);
    expect(fresh.deactivatedAt).not.toBeNull();
    expect(fresh.deactivationReason).toBe("Taking a break");

    // T91 — the session the request was made with is dead immediately.
    const after = await auth(request(app).get(`${BASE}/auth/me`), token);
    expect(after.status).toBe(401);
  });

  it("blocks a deactivated user from logging back in, with its own message", async () => {
    const { user } = await makeUser();
    await User.updateOne({ _id: user._id }, { isActive: false });

    const res = await request(app).post(`${BASE}/auth/login`)
      .send({ email: user.email, password: "Password123!" });

    expect(res.status).toBe(403);
    expect(res.body.deactivated).toBe(true);
    // Not the "suspended" wording — that is for a staff block, not the user's
    // own choice.
    expect(res.body.error).toMatch(/deactivated/i);
    expect(res.body.error).not.toMatch(/suspended/i);
  });

  it("keeps the account's data — deactivation is reversible", async () => {
    const { user } = await makeUser({ name: "Keep Me", phone: "0241234567" });
    await User.updateOne({ _id: user._id }, { isActive: false, deactivatedAt: new Date() });

    const fresh = await User.findById(user._id);
    expect(fresh.name).toBe("Keep Me");
    expect(fresh.email).toBe(user.email);
    expect(fresh.phone).toBe("0241234567");

    // An admin can switch it back on and the user works again.
    await User.updateOne({ _id: user._id }, { isActive: true, deactivatedAt: null });
    const back = await request(app).post(`${BASE}/auth/login`)
      .send({ email: user.email, password: "Password123!" });
    expect(back.status).toBe(200);
  });

  it("refuses to let an admin self-deactivate", async () => {
    const { token } = await makeUser({ role: "admin" });
    const res = await auth(request(app).post(`${BASE}/account/deactivate`), token)
      .send({ password: "Password123!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/administrator/i);
  });
});

describe("Ghana Card — submission", () => {
  it("rejects a malformed card number", async () => {
    const { token } = await makeUser();
    const res = await auth(request(app).post(`${BASE}/account/ghana-card`), token)
      .field("number", "12345")
      .attach("front", PNG, "front.png")
      .attach("back", PNG, "back.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GHA-/);
  });

  it("requires both sides of the card", async () => {
    const { token } = await makeUser();
    const res = await auth(request(app).post(`${BASE}/account/ghana-card`), token)
      .field("number", "GHA-123456789-0")
      .attach("front", PNG, "front.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/front and back/i);
  });

  it("reports 'none' before anything is submitted", async () => {
    const { token } = await makeUser();
    const res = await auth(request(app).get(`${BASE}/account/ghana-card`), token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("none");
    expect(res.body.data.maskedNumber).toBe("");
  });

  it("never returns the full card number, only a masked form", async () => {
    const { user, token } = await makeUser();
    // Seed a submission directly — the upload itself needs live Cloudinary.
    await User.updateOne({ _id: user._id }, {
      "ghanaCard.number": "GHA-123456789-0",
      "ghanaCard.status": "pending",
      "ghanaCard.submittedAt": new Date(),
    });

    const res = await auth(request(app).get(`${BASE}/account/ghana-card`), token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("pending");
    expect(JSON.stringify(res.body)).not.toContain("GHA-123456789-0");
    expect(res.body.data.maskedNumber).toMatch(/^GHA-•+-/);
  });

  it("does not expose the card number on the normal profile read either", async () => {
    const { user, token } = await makeUser();
    await User.updateOne({ _id: user._id }, { "ghanaCard.number": "GHA-987654321-1" });

    const res = await auth(request(app).get(`${BASE}/auth/me`), token);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("GHA-987654321-1");
  });
});

describe("Ghana Card — admin review", () => {
  async function pendingUser() {
    const made = await makeUser();
    await User.updateOne({ _id: made.user._id }, {
      "ghanaCard.number": "GHA-123456789-0",
      "ghanaCard.frontImageId": "eazworld/ghana-cards/front_x",
      "ghanaCard.backImageId": "eazworld/ghana-cards/back_x",
      "ghanaCard.status": "pending",
      "ghanaCard.submittedAt": new Date(),
    });
    return made;
  }

  it("lets an admin approve a pending submission", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await pendingUser();

    const res = await auth(request(app).patch(`${BASE}/admin/users/${target.user._id}/ghana-card`), admin.token)
      .send({ decision: "approved" });

    expect(res.status).toBe(200);
    const fresh = await User.findById(target.user._id);
    expect(fresh.ghanaCard.status).toBe("approved");
    expect(fresh.ghanaCard.reviewedBy.toString()).toBe(admin.user._id.toString());
  });

  it("records a reason when rejecting", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await pendingUser();

    await auth(request(app).patch(`${BASE}/admin/users/${target.user._id}/ghana-card`), admin.token)
      .send({ decision: "rejected", reason: "Back image is unreadable" });

    const fresh = await User.findById(target.user._id);
    expect(fresh.ghanaCard.status).toBe("rejected");
    expect(fresh.ghanaCard.rejectionReason).toBe("Back image is unreadable");
  });

  it("refuses a decision that is neither approved nor rejected", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await pendingUser();
    const res = await auth(request(app).patch(`${BASE}/admin/users/${target.user._id}/ghana-card`), admin.token)
      .send({ decision: "maybe" });
    expect(res.status).toBe(400);
  });

  it("refuses to review when nothing is pending", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    const res = await auth(request(app).patch(`${BASE}/admin/users/${target.user._id}/ghana-card`), admin.token)
      .send({ decision: "approved" });
    expect(res.status).toBe(409);
  });

  it.each(["user", "staff", "technician"])("refuses role %s", async (role) => {
    const caller = await makeUser({ role });
    const target = await pendingUser();
    const res = await auth(request(app).patch(`${BASE}/admin/users/${target.user._id}/ghana-card`), caller.token)
      .send({ decision: "approved" });
    expect(res.status).toBe(403);
  });

  it("404s the image endpoint when no card is on file", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    const res = await auth(request(app).get(`${BASE}/admin/users/${target.user._id}/ghana-card/image/front`), admin.token);
    expect(res.status).toBe(404);
  });

  it("rejects a side other than front or back", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await pendingUser();
    const res = await auth(request(app).get(`${BASE}/admin/users/${target.user._id}/ghana-card/image/selfie`), admin.token);
    expect(res.status).toBe(400);
  });

  it.each(["user", "staff", "technician"])("refuses role %s the card image", async (role) => {
    const caller = await makeUser({ role });
    const target = await pendingUser();
    const res = await auth(request(app).get(`${BASE}/admin/users/${target.user._id}/ghana-card/image/front`), caller.token);
    expect(res.status).toBe(403);
  });
});
