// Owner request 2026-08-31: make the USD→GH₵ rate and the domain markup
// editable from the admin UI.
//
// They were env vars, so every cedi move needed a redeploy — and a rate that is
// awkward to change is a rate that goes stale, quietly eating the margin it
// exists to protect.
//
// The rate is SHARED: it prices domains and every hosting plan. That was already
// true as an env var; these tests pin it so nobody later "fixes" hosting to use
// a separate number without deciding to.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Settings = require("../models/Settings");
const pricingSettings = require("../services/pricingSettings");

const BASE = "/api/v1";
const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

async function adminToken() {
  const user = await User.create({
    name: "Admin", email: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@eaz.test`,
    password: "Password123!", role: "admin", isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

beforeEach(() => pricingSettings.invalidate());

describe("Admin pricing settings", () => {
  it("saves a new rate and markup", async () => {
    const token = await adminToken();
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 17.25, domainMarkup: 1.35 } });

    expect(res.status).toBe(200);
    const saved = await Settings.findOne({ key: "global" }).lean();
    expect(saved.pricing.usdToGhsRate).toBe(17.25);
    expect(saved.pricing.domainMarkup).toBe(1.35);
    expect(saved.pricing.updatedAt).toBeTruthy();
  });

  it("updates one knob without wiping the other", async () => {
    const token = await adminToken();
    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 17, domainMarkup: 1.4 } });
    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 18 } });

    const saved = await Settings.findOne({ key: "global" }).lean();
    expect(saved.pricing.usdToGhsRate).toBe(18);
    expect(saved.pricing.domainMarkup).toBe(1.4); // survived
  });

  // The mistake that cannot be undone once orders land.
  it("refuses a markup below 1 — that would sell domains below cost", async () => {
    const token = await adminToken();
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { domainMarkup: 0.2 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/below cost/i);
  });

  it("refuses an absurd rate — 155 instead of 15.5 would 10x every price", async () => {
    const token = await adminToken();
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 100000 } });
    expect(res.status).toBe(400);
  });

  it("refuses a non-numeric rate", async () => {
    const token = await adminToken();
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: "abc" } });
    expect(res.status).toBe(400);
  });

  it.each(["user", "staff", "technician"])("refuses role %s", async (role) => {
    const user = await User.create({
      name: role, email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@eaz.test`,
      password: "Password123!", role, isVerified: true,
    });
    const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 20 } });
    expect(res.status).toBe(403);
  });
});

describe("The saved rate actually moves prices", () => {
  it("a new rate changes BOTH domain and hosting prices", async () => {
    const token = await adminToken();
    const spaceship = require("../services/spaceship");
    const { HOSTING_PLANS } = require("../config/hostingPlans");

    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 15.5, domainMarkup: 1.2 } });
    await pricingSettings.refresh();
    const domainBefore = spaceship.tldPriceGhs(".com");
    const hostingBefore = HOSTING_PLANS.shared.deluxe.monthlyPrice;

    // Cedi weakens.
    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 20 } });
    await pricingSettings.refresh();

    expect(spaceship.tldPriceGhs(".com")).toBeGreaterThan(domainBefore);
    // The shared-rate contract: hosting moves too. If this ever fails, someone
    // has split the rate without deciding to.
    expect(HOSTING_PLANS.shared.deluxe.monthlyPrice).toBeGreaterThan(hostingBefore);
  });

  it("raising the markup moves domains but NOT hosting", async () => {
    const token = await adminToken();
    const spaceship = require("../services/spaceship");
    const { HOSTING_PLANS } = require("../config/hostingPlans");

    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { usdToGhsRate: 15.5, domainMarkup: 1.2 } });
    await pricingSettings.refresh();
    const hostingBefore = HOSTING_PLANS.shared.deluxe.monthlyPrice;
    const domainBefore = spaceship.tldPriceGhs(".com");

    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ pricing: { domainMarkup: 1.5 } });
    await pricingSettings.refresh();

    expect(spaceship.tldPriceGhs(".com")).toBeGreaterThan(domainBefore);
    // Hosting priceUsd values are already sell prices — no markup applies.
    expect(HOSTING_PLANS.shared.deluxe.monthlyPrice).toBe(hostingBefore);
  });

  // The env vars are GONE (owner decision 2026-08-31). A fresh install with no
  // settings document falls to the hardcoded defaults, which are the same
  // numbers the env vars carried — so prices do not move on deploy.
  it("falls back to the hardcoded defaults when nothing is saved", async () => {
    await Settings.deleteMany({});
    pricingSettings.invalidate();
    await pricingSettings.refresh();
    const { usdToGhsRate, domainMarkup } = pricingSettings.current();
    expect(usdToGhsRate).toBe(15.5);
    expect(domainMarkup).toBe(1.2);
  });

  // The point of removing the env vars: two sources of truth meant the env one
  // could silently win wherever the settings document had not been written.
  it("IGNORES the old env vars entirely", async () => {
    process.env.USD_TO_GHS_RATE = "99";
    process.env.DOMAIN_MARKUP = "9";
    try {
      await Settings.deleteMany({});
      pricingSettings.invalidate();
      await pricingSettings.refresh();
      const { usdToGhsRate, domainMarkup } = pricingSettings.current();
      expect(usdToGhsRate).toBe(15.5);
      expect(domainMarkup).toBe(1.2);
    } finally {
      delete process.env.USD_TO_GHS_RATE;
      delete process.env.DOMAIN_MARKUP;
    }
  });
});
