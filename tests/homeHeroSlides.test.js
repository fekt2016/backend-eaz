// Owner request 2026-09-10: make the homepage hero slider editable.
//
// The slides were a hardcoded array in HeroCarousel.jsx, so changing a headline
// or a photo meant a frontend deploy. They live in Settings.homeHero.slides now.
//
// The rules pinned here are the ones with teeth. Two slide fields are not plain
// text: `href` is rendered into a <Link href> and `image` into a next/image src.
// A bad href is an open redirect; an image host outside next.config.mjs's
// remotePatterns makes next/image THROW, which takes the whole homepage down —
// so the save has to refuse both rather than trust that an admin pasted well.
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const User = require("../models/User");
const Settings = require("../models/Settings");

const BASE = "/api/v1";
const auth = (req, token) => req.set("Cookie", [`token=${token}`]);

async function tokenFor(role) {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@eaz.test`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

const slide = (over = {}) => ({
  icon: "Palette",
  service: "Web Design",
  headline: "Websites That Win Clients",
  description: "We design fast, modern websites.",
  cta: "See Web Design",
  href: "/services/web-design",
  image: "/images/hero/web-design.png",
  accent: "#F5A623",
  bg: "#fffbf5",
  ...over,
});

describe("GET /api/v1/settings — hero defaults", () => {
  it("serves the shipped slides publicly when Settings has never been written", async () => {
    const res = await request(app).get(`${BASE}/settings`);
    expect(res.status).toBe(200);
    expect(res.body.data.homeHero.slides).toHaveLength(7);
    expect(res.body.data.homeHero.slides[0].headline).toBe("Websites That Win Clients");
    // Every default slide carries its own image — the old component referenced
    // slide.image without ever setting it, so all seven silently showed the
    // web-design photo.
    const images = new Set(res.body.data.homeHero.slides.map((s) => s.image));
    expect(images.size).toBe(7);
  });
});

describe("PATCH /api/v1/settings — hero slides", () => {
  it("is admin only", async () => {
    const token = await tokenFor("user");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide()] } });
    expect(res.status).toBe(403);
  });

  it("saves slides and returns them on the same response", async () => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide({ headline: "New Headline" }), slide({ service: "SEO" })] } });

    expect(res.status).toBe(200);
    expect(res.body.data.homeHero.slides).toHaveLength(2);
    expect(res.body.data.homeHero.slides[0].headline).toBe("New Headline");

    const saved = await Settings.findOne({ key: "global" }).lean();
    expect(saved.homeHero.slides).toHaveLength(2);
    expect(saved.homeHero.updatedAt).toBeTruthy();
  });

  it("leaves the business profile untouched — dot-path $set, not a whole-doc replace", async () => {
    const token = await tokenFor("admin");
    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ business: { shopName: "Kept Name" } });
    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide()] } });

    const saved = await Settings.findOne({ key: "global" }).lean();
    expect(saved.business.shopName).toBe("Kept Name");
  });

  it("accepts a Cloudinary upload URL as an image", async () => {
    const token = await tokenFor("admin");
    const url = "https://res.cloudinary.com/demo/image/upload/v1/eazworld/hero.png";
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide({ image: url })] } });

    expect(res.status).toBe(200);
    expect(res.body.data.homeHero.slides[0].image).toBe(url);
  });

  // next/image throws on a host missing from next.config.mjs remotePatterns.
  it("rejects an image on a host next/image cannot render", async () => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide({ image: "https://evil.example.com/x.png" })] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/upload button/i);
  });

  it.each([
    ["an absolute URL",      "https://evil.example.com"],
    ["a protocol-relative URL", "//evil.example.com"],
    ["a javascript: URL",    "javascript:alert(1)"],
  ])("rejects %s as a slide link", async (_label, href) => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide({ href })] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slide 1/i);
  });

  it("refuses an empty slide list — a homepage with no hero reads as broken", async () => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one/i);
  });

  it("requires a service label and a headline, naming the slide that is missing one", async () => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide(), slide({ headline: "   " })] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slide 2/i);
  });

  it("caps the list at 12 slides", async () => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: Array.from({ length: 13 }, () => slide()) } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum of 12/i);
  });

  it("strips markup from slide copy", async () => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide({ headline: '<script>alert(1)</script>Clean Headline' })] } });

    expect(res.status).toBe(200);
    expect(res.body.data.homeHero.slides[0].headline).not.toMatch(/<script/i);
  });

  // Cosmetic fields must not be able to fail a save that carries real edits.
  it("falls back to a default icon and colours instead of rejecting bad ones", async () => {
    const token = await tokenFor("admin");
    const res = await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide({ icon: "Not A Real Icon", accent: "chartreuse", bg: "" })] } });

    expect(res.status).toBe(200);
    const [saved] = res.body.data.homeHero.slides;
    expect(saved.icon).toBe("Palette");
    expect(saved.accent).toBe("#F5A623");
    expect(saved.bg).toBe("#fffbf5");
  });

  it("logs a slide COUNT, not the whole array — the log is not a copy store", async () => {
    const token = await tokenFor("admin");
    await auth(request(app).patch(`${BASE}/settings`), token)
      .send({ homeHero: { slides: [slide(), slide()] } });

    const ActivityLog = require("../models/ActivityLog");
    const log = await ActivityLog.findOne({ resourceType: "SETTINGS" }).sort({ createdAt: -1 }).lean();
    const change = log.changes.find((c) => c.field === "homeHero.slides");
    expect(change.after).toBe("2 slides");
  });
});
