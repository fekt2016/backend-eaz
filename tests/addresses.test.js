// Saved delivery addresses — the Address collection and its CRUD routes.
//
// The behaviour that did not exist before this collection: editing an address
// in place, promoting one to default, and a list that belongs to exactly one
// user. Ownership is the security-relevant part — an address id is guessable
// enough that a query filtered only by `_id` would expose someone's home.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Address = require("../models/Address");
const { migrateAddresses } = require("../scripts/migrateAddressesToCollection");
const { MAX_ADDRESSES } = require("../controllers/addressController");

const BASE = "/api/v1";
const silent = () => {};

async function makeCustomer(suffix = "") {
  const user = await User.create({
    name: `customer${suffix}`,
    email: `customer${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role: "user",
    isVerified: true,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

function addressBody(overrides = {}) {
  return {
    label: "Home",
    street: "12 Oxford Street",
    neighborhood: "Osu",
    city: "Accra",
    region: "Greater Accra",
    ...overrides,
  };
}

describe("POST /api/v1/addresses", () => {
  it("saves an address against the logged-in user", async () => {
    const { user, token } = await makeCustomer();

    const res = await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());

    expect(res.status).toBe(201);
    expect(res.body.data.street).toBe("12 Oxford Street");
    expect(String(res.body.data.user)).toBe(String(user._id));
  });

  it("makes the first address the default so checkout opens with one selected", async () => {
    const { token } = await makeCustomer();

    const first = await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());
    const second = await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ label: "Office", street: "5 Ring Road" }));

    expect(first.body.data.isDefault).toBe(true);
    expect(second.body.data.isDefault).toBe(false);
  });

  it("returns the existing address instead of duplicating it", async () => {
    // Checkout saves the delivery address on every order — three orders to the
    // same house must not produce three rows.
    const { token } = await makeCustomer();
    const first = await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());

    const again = await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());

    expect(again.status).toBe(200); // not 201 — nothing new was created
    expect(String(again.body.data._id)).toBe(String(first.body.data._id));
    expect(await Address.countDocuments()).toBe(1);
  });

  it("treats a different street as a different address", async () => {
    const { token } = await makeCustomer();
    await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());

    const other = await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ street: "5 Ring Road" }));

    expect(other.status).toBe(201);
    expect(await Address.countDocuments()).toBe(2);
  });

  it("rejects an address with no deliverable location", async () => {
    const { token } = await makeCustomer();

    const res = await auth(request(app).post(`${BASE}/addresses`), token)
      .send({ label: "Nowhere", region: "Greater Accra" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it(`refuses a ${MAX_ADDRESSES + 1}th address`, async () => {
    const { token } = await makeCustomer();
    for (let n = 0; n < MAX_ADDRESSES; n += 1) {
      const res = await auth(request(app).post(`${BASE}/addresses`), token)
        .send(addressBody({ label: `Address ${n}`, street: `${n} Test Street` }));
      expect(res.status).toBe(201);
    }

    const overflow = await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ label: "One too many", street: "99 Test Street" }));

    expect(overflow.status).toBe(400);
    expect(overflow.body.error).toMatch(new RegExp(`up to ${MAX_ADDRESSES} addresses`));
    expect(await Address.countDocuments()).toBe(MAX_ADDRESSES);
  });

  it("still accepts a re-save of an address already in a full book", async () => {
    // The cap must not block checkout's save-on-order for an address the
    // customer already has — that would fail their order at the last step.
    const { token } = await makeCustomer();
    let first;
    for (let n = 0; n < MAX_ADDRESSES; n += 1) {
      const res = await auth(request(app).post(`${BASE}/addresses`), token)
        .send(addressBody({ label: `Address ${n}`, street: `${n} Test Street` }));
      if (n === 0) first = res.body.data;
    }

    const again = await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ label: "Address 0", street: "0 Test Street" }));

    expect(again.status).toBe(200);
    expect(String(again.body.data._id)).toBe(String(first._id));
  });

  it("requires a login", async () => {
    const res = await request(app).post(`${BASE}/addresses`).send(addressBody());
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/v1/addresses/:id", () => {
  it("edits an address in place — the operation the embedded array never had", async () => {
    const { token } = await makeCustomer();
    const created = await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());

    const res = await auth(request(app).patch(`${BASE}/addresses/${created.body.data._id}`), token)
      .send({ street: "14 Oxford Street" });

    expect(res.status).toBe(200);
    expect(res.body.data.street).toBe("14 Oxford Street");
    // A one-field edit must not blank the rest of the address.
    expect(res.body.data.city).toBe("Accra");
    expect(res.body.data.region).toBe("Greater Accra");
    expect(res.body.data.label).toBe("Home");
  });

  it("refuses an edit that would leave nothing to deliver to", async () => {
    const { token } = await makeCustomer();
    const created = await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ neighborhood: "", city: "" }));

    const res = await auth(request(app).patch(`${BASE}/addresses/${created.body.data._id}`), token)
      .send({ street: "" });

    expect(res.status).toBe(400);
  });

  it("does not let one customer edit another's address", async () => {
    const a = await makeCustomer("-a");
    const b = await makeCustomer("-b");
    const created = await auth(request(app).post(`${BASE}/addresses`), a.token).send(addressBody());

    const res = await auth(request(app).patch(`${BASE}/addresses/${created.body.data._id}`), b.token)
      .send({ street: "Somewhere else" });

    expect(res.status).toBe(404);
    const untouched = await Address.findById(created.body.data._id).lean();
    expect(untouched.street).toBe("12 Oxford Street");
  });
});

describe("PATCH /api/v1/addresses/:id/default", () => {
  it("promotes one address and demotes the rest", async () => {
    const { user, token } = await makeCustomer();
    await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());
    const office = await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ label: "Office", street: "5 Ring Road" }));

    const res = await auth(
      request(app).patch(`${BASE}/addresses/${office.body.data._id}/default`),
      token,
    );

    expect(res.status).toBe(200);
    const defaults = await Address.find({ user: user._id, isDefault: true }).lean();
    expect(defaults).toHaveLength(1);
    expect(String(defaults[0]._id)).toBe(String(office.body.data._id));
  });

  it("returns the list default-first, which is the order checkout renders", async () => {
    const { token } = await makeCustomer();
    await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());
    const office = await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ label: "Office", street: "5 Ring Road" }));

    const res = await auth(
      request(app).patch(`${BASE}/addresses/${office.body.data._id}/default`),
      token,
    );

    expect(res.body.data[0].label).toBe("Office");
  });
});

describe("DELETE /api/v1/addresses/:id", () => {
  it("promotes a survivor when the default is deleted", async () => {
    const { user, token } = await makeCustomer();
    const home = await auth(request(app).post(`${BASE}/addresses`), token).send(addressBody());
    await auth(request(app).post(`${BASE}/addresses`), token)
      .send(addressBody({ label: "Office", street: "5 Ring Road" }));

    await auth(request(app).delete(`${BASE}/addresses/${home.body.data._id}`), token);

    const remaining = await Address.find({ user: user._id }).lean();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].isDefault).toBe(true);
  });

  it("does not let one customer delete another's address", async () => {
    const a = await makeCustomer("-a");
    const b = await makeCustomer("-b");
    const created = await auth(request(app).post(`${BASE}/addresses`), a.token).send(addressBody());

    const res = await auth(request(app).delete(`${BASE}/addresses/${created.body.data._id}`), b.token);

    expect(res.status).toBe(404);
    expect(await Address.findById(created.body.data._id)).toBeTruthy();
  });
});

describe("GET /api/v1/addresses", () => {
  it("returns only the caller's addresses", async () => {
    const a = await makeCustomer("-a");
    const b = await makeCustomer("-b");
    await auth(request(app).post(`${BASE}/addresses`), a.token).send(addressBody());
    await auth(request(app).post(`${BASE}/addresses`), b.token)
      .send(addressBody({ street: "9 Spintex Road" }));

    const res = await auth(request(app).get(`${BASE}/addresses`), a.token);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].street).toBe("12 Oxford Street");
  });
});

describe("legacy /auth/me/addresses", () => {
  it("reads and writes the same collection as the new routes", async () => {
    const { token } = await makeCustomer();

    const created = await auth(request(app).post(`${BASE}/auth/me/addresses`), token)
      .send(addressBody());
    expect(created.status).toBe(201);

    const viaNew = await auth(request(app).get(`${BASE}/addresses`), token);
    expect(viaNew.body.data).toHaveLength(1);
    expect(viaNew.body.data[0].street).toBe("12 Oxford Street");

    const removed = await auth(
      request(app).delete(`${BASE}/auth/me/addresses/${created.body.data._id}`),
      token,
    );
    expect(removed.status).toBe(200);
    expect(await Address.countDocuments()).toBe(0);
  });
});

describe("migrateAddresses", () => {
  async function userWithEmbedded(addresses) {
    const { user } = await makeCustomer("-legacy");
    await User.updateOne({ _id: user._id }, { $set: { shippingAddresses: addresses } });
    return user;
  }

  it("writes nothing on a dry run", async () => {
    await userWithEmbedded([{ street: "12 Oxford Street", city: "Accra", region: "Greater Accra" }]);

    const res = await migrateAddresses({ log: silent });

    expect(res.migrated).toBe(0);
    expect(await Address.countDocuments()).toBe(0);
  });

  it("copies each address with its _id preserved", async () => {
    const user = await userWithEmbedded([
      { street: "12 Oxford Street", city: "Accra", region: "Greater Accra", isDefault: true },
    ]);
    const embeddedId = (await User.findById(user._id).lean()).shippingAddresses[0]._id;

    await migrateAddresses({ apply: true, log: silent });

    const copied = await Address.findById(embeddedId).lean();
    expect(copied).toBeTruthy();
    expect(String(copied.user)).toBe(String(user._id));
    expect(copied.region).toBe("Greater Accra");
  });

  it("collapses the duplicates checkout created on every order", async () => {
    const user = await userWithEmbedded([
      { street: "12 Oxford Street", neighborhood: "Osu", city: "Accra", region: "Greater Accra" },
      { street: "12 Oxford Street", neighborhood: "Osu", city: "Accra", region: "Greater Accra", isDefault: true },
      { street: "12 Oxford Street", neighborhood: "Osu", city: "Accra", region: "Greater Accra" },
    ]);

    await migrateAddresses({ apply: true, log: silent });

    const kept = await Address.find({ user: user._id }).lean();
    expect(kept).toHaveLength(1);
    expect(kept[0].isDefault).toBe(true); // the flagged one survived
  });

  it("leaves exactly one default even when the array carried none", async () => {
    const user = await userWithEmbedded([
      { street: "12 Oxford Street", city: "Accra", region: "Greater Accra" },
      { street: "5 Ring Road", city: "Accra", region: "Greater Accra" },
    ]);

    await migrateAddresses({ apply: true, log: silent });

    expect(await Address.countDocuments({ user: user._id, isDefault: true })).toBe(1);
  });

  it("is idempotent — a second run copies nothing", async () => {
    await userWithEmbedded([{ street: "12 Oxford Street", city: "Accra", region: "Greater Accra" }]);
    await migrateAddresses({ apply: true, log: silent });

    const second = await migrateAddresses({ apply: true, log: silent });

    expect(second.migrated).toBe(0);
    expect(await Address.countDocuments()).toBe(1);
  });

  it("stays idempotent when duplicates were collapsed", async () => {
    // Skipping by `_id` alone is not enough here: the siblings of the copied
    // address keep their own ids, so a second run would dedupe them down to one
    // and copy it — duplicating the row the first run wrote.
    await userWithEmbedded([
      { street: "12 Oxford Street", neighborhood: "Osu", city: "Accra", region: "Greater Accra" },
      { street: "12 Oxford Street", neighborhood: "Osu", city: "Accra", region: "Greater Accra" },
      { street: "12 Oxford Street", neighborhood: "Osu", city: "Accra", region: "Greater Accra" },
    ]);
    await migrateAddresses({ apply: true, log: silent });

    const second = await migrateAddresses({ apply: true, log: silent });

    expect(second.migrated).toBe(0);
    expect(await Address.countDocuments()).toBe(1);
  });

  it("leaves User.shippingAddresses untouched, so rollback is doing nothing", async () => {
    const user = await userWithEmbedded([
      { street: "12 Oxford Street", city: "Accra", region: "Greater Accra" },
    ]);

    await migrateAddresses({ apply: true, log: silent });

    const stillThere = await User.findById(user._id).lean();
    expect(stillThere.shippingAddresses).toHaveLength(1);
  });
});
