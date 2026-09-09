// controllers/pos/paymentController.js had no test file, despite being a money
// path: it records what a customer handed over at the counter, and it opens a
// public Paystack charge for an outstanding repair balance.
//
// These tests pin the guarantees that must survive a refactor:
//   · a recorded payment cannot be negative, and cannot skip its method
//   · job parts leave stock ONCE, however many payments are recorded
//   · the public balance endpoint proves who is asking before it charges
//   · the amount charged is computed from the job, never taken from the request
// Stub the SDK the way the checkout suites do, so the balance charge exercises
// the real controller path without reaching the network.
jest.mock("@paystack/paystack-sdk", () => {
  class Paystack {
    get transaction() {
      return {
        initialize: jest.fn(async ({ amount, reference }) => ({
          status: true,
          data: { authorization_url: "https://pay.example/c", access_code: "acc", reference, amount },
        })),
      };
    }
  }
  return Paystack;
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");
const PosPayment = require("../models/PosPayment");

async function staff(role = "staff") {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  return { user, token: jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET) };
}

async function makeJob(over = {}) {
  const phone = `024${Math.floor(1000000 + Math.random() * 8999999)}`;
  const customer = await PosCustomer.create({ phone, name: "Ama" });
  const job = await RepairJob.create({
    customer: customer._id,
    faultDescription: "Cracked screen",
    laborCost: 5000,
    depositPaid: 0,
    ...over,
  });
  return { job, customer, phone };
}

const pay = (jobId, token, body) =>
  request(app).post(`/api/v1/pos/jobs/${jobId}/payments`)
    .set("Authorization", `Bearer ${token}`).send(body);

describe("POST /pos/jobs/:id/payments — recording money taken at the counter", () => {
  it("records a payment against the job", async () => {
    const { token, user } = await staff();
    const { job } = await makeJob();

    const res = await pay(job._id, token, { amount: 5000, method: "cash" });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(5000);
    expect(res.body.data.method).toBe("cash");
    const stored = await PosPayment.findOne({ job: job._id });
    expect(stored.amount).toBe(5000);
    // Who took the money is part of the record, not an optional extra.
    expect(String(stored.receivedBy)).toBe(String(user._id));
  });

  it("refuses a payment with no amount or no method", async () => {
    const { token } = await staff();
    const { job } = await makeJob();

    expect((await pay(job._id, token, { method: "cash" })).status).toBe(400);
    expect((await pay(job._id, token, { amount: 5000 })).status).toBe(400);
    expect(await PosPayment.countDocuments({ job: job._id })).toBe(0);
  });

  it("refuses a NEGATIVE amount — it would reduce what the customer owes", async () => {
    const { token } = await staff();
    const { job } = await makeJob();

    const res = await pay(job._id, token, { amount: -5000, method: "cash" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await PosPayment.countDocuments({ job: job._id })).toBe(0);
  });

  it("refuses a method the till does not take", async () => {
    const { token } = await staff();
    const { job } = await makeJob();

    const res = await pay(job._id, token, { amount: 5000, method: "cheque" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await PosPayment.countDocuments({ job: job._id })).toBe(0);
  });

  it("404s for a job that does not exist", async () => {
    const { token } = await staff();
    const res = await pay("6a9d000000000000000000aa", token, { amount: 100, method: "cash" });
    expect(res.status).toBe(404);
  });

  it("is closed to customers", async () => {
    const { token } = await staff("user");
    const { job } = await makeJob();

    const res = await pay(job._id, token, { amount: 5000, method: "cash" });

    expect(res.status).toBe(403);
  });

  describe("inventory", () => {
    async function jobWithPart(stock = 10) {
      const part = await Product.create({
        name: "Screen", slug: `screen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        price: 8000, category: "Parts", stock,
      });
      const { job } = await makeJob({
        parts: [{ part: part._id, name: "Screen", quantity: 2, priceAtTime: 8000, costAtTime: 5000 }],
      });
      return { job, part };
    }

    it("takes the parts out of stock when the first payment lands", async () => {
      const { token } = await staff();
      const { job, part } = await jobWithPart(10);

      await pay(job._id, token, { amount: 1000, method: "cash" });

      expect((await Product.findById(part._id)).stock).toBe(8);
      expect((await RepairJob.findById(job._id)).stockDeducted).toBe(true);
    });

    it("does NOT take them out again on a second payment", async () => {
      // A repair is routinely paid in two parts — a deposit, then the balance.
      // Deducting per payment would empty the shelf twice for one repair.
      const { token } = await staff();
      const { job, part } = await jobWithPart(10);

      await pay(job._id, token, { amount: 1000, method: "cash" });
      await pay(job._id, token, { amount: 4000, method: "momo" });

      expect((await Product.findById(part._id)).stock).toBe(8);
      expect(await PosPayment.countDocuments({ job: job._id })).toBe(2);
    });

    it("still records the payment when stock is short", async () => {
      // The money arrived whatever the shelf says. Refusing the payment would
      // lose the record of cash actually taken.
      const { token } = await staff();
      const { job, part } = await jobWithPart(1); // job needs 2

      const res = await pay(job._id, token, { amount: 1000, method: "cash" });

      expect(res.status).toBe(201);
      const fresh = await Product.findById(part._id);
      expect(fresh.stock).toBeGreaterThanOrEqual(0); // never driven negative
    });
  });
});

describe("POST /track/:token/balance-payment — the customer paying online", () => {
  const balance = (token, body) =>
    request(app).post(`/api/v1/track/${token}/balance-payment`).send(body);

  it("refuses a phone that does not match the job", async () => {
    // The only thing standing between a guessed tracking token and someone
    // else's repair record.
    const { job } = await makeJob({ laborCost: 20000 });

    const res = await balance(job.trackingToken, { phone: "0209999999" });

    expect(res.status).toBe(403);
  });

  it("requires a phone at all", async () => {
    const { job } = await makeJob({ laborCost: 20000 });
    const res = await balance(job.trackingToken, {});
    expect(res.status).toBe(400);
  });

  it("404s on an unknown tracking token", async () => {
    const res = await balance("not-a-real-token", { phone: "0244000000" });
    expect(res.status).toBe(404);
  });

  it("refuses when the repair is already settled", async () => {
    const { token: staffToken } = await staff();
    const { job, phone } = await makeJob({ laborCost: 5000, depositPaid: 0 });
    await pay(job._id, staffToken, { amount: 5000, method: "cash" });

    const res = await balance(job.trackingToken, { phone });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing is outstanding/i);
  });

  it("never charges an amount the caller supplied", async () => {
    // The request body carries a phone and nothing else that matters. If a
    // client could name the amount, it could settle a GH₵500 repair for 1p.
    const { job, phone } = await makeJob({ laborCost: 50000, depositPaid: 0 });

    const res = await balance(job.trackingToken, { phone, amount: 1, amountPesewas: 1 });

    expect(res.status).toBe(200);
    // The balance computed from the job, not the 1p the caller asked for.
    expect(res.body.data.amountPesewas).toBe(50000);

    const fresh = await RepairJob.findById(job._id);
    expect(fresh.balancePayments).toHaveLength(1);
    expect(fresh.balancePayments[0].amountPesewas).toBe(50000);
    expect(fresh.balancePayments[0].status).toBe("pending");
  });
});

// Two people at the counter can settle one repair at the same moment — a
// deposit taken on the tablet while the balance goes through the till. The
// stock deduction is guarded by `job.stockDeducted`, but reading that flag,
// deducting, and writing it back is three steps: two concurrent payments can
// both read `false` and both empty the shelf for one repair.
describe("POST /pos/jobs/:id/payments — concurrent payments deduct stock once", () => {
  async function jobWithPart(stock) {
    const part = await Product.create({
      name: "Screen", slug: `screen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      price: 8000, category: "Parts", stock,
    });
    const { job } = await makeJob({
      parts: [{ part: part._id, name: "Screen", quantity: 2, priceAtTime: 8000, costAtTime: 5000 }],
    });
    return { job, part };
  }

  it("deducts once when two payments land together", async () => {
    const { token } = await staff();
    const { job, part } = await jobWithPart(10);

    await Promise.all([
      pay(job._id, token, { amount: 1000, method: "cash" }),
      pay(job._id, token, { amount: 4000, method: "momo" }),
    ]);

    // 2 parts off a shelf of 10 — once, not twice.
    expect((await Product.findById(part._id)).stock).toBe(8);
    expect(await PosPayment.countDocuments({ job: job._id })).toBe(2);
  });

  it("deducts once when several land together", async () => {
    const { token } = await staff();
    const { job, part } = await jobWithPart(10);

    await Promise.all(
      [1000, 1000, 1000, 1000, 1000].map((amount) => pay(job._id, token, { amount, method: "cash" })),
    );

    expect((await Product.findById(part._id)).stock).toBe(8);
    expect(await PosPayment.countDocuments({ job: job._id })).toBe(5);
  });
});
