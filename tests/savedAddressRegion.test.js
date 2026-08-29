// Saved addresses must carry region + neighborhoodId.
//
// Regression: the subschema had no `region` field and saveAddress never wrote
// one, so an address saved with a region came back without it. Re-selecting
// that address set customer.region = "", which returned zero cities, made
// inAccraCore falsy, and left checkout offering bus-station pickup with no
// delivery options — silently, with no error anywhere in the chain.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Neighborhood = require("../models/Neighborhood");

const BASE = "/api/v1";

async function makeUser() {
  const user = await User.create({
    name: "Buyer",
    email: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role: "user",
    isVerified: true,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

describe("Saved shipping addresses", () => {
  let token;
  let area;

  beforeEach(async () => {
    ({ token } = await makeUser());
    area = await Neighborhood.create({
      name: "Osu", city: "Accra", municipality: "Klottey Korle",
      lat: 5.557, lng: -0.176, distanceKm: 4.81, assignedZone: "B", isActive: true,
    });
  });

  const save = (body) =>
    request(app).post(`${BASE}/auth/me/addresses`).set("Authorization", `Bearer ${token}`).send(body);

  it("persists the region it was given", async () => {
    const res = await save({
      label: "Home", street: "12 Oxford St",
      region: "Greater Accra", city: "Accra", neighborhood: "Osu",
    });
    expect(res.status).toBe(201);

    const list = await request(app)
      .get(`${BASE}/auth/me/addresses`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.data[0].region).toBe("Greater Accra");
    expect(list.body.data[0].city).toBe("Accra");
    expect(list.body.data[0].neighborhood).toBe("Osu");
  });

  it("persists the neighbourhood id, so the address prices on its own", async () => {
    await save({
      region: "Greater Accra", city: "Accra", neighborhood: "Osu",
      neighborhoodId: String(area._id),
    });
    const list = await request(app)
      .get(`${BASE}/auth/me/addresses`)
      .set("Authorization", `Bearer ${token}`);
    expect(String(list.body.data[0].neighborhoodId)).toBe(String(area._id));
  });

  it("stores null rather than throwing when the id is malformed", async () => {
    const res = await save({
      region: "Ashanti", city: "Kumasi", neighborhood: "", neighborhoodId: "not-an-id",
    });
    expect(res.status).toBe(201);
    const list = await request(app)
      .get(`${BASE}/auth/me/addresses`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.data[0].neighborhoodId ?? null).toBeNull();
    expect(list.body.data[0].region).toBe("Ashanti");
  });

  it("keeps a regional address without a neighbourhood", async () => {
    const res = await save({ region: "Ashanti", city: "Kumasi" });
    expect(res.status).toBe(201);
    const list = await request(app)
      .get(`${BASE}/auth/me/addresses`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.data[0].region).toBe("Ashanti");
  });

  it("still rejects an address with nothing in it", async () => {
    expect((await save({ label: "Empty" })).status).toBe(400);
  });
});
