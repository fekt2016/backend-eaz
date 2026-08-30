// Owner decision (2026-08-30): the address book is a CUSTOMER surface. Only
// role "user" may reach it — admin, superadmin, staff and technician are
// refused. The requirement named admin/superadmin/staff; technician is included
// because "only user should have access" excludes it too, and technician is
// already denied every other customer surface (domains, hosting).
//
// This matters more than a hidden nav link: the sidebar entry and the Next.js
// middleware both stop the PAGE rendering, but neither stops a staff account
// calling the API directly. This is the gate that actually holds.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Address = require("../models/Address");

const BASE = "/api/v1";

async function makeUserWithRole(role) {
  const user = await User.create({
    name: `${role}-user`,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@eaz.test`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

const VALID_ADDRESS = {
  label: "Home",
  fullName: "Ama Mensah",
  phone: "0241234567",
  region: "Greater Accra",
  city: "Accra",
  neighborhood: "East Legon",
  street: "12 Boundary Road",
};

const DENIED = ["admin", "superadmin", "staff", "technician"];

describe("Address book is customer-only", () => {
  it("lets a customer use their own address book", async () => {
    const { token } = await makeUserWithRole("user");
    const list = await auth(request(app).get(`${BASE}/addresses`), token);
    expect(list.status).toBe(200);

    const created = await auth(request(app).post(`${BASE}/addresses`), token).send(VALID_ADDRESS);
    expect(created.status).toBe(201);
  });

  describe.each(DENIED)("role %s", (role) => {
    it("is refused the address list", async () => {
      const { token } = await makeUserWithRole(role);
      const res = await auth(request(app).get(`${BASE}/addresses`), token);
      expect(res.status).toBe(403);
    });

    it("cannot create an address", async () => {
      const { token } = await makeUserWithRole(role);
      const res = await auth(request(app).post(`${BASE}/addresses`), token).send(VALID_ADDRESS);
      expect(res.status).toBe(403);
      expect(await Address.countDocuments()).toBe(0);
    });

    it("cannot update, promote or delete an existing address", async () => {
      // Seed one through a real customer so the ids are genuine.
      const customer = await makeUserWithRole("user");
      const created = await auth(request(app).post(`${BASE}/addresses`), customer.token).send(VALID_ADDRESS);
      const id = created.body.data._id;

      const { token } = await makeUserWithRole(role);
      const patched = await auth(request(app).patch(`${BASE}/addresses/${id}`), token).send({ label: "Hijacked" });
      expect(patched.status).toBe(403);

      const promoted = await auth(request(app).patch(`${BASE}/addresses/${id}/default`), token);
      expect(promoted.status).toBe(403);

      const removed = await auth(request(app).delete(`${BASE}/addresses/${id}`), token);
      expect(removed.status).toBe(403);

      // Untouched.
      const still = await Address.findById(id);
      expect(still).not.toBeNull();
      expect(still.label).toBe("Home");
    });
  });

  // Guards the specific trap in this change: restrictTo('user') would NOT have
  // caught superadmin, because restrictTo treats superadmin as satisfying every
  // role check (middleware/auth.js:46). denyRoles has no such escape hatch.
  it("refuses superadmin — it is not exempt the way restrictTo would have made it", async () => {
    const { token } = await makeUserWithRole("superadmin");
    const res = await auth(request(app).get(`${BASE}/addresses`), token);
    expect(res.status).toBe(403);
  });
});
