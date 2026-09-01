// T80p — the Location taxonomy and PickupLocation endpoints: the public
// checkout cascade (region → city → neighborhood), the pickup selector, admin
// CRUD, and the authorization gate on both admin surfaces.
//
// None of these routes had a single test. They are what checkout builds its
// address form from and what decides whether a customer is offered delivery or
// bus-station pickup, so a silent break here shows up as an empty dropdown
// rather than an error.
//
// afterEach in setup.js wipes every collection, but the two controllers hold
// module-scoped 60s caches that a collection wipe cannot reach — so each test
// invalidates them explicitly, exactly as the admin writes now do.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Location = require("../models/Location");
const PickupLocation = require("../models/PickupLocation");
const { invalidateLocationCache } = require("../controllers/locationController");
const { invalidatePickupCache } = require("../controllers/pickupController");

const BASE = "/api/v1";

async function tokenFor(role = "admin") {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await User.create({
    name: `${role}-${suffix}`,
    email: `${role}-${suffix}@eaz.test`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

async function seedLocations() {
  await Location.create([
    { region: "Greater Accra", city: "Accra", neighborhoods: ["Osu", "East Legon"], inAccraCore: true },
    { region: "Greater Accra", city: "Tema", neighborhoods: ["Community 1"], inAccraCore: true },
    { region: "Ashanti", city: "Kumasi", neighborhoods: ["Kejetia"], inAccraCore: false },
    { region: "Northern", city: "Tamale", neighborhoods: [], inAccraCore: false, isActive: false },
  ]);
  invalidateLocationCache();
}

beforeEach(() => {
  invalidateLocationCache();
  invalidatePickupCache();
});

// ── Public cascade ───────────────────────────────────────────────────────────

describe("GET /locations — the checkout cascade", () => {
  beforeEach(seedLocations);

  it("groups active locations by region and omits inactive ones", async () => {
    const res = await request(app).get(`${BASE}/locations`);

    expect(res.status).toBe(200);
    const regions = res.body.data.map((r) => r.region).sort();
    // Northern/Tamale is isActive:false — an inactive city must never reach a
    // dropdown, or a customer selects somewhere we have stopped shipping to.
    expect(regions).toEqual(["Ashanti", "Greater Accra"]);
    const accra = res.body.data.find((r) => r.region === "Greater Accra");
    expect(accra.cities.map((c) => c.city).sort()).toEqual(["Accra", "Tema"]);
  });

  it("filters to the Greater-Accra core, which is what decides delivery vs pickup", async () => {
    const res = await request(app).get(`${BASE}/locations?inAccraCore=true`);

    expect(res.status).toBe(200);
    const cities = res.body.data.flatMap((r) => r.cities.map((c) => c.city)).sort();
    expect(cities).toEqual(["Accra", "Tema"]);
    expect(cities).not.toContain("Kumasi");
  });

  it("filters by region", async () => {
    const res = await request(app).get(`${BASE}/locations?region=Ashanti`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].region).toBe("Ashanti");
  });
});

describe("GET /locations/regions and /cities", () => {
  beforeEach(seedLocations);

  it("returns a sorted, de-duplicated region list", async () => {
    const res = await request(app).get(`${BASE}/locations/regions`);
    expect(res.status).toBe(200);
    // Greater Accra has two cities but must appear once.
    expect(res.body.data).toEqual(["Ashanti", "Greater Accra"]);
  });

  it("requires a region for /cities rather than dumping every city", async () => {
    const res = await request(app).get(`${BASE}/locations/cities`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("matches the region loosely, so an address saved before the dropdown still resolves", async () => {
    // Free-text addresses stored "greater  accra" with odd case and spacing.
    // An exact match returns nothing and the failure is silent all the way to
    // checkout offering pickup in a city we deliver to.
    const res = await request(app).get(`${BASE}/locations/cities?region=${encodeURIComponent("  greater   accra ")}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.city).sort()).toEqual(["Accra", "Tema"]);
  });
});

describe("GET /locations/neighborhoods", () => {
  beforeEach(seedLocations);

  it("returns the neighbourhoods for a region + city, with the core flag", async () => {
    const res = await request(app).get(`${BASE}/locations/neighborhoods?region=Greater Accra&city=Accra`);

    expect(res.status).toBe(200);
    expect(res.body.data.inAccraCore).toBe(true);
    // The model lowercases on save so lookups stay plain string compares.
    expect(res.body.data.neighborhoods).toEqual(["osu", "east legon"]);
  });

  it("requires both region and city", async () => {
    const res = await request(app).get(`${BASE}/locations/neighborhoods?region=Ashanti`);
    expect(res.status).toBe(400);
  });

  it("404s for a pair that does not exist", async () => {
    const res = await request(app).get(`${BASE}/locations/neighborhoods?region=Ashanti&city=Nowhere`);
    expect(res.status).toBe(404);
  });
});

// ── Public pickup selector ───────────────────────────────────────────────────

describe("GET /pickups — the bus-station selector", () => {
  beforeEach(async () => {
    await PickupLocation.create([
      { name: "Nima Warehouse", kind: "warehouse", region: "Greater Accra", city: "Accra", isDefault: true },
      { name: "Kumasi VIP Station", kind: "bus_station", region: "Ashanti", city: "Kumasi" },
      { name: "Tamale STC", kind: "bus_station", region: "Northern", city: "Tamale" },
      { name: "Retired Station", kind: "bus_station", region: "Ashanti", city: "Kumasi", isActive: false },
    ]);
    invalidatePickupCache();
  });

  it("defaults to bus stations — the warehouse is an origin, not a customer choice", async () => {
    const res = await request(app).get(`${BASE}/pickups`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((p) => p.name).sort();
    expect(names).toEqual(["Kumasi VIP Station", "Tamale STC"]);
    expect(names).not.toContain("Nima Warehouse");
  });

  it("omits deactivated stations — a customer must not book a handoff point we stopped using", async () => {
    const res = await request(app).get(`${BASE}/pickups?region=Ashanti`);
    expect(res.body.data.map((p) => p.name)).toEqual(["Kumasi VIP Station"]);
  });

  it("filters by city", async () => {
    const res = await request(app).get(`${BASE}/pickups?city=Tamale`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].city).toBe("Tamale");
  });
});

// ── Admin CRUD + the authorization gate ──────────────────────────────────────

describe("Admin location CRUD", () => {
  let token;
  beforeEach(async () => {
    token = await tokenFor("admin");
  });

  it("creates a location", async () => {
    const res = await request(app)
      .post(`${BASE}/admin/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Volta", city: "Ho", neighborhoods: ["Bankoe"], inAccraCore: false });

    expect(res.status).toBe(201);
    expect(res.body.data.city).toBe("Ho");
  });

  it("rejects a duplicate region + city with 409, not 500", async () => {
    await Location.create({ region: "Volta", city: "Ho" });
    const res = await request(app)
      .post(`${BASE}/admin/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Volta", city: "Ho" });

    expect(res.status).toBe(409);
  });

  it("requires region and city", async () => {
    const res = await request(app)
      .post(`${BASE}/admin/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Volta" });

    expect(res.status).toBe(400);
  });

  it("deactivates rather than deleting by default", async () => {
    const loc = await Location.create({ region: "Volta", city: "Ho" });
    const res = await request(app)
      .delete(`${BASE}/admin/locations/${loc._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Still present, just inactive — historical orders reference it.
    expect((await Location.findById(loc._id)).isActive).toBe(false);
  });

  it("hard-deletes only when explicitly asked", async () => {
    const loc = await Location.create({ region: "Volta", city: "Ho" });
    await request(app)
      .delete(`${BASE}/admin/locations/${loc._id}?hard=true`)
      .set("Authorization", `Bearer ${token}`);

    expect(await Location.findById(loc._id)).toBeNull();
  });
});

describe("admin location/pickup routes are admin-only", () => {
  it.each([
    ["/admin/locations", "GET"],
    ["/admin/pickups", "GET"],
  ])("%s %s refuses an anonymous caller", async (path, method) => {
    const res = await request(app)[method.toLowerCase()](`${BASE}${path}`);
    expect(res.status).toBe(401);
  });

  it.each(["/admin/locations", "/admin/pickups"])(
    "%s refuses a signed-in ordinary user",
    async (path) => {
      const token = await tokenFor("user");
      const res = await request(app).get(`${BASE}${path}`).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  );

  it("refuses a staff member — these are admin surfaces, not staff ones", async () => {
    const token = await tokenFor("staff");
    const res = await request(app)
      .post(`${BASE}/admin/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Volta", city: "Ho" });

    expect(res.status).toBe(403);
  });
});

// ── The cache bug this task surfaced ─────────────────────────────────────────

describe("admin writes invalidate the public read cache", () => {
  it("a newly created location appears immediately, not after the 60s TTL", async () => {
    const token = await tokenFor("admin");
    // Prime the cache with the empty taxonomy.
    await request(app).get(`${BASE}/locations/regions`);

    await request(app)
      .post(`${BASE}/admin/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ region: "Volta", city: "Ho" });

    const res = await request(app).get(`${BASE}/locations/regions`);
    expect(res.body.data).toContain("Volta");
  });

  it("a deactivated station disappears immediately", async () => {
    const token = await tokenFor("admin");
    const station = await PickupLocation.create({
      name: "Kumasi VIP Station", kind: "bus_station", region: "Ashanti", city: "Kumasi",
    });
    invalidatePickupCache();
    // Prime the cache while the station is live.
    const before = await request(app).get(`${BASE}/pickups`);
    expect(before.body.data).toHaveLength(1);

    await request(app)
      .delete(`${BASE}/admin/pickups/${station._id}`)
      .set("Authorization", `Bearer ${token}`);

    // Without invalidation this still returned the station for up to a minute,
    // so a customer could select and pay for a handoff point we had just retired.
    const after = await request(app).get(`${BASE}/pickups`);
    expect(after.body.data).toHaveLength(0);
  });
});
