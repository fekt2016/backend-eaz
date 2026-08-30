// T126 — input validation coverage.
//
// The count that opened this task: 122 write endpoints, 5 uses of the Zod
// `validate()` middleware. Two schemas in validation/ were written and imported
// by NOTHING — contactSchema and domainSchema.
//
// The lesson these tests encode is that an unwired schema is not a free win
// waiting to be plugged in. It is an untested assertion about a request shape,
// and both of these were wrong in opposite directions:
//
//   contactSchema  TOO NARROW — declared 4 of the 9 fields the controller reads.
//                  `validate()` does req.body = schema.parse(req.body) and Zod
//                  strips unknown keys, so wiring it unchanged would have
//                  silently dropped phone, businessName, service, type and plan.
//   domainSchema   TOO STRICT — required `email`, which the controller never
//                  reads (identity comes from req.user). It would have rejected
//                  valid requests, including this repo's own T65 tests.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Contact = require("../models/Contact");

const BASE = "/api/v1";

describe("T126 — contact form validation", () => {
  // The bug wiring the old schema would have shipped.
  it("keeps every field the controller reads, not just the four it declared", async () => {
    const res = await request(app).post(`${BASE}/contacts`).send({
      name: "Ama Mensah",
      email: "ama@eaz.test",
      phone: "0241234567",
      subject: "Website",
      message: "Hello",
      businessName: "Ama Shop",
      service: "Web design",
      type: "consultation",
      plan: "Pro",
    });

    expect(res.status).toBe(201);
    const saved = await Contact.findById(res.body.data._id);
    // Each of these would have been stripped by the schema as it was written.
    expect(saved.phone).toBe("0241234567");
    expect(saved.businessName).toBe("Ama Shop");
    expect(saved.service).toBe("Web design");
    expect(saved.type).toBe("consultation");
    expect(saved.plan).toBe("Pro");
  });

  // The other bug: the old schema required `message`, the controller does not.
  it("accepts a consultation with no message", async () => {
    const res = await request(app).post(`${BASE}/contacts`).send({
      name: "Kofi",
      email: "kofi@eaz.test",
      type: "consultation",
      service: "SEO audit",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.message).toBe("");
  });

  it("rejects a missing email with 400, not a 500 from Mongoose", async () => {
    const res = await request(app).post(`${BASE}/contacts`).send({ name: "Ama" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app).post(`${BASE}/contacts`)
      .send({ name: "Ama", email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  // An unrecognised enum used to reach Mongoose, whose ValidationError is a
  // clumsier failure than a clean 400 at the edge.
  it("rejects an unrecognised contact type at the edge", async () => {
    const res = await request(app).post(`${BASE}/contacts`)
      .send({ name: "Ama", email: "ama@eaz.test", type: "nonsense" });
    expect(res.status).toBe(400);
  });

  it("caps an over-long message rather than letting the sanitiser truncate silently", async () => {
    const res = await request(app).post(`${BASE}/contacts`)
      .send({ name: "Ama", email: "ama@eaz.test", message: "x".repeat(5000) });
    expect(res.status).toBe(400);
  });
});

describe("T126 — domain payment validation", () => {
  async function customerToken() {
    const user = await User.create({
      name: "Cust",
      email: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@eaz.test`,
      password: "Password123!", role: "user", isVerified: true,
    });
    return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  }

  it("rejects a non-numeric amount before the controller reads it", async () => {
    const token = await customerToken();
    const res = await request(app).post(`${BASE}/domain/payment`)
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybiz.com", amount: "not-a-number", years: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative amount — this is a money path", async () => {
    const token = await customerToken();
    const res = await request(app).post(`${BASE}/domain/payment`)
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybiz.com", amount: -500, years: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects years outside 1-10", async () => {
    const token = await customerToken();
    const res = await request(app).post(`${BASE}/domain/payment`)
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybiz.com", amount: 300, years: 99 });
    expect(res.status).toBe(400);
  });

  // The over-strictness that wiring the schema as written would have shipped.
  it("does NOT require an email — the controller takes identity from req.user", async () => {
    const token = await customerToken();
    const res = await request(app).post(`${BASE}/domain/payment`)
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybiz.com", amount: 20, years: 1, phone: "0551234987" });

    // Reaches the controller's own price guard rather than being turned away by
    // the schema — a 400 about the AMOUNT, not about a missing email.
    expect(res.body.error || "").not.toMatch(/email/i);
  });
});
