// T64 — the Spaceship registrar service. axios is mocked throughout: Spaceship has
// NO sandbox, so a test that reached the real API would spend real money.
jest.mock("axios");

const axios = require("axios");
const spaceship = require("../services/spaceship");

// hasConfig() reads these at call time, and tests/setup.js blanks them so nothing
// can reach the live registrar by accident. Set them per-test instead.
function withCreds() {
  process.env.SPACESHIP_API_KEY = "test-key";
  process.env.SPACESHIP_API_SECRET = "test-secret";
}

// Pricing is no longer driven by env vars (owner decision 2026-08-31) — the rate
// and markup live in Settings.pricing and are read through the cache in
// services/pricingSettings. Setting the cache directly keeps these unit tests
// synchronous and free of a database.
const pricingSettings = require("../services/pricingSettings");

function setPricing(usdToGhsRate, domainMarkup) {
  jest.spyOn(pricingSettings, "getRate").mockReturnValue(usdToGhsRate);
  jest.spyOn(pricingSettings, "getMarkup").mockReturnValue(domainMarkup);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  withCreds();
  setPricing(15.5, 1.2);
});

afterEach(() => {
  process.env.SPACESHIP_API_KEY = "";
  process.env.SPACESHIP_API_SECRET = "";
});

describe("hasConfig", () => {
  it("is false when either credential is missing", () => {
    process.env.SPACESHIP_API_KEY = "";
    expect(spaceship.hasConfig()).toBe(false);

    withCreds();
    process.env.SPACESHIP_API_SECRET = "";
    expect(spaceship.hasConfig()).toBe(false);
  });

  it("is true when both are present", () => {
    expect(spaceship.hasConfig()).toBe(true);
  });
});

describe("usdToGhs", () => {
  it("applies the rate and markup, rounding up to whole cedis", () => {
    // 10.18 × 15.5 × 1.2 = 189.348 → 190
    expect(spaceship.usdToGhs(10.18)).toBe(190);
  });

  it("honours an admin-changed rate and markup", () => {
    setPricing(10, 2);
    expect(spaceship.usdToGhs(5)).toBe(100);
  });
});

describe("toE164", () => {
  it("converts a local Ghana number", () => {
    expect(spaceship.toE164("0551234987")).toBe("+233551234987");
  });

  it("leaves an already-prefixed number alone", () => {
    expect(spaceship.toE164("+233551234987")).toBe("+233551234987");
  });

  it("strips formatting characters", () => {
    expect(spaceship.toE164("055 123 4987")).toBe("+233551234987");
  });

  it("returns empty for empty input rather than a bare +", () => {
    expect(spaceship.toE164("")).toBe("");
  });
});

describe("getPricing", () => {
  it("returns GHS prices derived from the local cost table, with no network call", async () => {
    const prices = await spaceship.getPricing();
    expect(prices[".com"]).toBe(190);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe("checkDomain", () => {
  it("reports an available domain with its TLD price", async () => {
    axios.get.mockResolvedValueOnce({
      data: { domain: "mybiz.com", result: "available", premiumPricing: [] },
    });

    const result = await spaceship.checkDomain("MyBiz.com");
    expect(result).toEqual({ domain: "mybiz.com", available: true, price: 190 });
  });

  it("reports a taken domain as unavailable", async () => {
    axios.get.mockResolvedValueOnce({
      data: { domain: "cars.com", result: "taken", premiumPricing: [] },
    });

    const result = await spaceship.checkDomain("cars.com");
    expect(result.available).toBe(false);
  });

  it("uses the premium price when the API returns one, not the flat TLD price", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        domain: "shop.com",
        result: "available",
        premiumPricing: [{ operation: "register", price: 1000, currency: "USD" }],
      },
    });

    const result = await spaceship.checkDomain("shop.com");
    // 1000 × 15.5 × 1.2 = 18600 — must not fall back to the .com price of 190.
    expect(result.price).toBe(18600);
  });

  it("rejects an unsupported TLD locally without calling the API", async () => {
    const result = await spaceship.checkDomain("mybiz.com.gh");
    expect(result.available).toBe(false);
    expect(result.price).toBeNull();
    // T65: a Ghanaian TLD gets the "where to go instead" answer, not a flat no.
    expect(result.error).toMatch(/ghNIC-accredited registrar/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("returns unavailable without calling the API when unconfigured", async () => {
    process.env.SPACESHIP_API_KEY = "";
    const result = await spaceship.checkDomain("mybiz.com");
    expect(result).toEqual({ domain: "mybiz.com", available: false, price: null });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("surfaces the API's `detail` message on failure", async () => {
    axios.get.mockRejectedValueOnce({ response: { data: { detail: "Rate limit exceeded" } } });
    const result = await spaceship.checkDomain("mybiz.com");
    expect(result.available).toBe(false);
    expect(result.error).toBe("Rate limit exceeded");
  });
});

describe("checkMultipleDomains", () => {
  it("expands a base name across the given TLDs", async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        domains: [
          { domain: "mybiz.com", result: "available", premiumPricing: [] },
          { domain: "mybiz.net", result: "taken", premiumPricing: [] },
        ],
      },
    });

    const results = await spaceship.checkMultipleDomains("mybiz", [".com", ".net"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ domain: "mybiz.com", available: true, price: 190 });
    expect(results[1].available).toBe(false);
  });

  it("filters unsupported TLDs out of the upstream request but still returns them", async () => {
    axios.post.mockResolvedValueOnce({
      data: { domains: [{ domain: "mybiz.com", result: "available", premiumPricing: [] }] },
    });

    const results = await spaceship.checkMultipleDomains("mybiz", [".com", ".com.gh"]);

    // Only the sellable one is sent upstream...
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1]).toEqual({ domains: ["mybiz.com"] });

    // ...but the customer still hears about both.
    const gh = results.find((r) => r.domain === "mybiz.com.gh");
    expect(gh.available).toBe(false);
    expect(gh.error).toMatch(/ghNIC-accredited registrar/);
  });

  it("chunks at the API's 20-domain limit", async () => {
    const tlds = Array.from({ length: 25 }, (_, i) => `.t${i}`);
    axios.post.mockResolvedValue({ data: { domains: [] } });

    await spaceship.checkMultipleDomains("mybiz", tlds);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][1].domains).toHaveLength(20);
    expect(axios.post.mock.calls[1][1].domains).toHaveLength(5);
  });

  it("returns [] for an empty query without calling the API", async () => {
    expect(await spaceship.checkMultipleDomains("", [])).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe("registerDomain", () => {
  const registrant = {
    firstName: "Kwame",
    lastName: "Mensah",
    email: "kwame@example.com",
    phone: "0551234987",
    address: "12 Oxford St",
    city: "Accra",
    country: "GH",
  };

  it("saves a contact, registers, then polls the async operation to success", async () => {
    axios.put.mockResolvedValueOnce({ data: { contactId: "contact-123" } });
    axios.post.mockResolvedValueOnce({ headers: { "spaceship-async-operationid": "op-1" } });
    axios.get.mockResolvedValueOnce({ data: { status: "success" } });

    const result = await spaceship.registerDomain("mybiz.com", 2, registrant);
    expect(result).toEqual({ success: true });

    // The contact is normalised to E.164 before it reaches the registry.
    expect(axios.put.mock.calls[0][1].phone).toBe("+233551234987");

    const body = axios.post.mock.calls[0][1];
    expect(body.years).toBe(2);
    expect(body.contacts.registrant).toBe("contact-123");
    // Renewals are billed through our own orders, never by the registrar.
    expect(body.autoRenew).toBe(false);
  });

  it("clamps years to the registry's 1–10 range", async () => {
    axios.put.mockResolvedValue({ data: { contactId: "c" } });
    axios.post.mockResolvedValue({ headers: { "spaceship-async-operationid": "op" } });
    axios.get.mockResolvedValue({ data: { status: "success" } });

    await spaceship.registerDomain("a.com", 99, registrant);
    expect(axios.post.mock.calls[0][1].years).toBe(10);

    await spaceship.registerDomain("b.com", 0, registrant);
    expect(axios.post.mock.calls[1][1].years).toBe(1);
  });

  it("fails when the async operation reports failure", async () => {
    axios.put.mockResolvedValueOnce({ data: { contactId: "c" } });
    axios.post.mockResolvedValueOnce({ headers: { "spaceship-async-operationid": "op-2" } });
    axios.get.mockResolvedValueOnce({
      data: { status: "failed", details: { message: "Domain already taken" } },
    });

    const result = await spaceship.registerDomain("taken.com", 1, registrant);
    expect(result).toEqual({ success: false, error: "Domain already taken" });
  });

  it("fails rather than assuming success when no operation id comes back", async () => {
    axios.put.mockResolvedValueOnce({ data: { contactId: "c" } });
    axios.post.mockResolvedValueOnce({ headers: {} });

    const result = await spaceship.registerDomain("mybiz.com", 1, registrant);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/operation id/i);
  });

  it("refuses an unsupported TLD before spending anything", async () => {
    const result = await spaceship.registerDomain("mybiz.com.gh", 1, registrant);
    expect(result.success).toBe(false);
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("refuses when unconfigured", async () => {
    process.env.SPACESHIP_API_SECRET = "";
    const result = await spaceship.registerDomain("mybiz.com", 1, registrant);
    expect(result).toEqual({ success: false, error: "Spaceship API not configured" });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("still reports success when nameservers fail after a paid registration", async () => {
    axios.put
      .mockResolvedValueOnce({ data: { contactId: "c" } }) // contact
      .mockRejectedValueOnce({ response: { data: { detail: "NS rejected" } } }); // nameservers
    axios.post.mockResolvedValueOnce({ headers: { "spaceship-async-operationid": "op-3" } });
    axios.get.mockResolvedValueOnce({ data: { status: "success" } });

    // The money is already spent — reporting failure here would trigger a retry
    // that buys the domain twice.
    const result = await spaceship.registerDomain("mybiz.com", 1, registrant, {
      useEazWorldNameservers: true,
    });
    expect(result).toEqual({ success: true });
  });
});

describe("setEazWorldNameservers", () => {
  it("sends both nameservers as a custom provider", async () => {
    process.env.NAMESERVER_1 = "ns1.eazworld.com";
    process.env.NAMESERVER_2 = "ns2.eazworld.com";
    axios.put.mockResolvedValueOnce({ data: {} });

    const result = await spaceship.setEazWorldNameservers("MyBiz.com");
    expect(result).toEqual({ success: true });
    expect(axios.put.mock.calls[0][0]).toContain("/domains/mybiz.com/nameservers");
    expect(axios.put.mock.calls[0][1]).toEqual({
      provider: "custom",
      hosts: ["ns1.eazworld.com", "ns2.eazworld.com"],
    });
  });

  it("reports the API's error message on failure", async () => {
    axios.put.mockRejectedValueOnce({ response: { data: { detail: "Domain not found" } } });
    const result = await spaceship.setEazWorldNameservers("nope.com");
    expect(result).toEqual({ success: false, error: "Domain not found" });
  });

  it("refuses when unconfigured", async () => {
    process.env.SPACESHIP_API_KEY = "";
    const result = await spaceship.setEazWorldNameservers("mybiz.com");
    expect(result.success).toBe(false);
    expect(axios.put).not.toHaveBeenCalled();
  });
});
