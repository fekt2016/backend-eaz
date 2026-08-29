// T84: shop orders are guest checkouts with no `user` ref, so they are matched
// to an account by customer email / phone. updateProfile let any logged-in user
// set `phone` to any number no *account* already held — and a guest victim has
// no account, so their number was free. Setting it handed over their order
// history. A phone now binds only after an SMS PIN proves control of it.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");

jest.mock("../services/notify", () => ({
  ...jest.requireActual("../services/notify"),
  sendVerificationPinSms: jest.fn().mockResolvedValue(undefined),
}));
const { sendVerificationPinSms } = require("../services/notify");

const VICTIM_PHONE = "0244000111";

async function makeUser(over = {}) {
  const user = await User.create({
    name: "Attacker",
    email: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    isVerified: true,
    ...over,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

const patchProfile = (token, body) =>
  request(app).patch("/api/v1/auth/me").set("Authorization", `Bearer ${token}`).send(body);

beforeEach(() => jest.clearAllMocks());

describe("PATCH /auth/me — a phone change is parked, not applied (T84)", () => {
  it("does not write the number, and says verification is required", async () => {
    const { user, token } = await makeUser();

    const res = await patchProfile(token, { name: "Attacker", phone: VICTIM_PHONE });

    expect(res.status).toBe(200);
    expect(res.body.phoneVerificationRequired).toBe(true);
    expect(res.body.data.user.phone).toBeFalsy();

    // The claim must not reach the database — this is the whole vulnerability.
    const fresh = await User.findById(user._id).select("+pendingPhone");
    expect(fresh.phone).toBeFalsy();
    expect(fresh.phoneVerifiedAt).toBeNull();
    expect(fresh.pendingPhone).toBe(VICTIM_PHONE);
  });

  it("sends the PIN to the new number, not the account's current one", async () => {
    const { token } = await makeUser({ phone: "0209999999", phoneVerifiedAt: new Date() });

    await patchProfile(token, { name: "Attacker", phone: VICTIM_PHONE });

    expect(sendVerificationPinSms).toHaveBeenCalledTimes(1);
    expect(sendVerificationPinSms.mock.calls[0][0]).toBe(VICTIM_PHONE);
  });

  it("still saves the name, and leaves an unchanged phone alone", async () => {
    const { user, token } = await makeUser({ phone: "0209999999", phoneVerifiedAt: new Date() });

    const res = await patchProfile(token, { name: "New Name", phone: "0209999999" });

    expect(res.body.phoneVerificationRequired).toBe(false);
    expect(sendVerificationPinSms).not.toHaveBeenCalled();
    const fresh = await User.findById(user._id);
    expect(fresh.name).toBe("New Name");
    expect(fresh.phone).toBe("0209999999");
    expect(fresh.phoneVerifiedAt).not.toBeNull(); // not re-set by a no-op
  });

  it("lets a user clear their phone without a PIN — that claims nothing", async () => {
    const { user, token } = await makeUser({ phone: "0209999999", phoneVerifiedAt: new Date() });

    const res = await patchProfile(token, { name: "Attacker", phone: "" });

    expect(res.body.phoneVerificationRequired).toBe(false);
    const fresh = await User.findById(user._id);
    expect(fresh.phone).toBe("");
    expect(fresh.phoneVerifiedAt).toBeNull();
  });

  it("still refuses a number another account already holds", async () => {
    await makeUser({ phone: "0201112222", phoneVerifiedAt: new Date() });
    const { token } = await makeUser();

    const res = await patchProfile(token, { name: "Attacker", phone: "0201112222" });

    expect(res.status).toBe(409);
    expect(sendVerificationPinSms).not.toHaveBeenCalled();
  });
});

describe("POST /auth/me/phone/confirm (T84)", () => {
  async function park(token) {
    await patchProfile(token, { name: "Attacker", phone: VICTIM_PHONE });
    return sendVerificationPinSms.mock.calls[0][2]; // the PIN as texted
  }
  const confirm = (token, pin) =>
    request(app).post("/api/v1/auth/me/phone/confirm")
      .set("Authorization", `Bearer ${token}`).send({ pin });

  it("binds the number and stamps it verified when the PIN is right", async () => {
    const { user, token } = await makeUser();
    const pin = await park(token);

    const res = await confirm(token, pin);

    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id).select("+pendingPhone");
    expect(fresh.phone).toBe(VICTIM_PHONE);
    expect(fresh.phoneVerifiedAt).not.toBeNull();
    expect(fresh.pendingPhone).toBe(""); // consumed
  });

  it("refuses a wrong PIN and leaves the number unbound", async () => {
    const { user, token } = await makeUser();
    const pin = await park(token);

    const res = await confirm(token, pin === "000000" ? "111111" : "000000");

    expect(res.status).toBe(400);
    const fresh = await User.findById(user._id);
    expect(fresh.phone).toBeFalsy();
  });

  it("refuses an expired PIN", async () => {
    const { user, token } = await makeUser();
    const pin = await park(token);
    await User.updateOne({ _id: user._id }, { pendingPhonePinExpires: new Date(Date.now() - 1000) });

    const res = await confirm(token, pin);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
    expect((await User.findById(user._id)).phone).toBeFalsy();
  });

  it("refuses when nothing is awaiting confirmation", async () => {
    const { token } = await makeUser();

    const res = await confirm(token, "123456");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/awaiting confirmation/i);
  });

  it("re-checks uniqueness at bind time, not just when the change was asked for", async () => {
    const { token } = await makeUser();
    const pin = await park(token);
    // Someone else takes the number while the PIN is outstanding.
    await makeUser({ phone: VICTIM_PHONE, phoneVerifiedAt: new Date() });

    const res = await confirm(token, pin);

    expect(res.status).toBe(409);
  });
});
