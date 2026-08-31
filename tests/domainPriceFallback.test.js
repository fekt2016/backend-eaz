// T65 — the domain price fallback used to read `getDefaultPrice`, a table already
// denominated in GH₵, and then convert it again by rate × markup. A .com came out
// at 85 × 15.5 × 1.2 = GH₵1,581 against a true sell price of 190, and since the
// payment guard is a ±5% band, the customer's *correct* payment was rejected as
// "Invalid payment amount". Prices now come from config/domainPricing.js (USD)
// through one conversion.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const namecheap = require("../services/namecheap");

async function makeCustomer() {
  const user = await User.create({
    name: "Kwame Mensah",
    email: `cust-${Date.now()}@t.com`,
    password: "Password123!",
    role: "user",
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

describe("tldPriceGhs — the single source for a TLD's sell price", () => {
  beforeEach(() => {
    // Pricing comes from Settings.pricing now, not env. The defaults are the
    // same 15.5 / 1.2, so this suite's expected figures are unchanged.
  });

  it("converts the USD cost table exactly once", () => {
    // .com costs $10.18 → ceil(10.18 × 15.5 × 1.2) = 190, not 1,581.
    expect(namecheap.tldPriceGhs(".com")).toBe(190);
  });

  it("returns null for a TLD we hold no cost for, rather than inventing one", () => {
    expect(namecheap.tldPriceGhs(".madeup")).toBeNull();
  });

  it("agrees with getPricing(), so search and checkout can't disagree", async () => {
    const pricing = await namecheap.getPricing();
    expect(namecheap.tldPriceGhs(".com")).toBe(pricing[".com"]);
  });
});

describe("POST /api/v1/domain/payment — price guard (T65)", () => {
  // tests/setup.js blanks the Namecheap credentials, so hasConfig() is false and
  // the request takes exactly the fallback branch this regression is about.
  it("accepts the real cedi price when the live pricing path is unavailable", async () => {
    const token = await makeCustomer();

    const res = await request(app)
      .post("/api/v1/domain/payment")
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybiz.com", amount: 190, years: 1, phone: "0551234987" });

    // Whatever happens downstream (Paystack is not configured in tests), it must
    // not be a rejection of the amount.
    expect(res.body.error || "").not.toMatch(/Invalid payment amount/);
  });

  it("still rejects an amount that isn't close to the real price", async () => {
    const token = await makeCustomer();

    const res = await request(app)
      .post("/api/v1/domain/payment")
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybiz.com", amount: 20, years: 1, phone: "0551234987" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid payment amount/);
  });

  it("scales the expected price by the number of years", async () => {
    const token = await makeCustomer();

    const res = await request(app)
      .post("/api/v1/domain/payment")
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "mybiz.com", amount: 190, years: 3, phone: "0551234987" });

    // One year's price for a three-year registration is now under-paying.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid payment amount/);
  });
});

describe("domain suggestions never offer a TLD we can't sell (T65)", () => {
  it("keeps .gh / .com.gh / .africa out of /domain/suggest", async () => {
    const res = await request(app).get("/api/v1/domain/suggest?query=mybiz");

    expect(res.status).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    for (const s of res.body.suggestions) {
      expect(s).not.toMatch(/\.(com\.gh|org\.gh|gh|africa)$/);
    }
  });
});
