const request = require("supertest");
const app = require("../app");

describe("GET /api/health", () => {
  it("reports OK when the database is connected", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OK");
    expect(res.body.database).toBe("connected");
    expect(res.body).toHaveProperty("timestamp");
  });
});

describe("unknown routes", () => {
  it("returns a 404 envelope", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
