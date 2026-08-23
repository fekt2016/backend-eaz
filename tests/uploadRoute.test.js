// T33: POST /api/v1/uploads was restrictTo('admin') only, but its two real
// consumers (createProduct/updateProduct in productRoutes.js, and the new
// Part image field via createPart/updatePart in posRoutes.js) both already
// allow 'staff' to save the record the upload feeds — staff hit a 403 on the
// upload itself despite being allowed to save what it's for. Widened to
// restrictTo('admin', 'staff').
// jest hoists jest.mock() above imports, so the factory can't close over an
// outer `require("stream")` — require it inside the factory instead.
jest.mock("../config/cloudinary", () => ({
  cloudinary: {
    uploader: {
      upload_stream: jest.fn((_options, callback) => {
        const { Writable } = require("stream");
        const writable = new Writable({ write(_chunk, _enc, cb) { cb(); } });
        writable.on("finish", () => {
          callback(null, { secure_url: "https://res.cloudinary.com/demo/fake.jpg", public_id: "eazworld/fake" });
        });
        return writable;
      }),
    },
  },
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");

function tokenFor(user) {
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

let seq = 0;
async function makeUser(role) {
  seq += 1;
  return User.create({
    name: role, email: `${role}-${Date.now()}-${seq}@t.com`, password: "Password123!", role, isVerified: true,
  });
}

function attach(req) {
  return req.attach("image", Buffer.from("fake-image-bytes"), "test.jpg");
}

describe("POST /api/v1/uploads — role gate (T33)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await attach(request(app).post("/api/v1/uploads"));
    expect(res.status).toBe(401);
  });

  it("rejects a technician (403)", async () => {
    const user = await makeUser("technician");
    const res = await attach(request(app).post("/api/v1/uploads").set("Authorization", `Bearer ${tokenFor(user)}`));
    expect(res.status).toBe(403);
  });

  it("rejects a plain customer (403)", async () => {
    const user = await makeUser("user");
    const res = await attach(request(app).post("/api/v1/uploads").set("Authorization", `Bearer ${tokenFor(user)}`));
    expect(res.status).toBe(403);
  });

  it("allows staff (previously 403'd despite being allowed to save products/parts)", async () => {
    const user = await makeUser("staff");
    const res = await attach(request(app).post("/api/v1/uploads").set("Authorization", `Bearer ${tokenFor(user)}`));
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe("https://res.cloudinary.com/demo/fake.jpg");
  });

  it("allows admin, unchanged", async () => {
    const user = await makeUser("admin");
    const res = await attach(request(app).post("/api/v1/uploads").set("Authorization", `Bearer ${tokenFor(user)}`));
    expect(res.status).toBe(200);
  });

  it("allows superadmin via restrictTo's implicit bypass, unchanged", async () => {
    const user = await makeUser("superadmin");
    const res = await attach(request(app).post("/api/v1/uploads").set("Authorization", `Bearer ${tokenFor(user)}`));
    expect(res.status).toBe(200);
  });
});
