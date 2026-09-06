// T125 — Order.customer fields are guest-supplied and were bounded only by
// express.json({ limit: '5mb' }), with no email format check. Two concrete
// consequences, neither of them XSS (app.js runs middleware/sanitizeInput globally and it
// traverses nested objects):
//   1. a single order could carry a multi-megabyte address, and getOrders
//      renders those to admins on a 512MB heap
//   2. "not-an-email" was accepted, turning a paid order's confirmation and
//      invoice into a silent Resend delivery failure
//
// These exercise the MODEL, which is the durable guarantee — createOrder is not
// the only writer.
const Order = require("../models/Order");

const base = () => ({
  orderNumber: "ORD-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
  items: [{ product: "6a9377b3e842391fcae57fb7", name: "Thing", price: 1000, qty: 1 }],
  subtotal: 1000,
  total: 1000,
  customer: { name: "Ama", phone: "0241234567" },
  paystackReference: "ref_" + Math.random().toString(36).slice(2),
});

async function validationError(doc) {
  try {
    await new Order(doc).validate();
    return null;
  } catch (e) {
    return e;
  }
}

describe("Order.customer input limits (T125)", () => {
  it("accepts a normal guest order", async () => {
    expect(await validationError(base())).toBeNull();
  });

  it("rejects an address beyond the cap instead of storing it verbatim", async () => {
    const doc = base();
    doc.customer.address = "x".repeat(100000); // the repro from the audit
    const err = await validationError(doc);
    expect(err).not.toBeNull();
    expect(err.errors["customer.address"]).toBeDefined();
  });

  it("accepts an address at the cap", async () => {
    const doc = base();
    doc.customer.address = "x".repeat(500);
    expect(await validationError(doc)).toBeNull();
  });

  it("rejects a malformed email rather than silently failing delivery later", async () => {
    const doc = base();
    doc.customer.email = "not-an-email"; // the repro from the audit
    const err = await validationError(doc);
    expect(err).not.toBeNull();
    expect(err.errors["customer.email"]).toBeDefined();
  });

  it("still allows an absent email — it is optional", async () => {
    const doc = base();
    doc.customer.email = "";
    expect(await validationError(doc)).toBeNull();
  });

  it("accepts a well-formed email", async () => {
    const doc = base();
    doc.customer.email = "Ama@Example.COM";
    expect(await validationError(doc)).toBeNull();
  });

  it("caps an over-long name", async () => {
    const doc = base();
    doc.customer.name = "A".repeat(101);
    const err = await validationError(doc);
    expect(err.errors["customer.name"]).toBeDefined();
  });
});
