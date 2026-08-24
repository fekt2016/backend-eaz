// T17: registration now accepts email OR phone (previously email-required).
// Backend half only — see frontend-eaz/tasks.md -> T17 for the register form.
jest.mock("../utils/email", () => {
  const actual = jest.requireActual("../utils/email");
  return {
    ...actual,
    sendVerificationPin: jest.fn(async () => {}),
    sendWelcomeEmail: jest.fn(async () => {}),
  };
});
jest.mock("../services/notify", () => {
  const actual = jest.requireActual("../services/notify");
  return {
    ...actual,
    sendVerificationPinSms: jest.fn(async () => true),
  };
});

const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
const { sendVerificationPin, sendWelcomeEmail } = require("../utils/email");
const { sendVerificationPinSms } = require("../services/notify");

describe("POST /api/v1/auth/register — email OR phone", () => {
  it("still registers with email only (regression)", async () => {
    const email = `reg-${Date.now()}@t.com`;
    const res = await request(app).post("/api/v1/auth/register")
      .send({ name: "Email User", email, password: "Password123!" });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(email);
    expect(sendVerificationPin).toHaveBeenCalled();
    expect(sendVerificationPinSms).not.toHaveBeenCalled();
  });

  it("registers with phone only — no email at all", async () => {
    const phone = "0209990001";
    const res = await request(app).post("/api/v1/auth/register")
      .send({ name: "Phone User", phone, password: "Password123!" });

    expect(res.status).toBe(201);
    expect(res.body.data.phone).toBe(phone);
    expect(res.body.data.email).toBeUndefined();
    expect(res.body.data.message).toMatch(/phone/i);
    expect(sendVerificationPinSms).toHaveBeenCalledWith(phone, "Phone User", expect.stringMatching(/^\d{6}$/));
    expect(sendVerificationPin).not.toHaveBeenCalled();

    const stored = await User.findOne({ phone });
    expect(stored.email).toBeUndefined();
  });

  it("rejects both email and phone missing", async () => {
    const res = await request(app).post("/api/v1/auth/register")
      .send({ name: "Nobody", password: "Password123!" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email or phone/i);
  });

  it("rejects empty-string email and empty-string phone (not just omitted keys)", async () => {
    const res = await request(app).post("/api/v1/auth/register")
      .send({ name: "Blank", email: "", phone: "", password: "Password123!" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email or phone/i);
  });

  it("allows multiple phone-only accounts to coexist (partial unique index on email)", async () => {
    const a = await request(app).post("/api/v1/auth/register")
      .send({ name: "A", phone: "0209990002", password: "Password123!" });
    const b = await request(app).post("/api/v1/auth/register")
      .send({ name: "B", phone: "0209990003", password: "Password123!" });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await User.countDocuments({ email: { $exists: false } })).toBe(2);
  });
});

describe("POST /api/v1/auth/verify-pin and /resend-pin — accept phone identifier", () => {
  async function registerPhoneOnly(phone = "0209990004", name = "Phone Verify") {
    await request(app).post("/api/v1/auth/register").send({ name, phone, password: "Password123!" });
    const [, , pin] = sendVerificationPinSms.mock.calls.at(-1);
    return pin;
  }

  it("verifies a phone-only account by submitting phone (no email exists to submit)", async () => {
    const phone = "0209990005";
    const pin = await registerPhoneOnly(phone, "Verify Me");

    const res = await request(app).post("/api/v1/auth/verify-pin").send({ phone, pin });
    expect(res.status).toBe(200);

    const user = await User.findOne({ phone });
    expect(user.isVerified).toBe(true);
    // No email on the account — welcome email must not be attempted.
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it("resends a PIN by phone and delivers it via SMS again, not email", async () => {
    const phone = "0209990006";
    await registerPhoneOnly(phone, "Resend Me");
    sendVerificationPinSms.mockClear();

    const res = await request(app).post("/api/v1/auth/resend-pin").send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/phone/i);
    expect(sendVerificationPinSms).toHaveBeenCalledTimes(1);
    expect(sendVerificationPin).not.toHaveBeenCalled();
  });

  it("rejects verify-pin with an identifier that is neither a valid email nor phone shape", async () => {
    const res = await request(app).post("/api/v1/auth/verify-pin").send({ email: "nope", pin: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid email or phone/i);
  });
});
