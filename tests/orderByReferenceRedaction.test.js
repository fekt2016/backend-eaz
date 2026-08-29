// T86: GET /orders/by-reference/:reference needs no auth and returned the whole
// order document — full name, phone, email, delivery address, line items,
// totals. A payment reference travels: shared confirmation links, forwarded
// emails, browser history, referrer headers. The sibling public route,
// getOrderTracking, already redacted the same fields.
const request = require("supertest");
const app = require("../app");
const Order = require("../models/Order");

const REF = "ORD_1756400000000_a1b2c3d4";

const PII = {
  name: "Ama Owusu",
  email: "ama.owusu@example.com",
  phone: "0244000111",
  address: "12 Independence Ave, House 4B",
};

async function makeOrder(over = {}) {
  return Order.create({
    orderNumber: "EZW-0001",
    paystackReference: REF,
    status: "paid",
    customer: { ...PII },
    items: [{ name: "Screen Protector", qty: 2, price: 1500 }],
    subtotal: 3000, total: 4500, shippingFee: 1500,
    shippingMethod: "in_house_delivery",
    shippingRegion: "Greater Accra",
    shippingNeighborhood: "Osu",
    shippingZoneName: "Zone A",
    ...over,
  });
}

const fetchPublic = () => request(app).get(`/api/v1/orders/by-reference/${REF}`);

describe("GET /orders/by-reference — redaction (T86)", () => {
  it("returns no email, street address, or full phone anywhere in the payload", async () => {
    await makeOrder();

    const res = await fetchPublic();

    expect(res.status).toBe(200);
    // Scan the whole serialized body: a projection that misses a nested copy is
    // still a leak, and this catches one wherever it hides.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(PII.email);
    expect(body).not.toContain(PII.address);
    expect(body).not.toContain(PII.phone);
    expect(body).not.toContain("Owusu"); // surname
  });

  it("still shows enough for the customer to recognise their order", async () => {
    await makeOrder();

    const { body } = await fetchPublic();
    const d = body.data;

    expect(d.orderNumber).toBe("EZW-0001");
    expect(d.status).toBe("paid");
    expect(d.total).toBe(4500);
    expect(d.items).toEqual([
      { name: "Screen Protector", qty: 2, price: 1500, isPreorder: false },
    ]);
    // Masked, not removed — "is this mine?" must still be answerable.
    expect(d.customer.name).toBe("Ama O.");
    expect(d.customer.phone).toBe("•••••••111");
  });

  it("keeps area-level shipping fields, which the tracking route already exposes", async () => {
    await makeOrder();

    const { body } = await fetchPublic();

    expect(body.data.shippingNeighborhood).toBe("Osu");
    expect(body.data.shippingZoneName).toBe("Zone A");
    expect(body.data.shippingRegion).toBe("Greater Accra");
    // Which neighbourhood, never which door.
    expect(body.data.customer.address).toBeUndefined();
  });

  it("masks a single-word name without inventing an initial", async () => {
    await makeOrder({ customer: { ...PII, name: "Ama" } });

    const { body } = await fetchPublic();

    expect(body.data.customer.name).toBe("Ama");
  });

  it("uses the last name part, not the second, for a multi-part name", async () => {
    // The Order model requires a name and a phone, so the empty case is
    // unreachable through the API — this is the realistic edge instead.
    await makeOrder({ customer: { ...PII, name: "Ama Serwaa  owusu" } });

    const { body } = await fetchPublic();

    expect(body.data.customer.name).toBe("Ama O.");
  });

  it("masks a phone written in international form", async () => {
    await makeOrder({ customer: { ...PII, phone: "+233 24 400 0111" } });

    const { body } = await fetchPublic();

    expect(body.data.customer.phone).toMatch(/^•+111$/);
    expect(JSON.stringify(body)).not.toContain("400 0111");
  });

  it("still 404s an unknown reference", async () => {
    const res = await request(app).get("/api/v1/orders/by-reference/ORD_nope");

    expect(res.status).toBe(404);
  });
});
