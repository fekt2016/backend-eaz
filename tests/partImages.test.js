// T33: Part.images already existed on the schema and createPart/updatePart/
// getParts/getPublicParts already handled it before this task touched
// anything — this locks that behavior in with real coverage, since none
// existed. (The actual gap this task closed was the shared upload route's
// role gate — see uploadRoute.test.js.)
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");

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

const IMG_A = "https://res.cloudinary.com/demo/a.jpg";
const IMG_B = "https://res.cloudinary.com/demo/b.jpg";

describe("Part images (T33)", () => {
  let staff;
  beforeEach(async () => {
    staff = await makeUser("staff");
  });

  it("createPart persists the images array", async () => {
    const res = await request(app).post("/api/v1/pos/inventory")
      .set("Authorization", `Bearer ${tokenFor(staff)}`)
      .send({ name: "iPhone 12 Screen", costPrice: 5000, sellingPrice: 9000, images: [IMG_A, IMG_B] });

    expect(res.status).toBe(201);
    expect(res.body.data.images).toEqual([IMG_A, IMG_B]);

    const stored = await Product.findById(res.body.data._id);
    expect(stored.images).toEqual([IMG_A, IMG_B]);
  });

  it("updatePart replaces the images array", async () => {
    const part = await Product.create({ name: "Battery", category: "Battery", partCategory: "Battery", costPrice: 2000, price: 4000, stock: 5, images: [IMG_A], sellInStore: true, useInRepairs: true });

    const res = await request(app).patch(`/api/v1/pos/inventory/${part._id}`)
      .set("Authorization", `Bearer ${tokenFor(staff)}`)
      .send({ images: [IMG_B] });

    expect(res.status).toBe(200);
    expect(res.body.data.images).toEqual([IMG_B]);
  });

  it("GET /pos/inventory returns images", async () => {
    await Product.create({ name: "Charging Port", category: "Charging Port", partCategory: "Charging Port", costPrice: 1000, price: 2500, stock: 5, images: [IMG_A], sellInStore: true, useInRepairs: true });

    const res = await request(app).get("/api/v1/pos/inventory")
      .set("Authorization", `Bearer ${tokenFor(staff)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].images).toEqual([IMG_A]);
  });

  it("GET /track/parts (public search) returns images", async () => {
    await Product.create({ name: "Camera Module", category: "Camera", partCategory: "Camera", costPrice: 3000, price: 6000, stock: 5, sellOnline: true, sellInStore: true, images: [IMG_A, IMG_B], useInRepairs: true });

    const res = await request(app).get("/api/v1/track/parts?q=Camera");

    expect(res.status).toBe(200);
    expect(res.body.data[0].images).toEqual([IMG_A, IMG_B]);
  });

  it("a part with no images returns an empty array, not undefined", async () => {
    const res = await request(app).post("/api/v1/pos/inventory")
      .set("Authorization", `Bearer ${tokenFor(staff)}`)
      .send({ name: "Speaker", costPrice: 800, sellingPrice: 1800 });

    expect(res.status).toBe(201);
    expect(res.body.data.images).toEqual([]);
  });
});

describe("Shop product images in POS inventory search (T37)", () => {
  let staff;
  beforeEach(async () => {
    staff = await makeUser("staff");
  });

  it("GET /pos/inventory?includeProducts=true returns product images (previously omitted)", async () => {
    await Product.create({
      name: "USB-C Cable 1m", slug: `usb-c-cable-${Date.now()}`, price: 1500,
      category: "Accessory", stock: 20, isActive: true, images: [IMG_A, IMG_B],
    });

    const res = await request(app).get("/api/v1/pos/inventory?includeProducts=true&q=USB-C")
      .set("Authorization", `Bearer ${tokenFor(staff)}`);

    expect(res.status).toBe(200);
    const product = res.body.data.find((d) => d._kind === "product");
    expect(product.images).toEqual([IMG_A, IMG_B]);
  });

  it("a matched product with no images returns an empty array, not undefined", async () => {
    await Product.create({
      name: "Screen Protector", slug: `screen-protector-${Date.now()}`, price: 500,
      category: "Accessory", stock: 10, isActive: true,
    });

    const res = await request(app).get("/api/v1/pos/inventory?includeProducts=true&q=Screen+Protector")
      .set("Authorization", `Bearer ${tokenFor(staff)}`);

    expect(res.status).toBe(200);
    const product = res.body.data.find((d) => d._kind === "product");
    expect(product.images).toEqual([]);
  });
});
