// The Resend SDK RESOLVES with { data: null, error } for every API-level
// rejection — an unverified from-domain, a bad key, a rate limit, a suppressed
// recipient — and throws only when the request never reaches them. `send()`
// awaited it inside a try/catch and logged status:'sent' on anything that did
// not throw, so EmailLog filled with successes for mail nobody received. That is
// invisible in exactly the way that matters: the admin Email log said delivered.
//
// RESEND_API_KEY is set before the first require of ../utils/email — the module
// decides once, at import time, whether it has a live client (same reasoning as
// shopTransactionalEmails.test.js).
process.env.RESEND_API_KEY = "re_test_dummy";

const mockResendSend = jest.fn();
jest.mock("resend", () => ({
  Resend: class {
    constructor() {
      this.emails = { send: mockResendSend };
    }
  },
}));

const EmailLog = require("../models/EmailLog");
const { send } = require("../utils/email");

beforeEach(() => {
  mockResendSend.mockReset();
});

describe("send() reads Resend's result, not just the absence of a throw", () => {
  it("records a rejected send as failed, with Resend's reason", async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The eazworld.co domain is not verified." },
    });

    const ok = await send({ to: "cust@example.com", subject: "Hi", html: "<p>x</p>", type: "welcome" });

    expect(ok).toBe(false);
    const log = await EmailLog.findOne({ to: "cust@example.com" });
    expect(log.status).toBe("failed");
    expect(log.error).toMatch(/not verified/i);
  });

  it("records a genuine send as sent, keeping Resend's message id", async () => {
    mockResendSend.mockResolvedValue({ data: { id: "msg_abc123" }, error: null });

    const ok = await send({ to: "ok@example.com", subject: "Hi", html: "<p>x</p>", type: "welcome" });

    expect(ok).toBe(true);
    const log = await EmailLog.findOne({ to: "ok@example.com" });
    expect(log.status).toBe("sent");
    // The only handle for looking the message up in Resend when a customer says
    // it never arrived.
    expect(log.meta.resendId).toBe("msg_abc123");
  });

  it("still records a transport failure (a real throw) as failed", async () => {
    mockResendSend.mockRejectedValue(new Error("ECONNRESET"));

    const ok = await send({ to: "down@example.com", subject: "Hi", html: "<p>x</p>", type: "welcome" });

    expect(ok).toBe(false);
    const log = await EmailLog.findOne({ to: "down@example.com" });
    expect(log.status).toBe("failed");
    expect(log.error).toMatch(/ECONNRESET/);
  });
});

// hostingEmail and renewalJob each held their own Resend client repeating the
// same mistake, and their own default from-address — hostingEmail's disagreed
// with email.js's. Routing them through send() means one place to fix.
describe("hosting mail goes through the shared sender", () => {
  it("a rejected credentials email is logged failed, not sent", async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Domain not verified" },
    });
    const { sendHostingCredentials } = require("../utils/hostingEmail");

    await sendHostingCredentials(
      { _id: undefined, planType: "shared", tier: "deluxe", customer: { name: "A", email: "host@example.com" } },
      { username: "u1", password: "p1", domain: "site.com" }
    );

    const log = await EmailLog.findOne({ to: "host@example.com" });
    expect(log.status).toBe("failed");
    expect(log.type).toBe("hosting_credentials");
  });
});
