const request = require("supertest");
const app = require("../app");
const Order = require("../models/Order");
const DeliveryZone = require("../models/DeliveryZone");

describe("GET /api/v1/orders/track/:trackingNumber", () => {
  it("returns minimal public tracking data with a sorted timeline", async () => {
    const zone = await DeliveryZone.create({ name: "Accra Central", fee: 1500, estimatedDays: 1, isActive: true });

    const order = await Order.create({
      orderNumber: "EZW-TEST-1",
      trackingNumber: "EZWTRK-ABC123",
      items: [
        { name: "iPhone 15 OLED Screen", price: 55000, qty: 1 },
      ],
      subtotal: 55000,
      deliveryZone: zone._id,
      deliveryFee: 1500,
      total: 56500,
      customer: { name: "Kofi A.", phone: "0240000000" },
      status: "shipped",
      trackingHistory: [
        { status: "pending", note: "Order placed", timestamp: new Date(Date.now() - 2000) },
        { status: "paid", note: "Payment confirmed", timestamp: new Date(Date.now() - 1000) },
        { status: "shipped", note: "Handed to courier", location: "Accra depot", timestamp: new Date() },
      ],
    });

    const res = await request(app).get("/api/v1/orders/track/EZWTRK-ABC123");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.trackingNumber).toBe("EZWTRK-ABC123");
    expect(d.orderNumber).toBe("EZW-TEST-1");
    expect(d.status).toBe("shipped");
    expect(d.destination).toBe("Accra Central");
    expect(d.history).toHaveLength(3);
    // history is chronological — pending first, shipped last
    expect(d.history[0].status).toBe("pending");
    expect(d.history[2].status).toBe("shipped");
    expect(d.latestEvent.status).toBe("shipped");
    expect(d.latestEvent.location).toBe("Accra depot");
    // No customer data, items, or money leak out.
    expect(d).not.toHaveProperty("items");
    expect(d).not.toHaveProperty("customer");
    expect(d).not.toHaveProperty("subtotal");
    expect(d).not.toHaveProperty("total");
    expect(d).not.toHaveProperty("paystackReference");
  });

  it("matches case-insensitively", async () => {
    await Order.create({
      orderNumber: "EZW-TEST-2",
      trackingNumber: "EZWTRK-LOWERCASE",
      items: [],
      subtotal: 0,
      total: 0,
      customer: { name: "Ama", phone: "0241111111" },
      status: "pending",
    });

    const res = await request(app).get("/api/v1/orders/track/ezwtrk-lowercase");
    expect(res.status).toBe(200);
    expect(res.body.data.trackingNumber).toBe("EZWTRK-LOWERCASE");
  });

  it("404s for an unknown tracking number", async () => {
    const res = await request(app).get("/api/v1/orders/track/EZWTRK-NOPE");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
