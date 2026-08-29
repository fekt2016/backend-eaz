// T94 + T90 — the two webhook gates.
//
// T94: the HMAC was compared with `!==`, which short-circuits on the first
// differing byte. A timing side channel; impractical to exploit remotely against
// SHA-512, but there is no reason to leave it.
//
// T90: amountMismatch() returned false — "no mismatch" — whenever the expected
// amount was missing or zero, so such an order fulfilled for ANY charged amount,
// including 1 pesewa. It was an escape hatch for pre-*Pesewas orders. Checked
// against the live database 2026-08-29: every affected collection is empty, so
// the hatch protected nothing.
const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const HostingOrder = require("../models/HostingOrder");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");

const SECRET = process.env.PAYSTACK_SECRET;
const REF = "PSK_T90_ref_001";

const sign = (payload) =>
  crypto.createHmac("sha512", SECRET).update(JSON.stringify(payload)).digest("hex");

function chargePayload(amountPesewas) {
  return {
    event: "charge.success",
    data: { reference: REF, amount: amountPesewas, currency: "GHS", status: "success" },
  };
}

function post(payload, signature) {
  const req = request(app).post("/api/webhooks/paystack").set("Content-Type", "application/json");
  if (signature !== undefined) req.set("x-paystack-signature", signature);
  return req.send(payload);
}

describe("webhook signature verification (T94)", () => {
  const payload = chargePayload(1000);

  it("rejects a missing signature header with 400", async () => {
    const res = await post(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it("rejects a wrong signature of the correct length", async () => {
    // Same length as a real digest, so it reaches timingSafeEqual rather than
    // being short-circuited by the length guard.
    const wrong = "a".repeat(sign(payload).length);
    const res = await post(payload, wrong);
    expect(res.status).toBe(400);
  });

  it("rejects a signature of the wrong length without throwing", async () => {
    // timingSafeEqual throws on unequal buffer lengths — the guard must catch
    // this first, or a short header would 500 instead of 400.
    const res = await post(payload, "abc123");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it("rejects a signature that differs only in the last byte", async () => {
    const good = sign(payload);
    const tweaked = good.slice(0, -1) + (good.at(-1) === "a" ? "b" : "a");
    const res = await post(payload, tweaked);
    expect(res.status).toBe(400);
  });

  it("accepts a correctly signed body", async () => {
    // No matching order, so it is not fulfilled — but it must pass the gate
    // rather than being turned away as a bad signature.
    const res = await post(payload, sign(payload));
    // `.not.toMatch` throws on undefined, and "no error at all" is a pass here.
    expect(String(res.body.error || "")).not.toMatch(/signature/i);
  });
});

describe("webhook amount verification (T90)", () => {
  async function hostingOrder(fields) {
    const owner = await User.create({
      name: "Ama", email: `ama-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
      password: "Password123!", isVerified: true,
    });
    return HostingOrder.create({
      user: owner._id,
      planType: "shared", tier: "starter", billingCycle: "monthly",
      customer: { name: "Ama Owusu", email: "ama@example.com", phone: "0244000111" },
      paymentMethod: "paystack_card",
      paystackReference: REF,
      status: "pending",
      ...fields,
    });
  }

  it("refuses a charge when no expected amount can be determined", async () => {
    // The bug: this fulfilled for any amount, including 1 pesewa.
    await hostingOrder({ amount: 0, amountPesewas: 0 });
    const payload = chargePayload(1);

    const res = await post(payload, sign(payload));

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("amount_unverifiable");
    const fresh = await HostingOrder.findOne({ paystackReference: REF });
    expect(fresh.status).toBe("pending"); // not fulfilled
  });

  it("records the reason so an operator can see the held charge", async () => {
    await hostingOrder({ amount: 0, amountPesewas: 0 });
    const payload = chargePayload(1);

    await post(payload, sign(payload));

    const entry = await ActivityLog.findOne({ resourceId: REF }).sort({ createdAt: -1 });
    expect(entry).not.toBeNull();
    expect(entry.status).toBe("failure");
    expect(entry.metadata.reason).toBe("amount_unverifiable");
  });

  it("still distinguishes a genuine amount mismatch", async () => {
    await hostingOrder({ amount: 50, amountPesewas: 5000 });
    const payload = chargePayload(100); // charged 1 GHS for a 50 GHS order

    const res = await post(payload, sign(payload));

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("amount_mismatch");
  });

  it("rejects a non-GHS charge for the right amount", async () => {
    await hostingOrder({ amount: 50, amountPesewas: 5000 });
    const payload = {
      event: "charge.success",
      data: { reference: REF, amount: 5000, currency: "USD", status: "success" },
    };

    const res = await post(payload, sign(payload));

    expect(res.body.reason).toBe("currency_mismatch");
  });

  it("lets a correctly priced charge through the amount gate", async () => {
    await hostingOrder({ amount: 50, amountPesewas: 5000 });
    const payload = chargePayload(5000);

    const res = await post(payload, sign(payload));

    expect(res.body.reason).toBeUndefined();
    expect(res.status).not.toBe(400);
  });
});
