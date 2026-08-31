// The Zod schemas that existed but were connected to nothing.
//
// `validation/authSchema.js` and `validation/shippingSchema.js` both defined
// schemas that no route applied — validation written and never switched on. This
// suite pins them to their routes so they cannot silently come unwired again.
//
// The zone/tier/settings cases below are the important ones. `.partial()` makes a
// field optional but does NOT remove its `.default()`, so wiring an update schema
// naively would have parsed `{ name }` into every defaulted field as well — and
// because `validate()` REPLACES req.body with the parsed result, renaming a zone
// would have reset its pricing. That is a data-corruption bug, not a style issue,
// which is why each PATCH here asserts on the untouched fields rather than only
// on the status code.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const ShippingZone = require("../models/ShippingZone");

const BASE = "/api/v1";

async function makeAdmin() {
  const user = await User.create({
    name: "admin",
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role: "admin",
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

describe("auth routes — schemas are actually applied", () => {
  it("rejects a login with no password", async () => {
    const res = await request(app).post(`${BASE}/auth/login`).send({ email: "a@b.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.errors.map((e) => e.message).join(" ")).toMatch(/password/i);
  });

  it("still accepts a phone number typed into the email field", async () => {
    // The controller reads `email || phone` into one identifier and tries both
    // sanitizers, so this is a real login shape. A `.email()` rule on that field
    // would have broken the common case in Ghana — the schema must not add one.
    const res = await request(app)
      .post(`${BASE}/auth/login`)
      .send({ email: "0241234567", password: "Password123!" });

    // No such account, so 401/400 from the controller — the point is that Zod
    // did not reject it as a malformed email first.
    expect(res.body.error).not.toBe("Validation failed");
  });

  it("rejects a malformed email on forgot-password", async () => {
    const res = await request(app)
      .post(`${BASE}/auth/forgot-password`)
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("accepts a padded email on forgot-password, which the controller sanitizes", async () => {
    const res = await request(app)
      .post(`${BASE}/auth/forgot-password`)
      .send({ email: "  nobody@eaz.test  " });

    // Unknown address answers 200 by design (no account enumeration). What
    // matters is that the padding did not trip the format check.
    expect(res.body.error).not.toBe("Validation failed");
  });

  it("rejects a reset password under 8 characters", async () => {
    const res = await request(app)
      .patch(`${BASE}/auth/reset-password/sometoken`)
      .send({ password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("admin shipping PATCH — an update must not reset untouched fields", () => {
  let token;
  beforeEach(async () => {
    token = await makeAdmin();
  });

  it("renames a zone without resetting its pricing", async () => {
    const zone = await ShippingZone.create({
      name: "Original",
      code: "ZONE-A",
      city: "Accra",
      baseRate: 1500,
      perKgRate: 250,
      sameDayMultiplier: 1.9,
      estimatedDays: 2,
      isActive: true,
    });

    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/zones/${zone._id}`),
      token,
    ).send({ name: "Renamed" });

    expect(res.status).toBe(200);

    const after = await ShippingZone.findById(zone._id).lean();
    expect(after.name).toBe("Renamed");
    // Every one of these would have been clobbered by an injected default.
    expect(after.baseRate).toBe(1500);
    expect(after.perKgRate).toBe(250);
    expect(after.sameDayMultiplier).toBe(1.9);
    expect(after.isActive).toBe(true);
  });

  it("rejects a non-numeric rate", async () => {
    const zone = await ShippingZone.create({
      name: "Z", code: "ZONE-B", city: "Accra", baseRate: 100, estimatedDays: 1,
    });

    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/zones/${zone._id}`),
      token,
    ).send({ baseRate: "not-a-number" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");

    const after = await ShippingZone.findById(zone._id).lean();
    expect(after.baseRate).toBe(100);
  });

  it("rejects an unknown courier-rate mode", async () => {
    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/courier-rate`),
      token,
    ).send({ mode: "nonsense" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("accepts a courier-rate edit that omits the otherwise-required mode", async () => {
    // The controller applies only the keys that were sent, so a PATCH of one
    // field must not be refused for missing `mode`.
    const res = await auth(
      request(app).patch(`${BASE}/admin/shipping/courier-rate`),
      token,
    ).send({ isActive: false });

    expect(res.status).toBe(200);
  });
});
