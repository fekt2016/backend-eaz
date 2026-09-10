// Pre-launch audit #18 — honeypot spam protection on the two public form
// endpoints. A hidden `website` field: empty (the human case) → the submission
// is processed normally; non-empty (the bot case) → the endpoint returns the
// same success response but stores/emails nothing, and logs the hit.
// The contact controller fires admin/auto-reply mail fire-and-forget; stub it so
// the suite stays hermetic and no EmailLog write races teardown (see tests/setup.js).
jest.mock("../utils/email", () => {
  const actual = jest.requireActual("../utils/email");
  return {
    ...actual,
    sendContactAdminNotification: jest.fn(async () => true),
    sendContactAutoReply: jest.fn(async () => true),
    sendConsultationConfirmation: jest.fn(async () => true),
    sendConsultationAdminAlert: jest.fn(async () => true),
  };
});

const request = require("supertest");
const app = require("../app");
const Contact = require("../models/Contact");
const Review = require("../models/Review");
const EmailLog = require("../models/EmailLog");
const logger = require("../utils/logger");
const { sendContactAdminNotification, sendContactAutoReply } = require("../utils/email");

const validContact = { name: "Ama Boateng", email: "ama@example.com", message: "I need a website for my shop." };
const validReview = { name: "Kofi Mensah", service: "Web Design", rating: 5, review: "Great work, delivered on time and on budget." };

describe("Honeypot spam protection (audit #18)", () => {
  describe("POST /api/v1/contacts", () => {
    it("processes the submission normally when the honeypot is absent", async () => {
      const res = await request(app).post("/api/v1/contacts").send(validContact);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ name: "Ama Boateng", email: "ama@example.com" });
      expect(await Contact.countDocuments()).toBe(1);
    });

    it("processes the submission normally when the honeypot is present but empty", async () => {
      const res = await request(app).post("/api/v1/contacts").send({ ...validContact, website: "" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(await Contact.countDocuments()).toBe(1);
    });

    it("fakes success and stores/emails nothing when the honeypot is filled", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});

      const res = await request(app)
        .post("/api/v1/contacts")
        .send({ ...validContact, website: "http://spam.example/buy-now" });

      // Same shape a bot would get for a real submission — no error, no hint.
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Nothing was processed.
      expect(await Contact.countDocuments()).toBe(0);
      expect(await EmailLog.countDocuments()).toBe(0);
      expect(sendContactAdminNotification).not.toHaveBeenCalled();
      expect(sendContactAutoReply).not.toHaveBeenCalled();

      // The hit was logged, distinct from real submissions, with IP + timestamp.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/\[honeypot\] contact submission rejected/);
      expect(warn.mock.calls[0][0]).toMatch(/ip=/);
      expect(warn.mock.calls[0][0]).toMatch(/at=\d{4}-\d{2}-\d{2}T/);

      warn.mockRestore();
    });

    it("still fakes success (never 400s) when the honeypot value is not a string", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});

      const res = await request(app)
        .post("/api/v1/contacts")
        .send({ ...validContact, website: { nested: "junk" } });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(await Contact.countDocuments()).toBe(0);

      warn.mockRestore();
    });
  });

  describe("POST /api/v1/reviews", () => {
    it("processes the review normally when the honeypot is absent", async () => {
      const res = await request(app).post("/api/v1/reviews").send(validReview);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(await Review.countDocuments()).toBe(1);
    });

    it("fakes success and stores nothing when the honeypot is filled", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});

      const res = await request(app)
        .post("/api/v1/reviews")
        .send({ ...validReview, website: "acme-seo-backlinks.example" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Thank you for your review!");

      expect(await Review.countDocuments()).toBe(0);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/\[honeypot\] review submission rejected/);

      warn.mockRestore();
    });
  });
});
