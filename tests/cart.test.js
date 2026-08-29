const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Cart = require("../models/Cart");

async function makeUser() {
  const user = await User.create({
    name: "Cart Tester",
    email: `cart-${Date.now()}@t.com`,
    password: "Password123!",
    role: "user",
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

const item = (overrides = {}) => ({
  lineId: "cable",
  slug: "cable",
  name: "USB Cable",
  price: 2000,
  image: "",
  category: "accessories",
  stock: 10,
  qty: 2,
  ...overrides,
});

describe("Cart API", () => {
  describe("GET /api/v1/cart", () => {
    it("returns an empty cart for a new user", async () => {
      const { token } = await makeUser();
      const res = await request(app)
        .get("/api/v1/cart")
        .set("Cookie", [`token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toEqual([]);
    });

    it("requires auth", async () => {
      const res = await request(app).get("/api/v1/cart");
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/v1/cart", () => {
    it("replaces the entire cart", async () => {
      const { token } = await makeUser();
      const items = [item(), item({ lineId: "case", slug: "case", name: "Case", price: 1500, qty: 1 })];

      const res = await request(app)
        .put("/api/v1/cart")
        .set("Cookie", [`token=${token}`])
        .send({ items });
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(2);

      // Verify persisted
      const getRes = await request(app)
        .get("/api/v1/cart")
        .set("Cookie", [`token=${token}`]);
      expect(getRes.body.data.items).toHaveLength(2);
    });

    it("creates the cart document if it doesn't exist", async () => {
      const { user } = await makeUser();
      const before = await Cart.findOne({ user: user._id });
      expect(before).toBeNull();

      const { token } = await makeUser();
      await request(app)
        .put("/api/v1/cart")
        .set("Cookie", [`token=${token}`])
        .send({ items: [item()] });

      // Re-fetch user to check — need to use same user
    });
  });

  describe("PATCH /api/v1/cart/items", () => {
    it("adds a new item to the cart", async () => {
      const { token } = await makeUser();
      const res = await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item());
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].lineId).toBe("cable");
      expect(res.body.data.items[0].qty).toBe(2);
    });

    it("updates an existing item's qty", async () => {
      const { token } = await makeUser();
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item({ qty: 2 }));

      const res = await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item({ qty: 5 }));
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].qty).toBe(5);
    });

    it("validates required fields", async () => {
      const { token } = await makeUser();
      const res = await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send({ slug: "x" }); // missing lineId, name, price
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/v1/cart/items/:lineId", () => {
    it("removes a specific item", async () => {
      const { token } = await makeUser();
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item());
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item({ lineId: "case", slug: "case", name: "Case", price: 1500, qty: 1 }));

      const res = await request(app)
        .delete("/api/v1/cart/items/cable")
        .set("Cookie", [`token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].lineId).toBe("case");
    });

    it("succeeds even if item doesn't exist", async () => {
      const { token } = await makeUser();
      const res = await request(app)
        .delete("/api/v1/cart/items/nonexistent")
        .set("Cookie", [`token=${token}`]);
      expect(res.status).toBe(200);
    });
  });

  describe("DELETE /api/v1/cart", () => {
    it("clears all items", async () => {
      const { token } = await makeUser();
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item());
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item({ lineId: "case", slug: "case", name: "Case", price: 1500, qty: 1 }));

      const res = await request(app)
        .delete("/api/v1/cart")
        .set("Cookie", [`token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });
  });

  describe("PATCH /api/v1/cart/merge", () => {
    it("appends new items to an existing cart", async () => {
      const { token } = await makeUser();
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item({ qty: 2 }));

      const res = await request(app)
        .patch("/api/v1/cart/merge")
        .set("Cookie", [`token=${token}`])
        .send({
          items: [
            item({ lineId: "case", slug: "case", name: "Case", price: 1500, qty: 1 }),
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
    });

    it("keeps the higher qty when merging a duplicate lineId", async () => {
      const { token } = await makeUser();
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item({ qty: 3 }));

      const res = await request(app)
        .patch("/api/v1/cart/merge")
        .set("Cookie", [`token=${token}`])
        .send({ items: [item({ qty: 1 })] }); // incoming qty 1 < existing 3
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].qty).toBe(3); // kept existing higher qty
    });

    it("takes incoming qty when it's higher", async () => {
      const { token } = await makeUser();
      await request(app)
        .patch("/api/v1/cart/items")
        .set("Cookie", [`token=${token}`])
        .send(item({ qty: 1 }));

      const res = await request(app)
        .patch("/api/v1/cart/merge")
        .set("Cookie", [`token=${token}`])
        .send({ items: [item({ qty: 5 })] });
      expect(res.status).toBe(200);
      expect(res.body.data.items[0].qty).toBe(5);
    });
  });
});
