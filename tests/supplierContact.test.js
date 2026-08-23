// T36: Supplier model gains whatsapp/wechat contact fields (China-sourced
// vendors are reached over WhatsApp/WeChat, not just phone/email). Covers
// create/update accepting + persisting + returning both, and that whatsapp
// keeps a leading "+" (sanitizeText, not the Ghana-only sanitizePhone).
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Supplier = require("../models/Supplier");

async function makeUser(role = "superadmin") {
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

describe("Supplier WhatsApp/WeChat contact fields (T36)", () => {
  it("POST /pos/suppliers persists whatsapp and wechat", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/pos/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Shenzhen Parts Co", whatsapp: "+8613800138000", wechat: "sz_parts_2024" });

    expect(res.status).toBe(201);
    expect(res.body.data.whatsapp).toBe("+8613800138000");
    expect(res.body.data.wechat).toBe("sz_parts_2024");
  });

  it("GET /pos/suppliers/:id returns whatsapp and wechat", async () => {
    const { user, token } = await makeUser();
    const supplier = await Supplier.create({
      name: "Guangzhou Screens", whatsapp: "+8613900139000", wechat: "gz_screens",
      createdBy: user._id,
    });

    const res = await request(app)
      .get(`/api/v1/pos/suppliers/${supplier._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.supplier.whatsapp).toBe("+8613900139000");
    expect(res.body.data.supplier.wechat).toBe("gz_screens");
  });

  it("PATCH /pos/suppliers/:id updates whatsapp and wechat independently of phone", async () => {
    const { user, token } = await makeUser();
    const supplier = await Supplier.create({
      name: "Acme Freight", phone: "0244123456", createdBy: user._id,
    });

    const res = await request(app)
      .patch(`/api/v1/pos/suppliers/${supplier._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ whatsapp: "+233244123456", wechat: "acme_freight" });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe("0244123456");
    expect(res.body.data.whatsapp).toBe("+233244123456");
    expect(res.body.data.wechat).toBe("acme_freight");
  });

  it("a supplier created without whatsapp/wechat leaves both unset, not empty strings", async () => {
    const { token } = await makeUser();

    const res = await request(app)
      .post("/api/v1/pos/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Chat Contact Ltd" });

    expect(res.status).toBe(201);
    expect(res.body.data.whatsapp).toBeUndefined();
    expect(res.body.data.wechat).toBeUndefined();
  });
});
