// Settings.business (T6 — hardcoded chat/notification config moved into Settings).
// Verifies:
//   - GET /api/v1/settings is public and returns default business values when unset.
//   - PATCH /api/v1/settings is admin-only.
//   - A partial business PATCH merges into the existing subdocument instead of
//     replacing it (dot-path $set) — updating one field must not wipe the rest.
//   - getBusinessProfile() reads Settings.business and reflects an update once the
//     cache is cleared (which updateSettings does automatically).
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const { getBusinessProfile, clearBusinessProfileCache } = require("../utils/businessProfile");

async function makeUser(role) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

afterEach(() => {
  clearBusinessProfileCache();
});

describe("GET /api/v1/settings — business defaults", () => {
  it("is public and returns default business profile when Settings has never been written", async () => {
    const res = await request(app).get("/api/v1/settings");
    expect(res.status).toBe(200);
    expect(res.body.data.business.shopName).toBe("EazWorld Repair");
    expect(res.body.data.business.whatsapp).toBe("233244388190");
    expect(res.body.data.business.services.length).toBeGreaterThan(0);
  });
});

describe("PATCH /api/v1/settings — business", () => {
  it("rejects non-admin roles", async () => {
    const { token } = await makeUser("staff");
    const res = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ business: { shopName: "Nope" } });
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).patch("/api/v1/settings").send({ business: { shopName: "Nope" } });
    expect(res.status).toBe(401);
  });

  it("updates a single business field without wiping the rest of the subdocument", async () => {
    const { token } = await makeUser("admin");

    // First write only shopName.
    const first = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ business: { shopName: "Eazy Fix Shop" } });
    expect(first.status).toBe(200);
    expect(first.body.data.business.shopName).toBe("Eazy Fix Shop");
    // Untouched fields must still carry their schema defaults, not be wiped.
    expect(first.body.data.business.whatsapp).toBe("233244388190");
    expect(first.body.data.business.services.length).toBeGreaterThan(0);

    // Then write only whatsapp — shopName from the previous write must survive.
    const second = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ business: { whatsapp: "233201112222" } });
    expect(second.status).toBe(200);
    expect(second.body.data.business.whatsapp).toBe("233201112222");
    expect(second.body.data.business.shopName).toBe("Eazy Fix Shop");
  });

  it("replaces the services list wholesale on update", async () => {
    const { token } = await makeUser("admin");
    const res = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ business: { services: [{ name: "Custom Service", price: "GHS 1", path: "/x" }] } });
    expect(res.status).toBe(200);
    expect(res.body.data.business.services).toEqual([{ name: "Custom Service", price: "GHS 1", path: "/x" }]);
  });
});

describe("getBusinessProfile()", () => {
  it("reflects a Settings update immediately after the cache is cleared by updateSettings", async () => {
    const before = await getBusinessProfile();
    expect(before.shopName).toBe("EazWorld Repair");

    const { token } = await makeUser("admin");
    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ business: { shopName: "Updated Shop Name", shopPhone: "0201234567" } });

    const after = await getBusinessProfile();
    expect(after.shopName).toBe("Updated Shop Name");
    expect(after.shopPhone).toBe("0201234567");
  });
});
