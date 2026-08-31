// The Namecheap registrar service. axios is mocked throughout: registration
// against the live API spends real money, and the sandbox is opt-in, so a test
// must never reach either.
jest.mock("axios");

const axios = require("axios");
const namecheap = require("../services/namecheap");

// hasConfig() reads these at call time, and tests/setup.js blanks them so nothing
// can reach the live registrar by accident. Set them per-test instead.
function withCreds() {
  process.env.NAMECHEAP_API_USER = "eazworld";
  process.env.NAMECHEAP_API_KEY = "test-key";
  process.env.NAMECHEAP_CLIENT_IP = "1.2.3.4";
}

// Pricing is not driven by env vars (owner decision 2026-08-31) — the rate and
// markup live in Settings.pricing and are read through the cache in
// services/pricingSettings. Setting the cache directly keeps these unit tests
// synchronous and free of a database.
const pricingSettings = require("../services/pricingSettings");

function setPricing(usdToGhsRate, domainMarkup) {
  jest.spyOn(pricingSettings, "getRate").mockReturnValue(usdToGhsRate);
  jest.spyOn(pricingSettings, "getMarkup").mockReturnValue(domainMarkup);
}

// Namecheap answers in XML. These builders keep the tests readable rather than
// burying the assertion under a wall of angle brackets.
function xmlOk(commandResponseInner) {
  return {
    data: `<?xml version="1.0" encoding="utf-8"?>
      <ApiResponse Status="OK">
        <CommandResponse>${commandResponseInner}</CommandResponse>
      </ApiResponse>`,
  };
}

function xmlError(description, number = "2030280") {
  return {
    data: `<?xml version="1.0" encoding="utf-8"?>
      <ApiResponse Status="ERROR">
        <Errors><Error Number="${number}">${description}</Error></Errors>
      </ApiResponse>`,
  };
}

function checkResult(domain, available, extra = "") {
  return `<DomainCheckResult Domain="${domain}" Available="${available}" ${extra} />`;
}

// The availability paths warm the live cost cache first, so the FIRST axios call
// in those tests is always users.getPricing, not the check. This queues a failure
// for that warm-up specifically — so a test's own mockResolvedValueOnce lands on
// the check call — and leaves the same failure as the default for anything after.
// Without it the check response gets eaten by the pricing call and the local
// fallback table silently prices everything.
function pricingUnavailable() {
  axios.get.mockResolvedValue(xmlError("Pricing unavailable"));
  axios.get.mockResolvedValueOnce(xmlError("Pricing unavailable"));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  namecheap._resetPriceCache();
  withCreds();
  setPricing(15.5, 1.2);
});

afterEach(() => {
  process.env.NAMECHEAP_API_USER = "";
  process.env.NAMECHEAP_API_KEY = "";
  process.env.NAMECHEAP_CLIENT_IP = "";
  process.env.NAMECHEAP_SANDBOX = "";
});

describe("hasConfig", () => {
  it("is false when any credential is missing", () => {
    process.env.NAMECHEAP_API_KEY = "";
    expect(namecheap.hasConfig()).toBe(false);
    withCreds();
    process.env.NAMECHEAP_CLIENT_IP = "";
    expect(namecheap.hasConfig()).toBe(false);
  });

  it("is true when all three are present", () => {
    expect(namecheap.hasConfig()).toBe(true);
  });
});

describe("sandbox selection", () => {
  it("uses the sandbox host only when explicitly enabled", async () => {
    process.env.NAMECHEAP_SANDBOX = "true";
    pricingUnavailable();
    await namecheap.checkDomain("mybiz.com");
    expect(axios.get.mock.calls[0][0]).toContain("api.sandbox.namecheap.com");
  });

  it("uses the live host by default", async () => {
    pricingUnavailable();
    await namecheap.checkDomain("mybiz.com");
    expect(axios.get.mock.calls[0][0]).toContain("api.namecheap.com");
    expect(axios.get.mock.calls[0][0]).not.toContain("sandbox");
  });
});

describe("usdToGhs", () => {
  it("applies the rate and markup, rounding up to whole cedis", () => {
    // 10.18 × 15.5 × 1.2 = 189.348 → 190
    expect(namecheap.usdToGhs(10.18)).toBe(190);
  });

  it("honours an admin-changed rate and markup", () => {
    setPricing(20, 1.0);
    expect(namecheap.usdToGhs(5)).toBe(100);
  });
});

describe("toE164 / toNamecheapPhone", () => {
  it("converts a local Ghana number", () => {
    expect(namecheap.toE164("0551234987")).toBe("+233551234987");
  });

  it("leaves an already-prefixed number alone", () => {
    expect(namecheap.toE164("+233551234987")).toBe("+233551234987");
  });

  it("strips formatting characters", () => {
    expect(namecheap.toE164("055 123 4987")).toBe("+233551234987");
  });

  it("returns empty for empty input rather than a bare +", () => {
    expect(namecheap.toE164("")).toBe("");
    expect(namecheap.toNamecheapPhone("")).toBe("");
  });

  it("formats for Namecheap as +CC.NNNNNNNNN", () => {
    // The old service passed raw input straight through, which the API rejects
    // for any Ghanaian number typed the normal way.
    expect(namecheap.toNamecheapPhone("0551234987")).toBe("+233.551234987");
  });
});

describe("getPricing", () => {
  it("prefers live Namecheap cost over the local fallback table", async () => {
    axios.get.mockResolvedValueOnce(
      xmlOk(`<UserGetPricingResult><ProductType><ProductCategory>
        <Product Name="com"><Price Duration="1" YourAdditonalCost="20.00" /></Product>
      </ProductCategory></ProductType></UserGetPricingResult>`),
    );
    const prices = await namecheap.getPricing();
    // 20.00 × 15.5 × 1.2 = 372, not the 190 the local $10.18 would give.
    expect(prices[".com"]).toBe(372);
  });

  it("falls back to the local cost table when the pricing call fails", async () => {
    pricingUnavailable();
    const prices = await namecheap.getPricing();
    expect(prices[".com"]).toBe(190);
  });

  it("never offers a TLD we cannot sell", async () => {
    pricingUnavailable();
    const prices = await namecheap.getPricing();
    expect(prices[".gh"]).toBeUndefined();
    expect(prices[".com.gh"]).toBeUndefined();
  });

  it("offers .africa, which the previous registrar could not sell", async () => {
    pricingUnavailable();
    const prices = await namecheap.getPricing();
    expect(prices[".africa"]).toBeGreaterThan(0);
  });
});

describe("checkDomain", () => {
  it("reports an available domain with its TLD price", async () => {
    pricingUnavailable();
    axios.get.mockResolvedValueOnce(xmlOk(checkResult("mybiz.com", "true")));
    const result = await namecheap.checkDomain("MyBiz.com");
    expect(result).toMatchObject({ domain: "mybiz.com", available: true, price: 190 });
  });

  it("reports a taken domain as unavailable", async () => {
    pricingUnavailable();
    axios.get.mockResolvedValueOnce(xmlOk(checkResult("cars.com", "false")));
    const result = await namecheap.checkDomain("cars.com");
    expect(result).toMatchObject({ domain: "cars.com", available: false });
  });

  it("uses the premium price when the API returns one, not the flat TLD price", async () => {
    pricingUnavailable();
    axios.get.mockResolvedValueOnce(
      xmlOk(checkResult("shop.com", "true", 'IsPremiumName="true" PremiumRegistrationPrice="500.00"')),
    );
    const result = await namecheap.checkDomain("shop.com");
    // 500 × 15.5 × 1.2 = 9300 — the flat .com price would undercharge badly.
    expect(result.price).toBe(9300);
  });

  it("rejects an unsupported TLD locally without calling the API", async () => {
    const result = await namecheap.checkDomain("mybiz.com.gh");
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/ghNIC/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("returns unavailable without calling the API when unconfigured", async () => {
    process.env.NAMECHEAP_API_KEY = "";
    const result = await namecheap.checkDomain("mybiz.com");
    expect(result).toMatchObject({ available: false, price: null });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("surfaces the API's error Description on failure", async () => {
    axios.get.mockResolvedValue(xmlError("Invalid request IP"));
    const result = await namecheap.checkDomain("mybiz.com");
    expect(result.error).toBe("Invalid request IP");
  });
});

describe("checkMultipleDomains", () => {
  it("expands a base name across the given TLDs", async () => {
    pricingUnavailable();
    axios.get.mockResolvedValueOnce(
      xmlOk(checkResult("mybiz.com", "true") + checkResult("mybiz.net", "false")),
    );
    const results = await namecheap.checkMultipleDomains("mybiz", [".com", ".net"]);
    expect(results.map((r) => r.domain).sort()).toEqual(["mybiz.com", "mybiz.net"]);
  });

  it("filters unsupported TLDs out of the upstream request but still returns them", async () => {
    pricingUnavailable();
    axios.get.mockResolvedValueOnce(xmlOk(checkResult("mybiz.com", "true")));
    const results = await namecheap.checkMultipleDomains("mybiz", [".com", ".com.gh"]);

    const sent = axios.get.mock.calls.at(-1)[0];
    expect(sent).not.toContain("com.gh");

    const gh = results.find((r) => r.domain === "mybiz.com.gh");
    expect(gh).toMatchObject({ available: false, price: null });
    expect(gh.error).toMatch(/ghNIC/);
  });

  it("chunks at Namecheap's 50-domain limit", async () => {
    pricingUnavailable();
    const tlds = Array.from({ length: 60 }, (_, i) => `.t${i}`);
    axios.get.mockResolvedValue(xmlOk(""));
    await namecheap.checkMultipleDomains("mybiz", tlds);
    // one pricing warm-up call + two chunked check calls
    const checkCalls = axios.get.mock.calls.filter((c) => c[0].includes("domains.check"));
    expect(checkCalls).toHaveLength(2);
  });

  it("returns [] for an empty query without calling the API", async () => {
    expect(await namecheap.checkMultipleDomains("", [])).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("registerDomain", () => {
  const registrant = {
    firstName: "Ama",
    lastName: "Mensah",
    email: "ama@example.com",
    phone: "0551234987",
    address: "1 High St",
    city: "Accra",
    country: "GH",
  };

  it("registers in a single call and reports success", async () => {
    axios.get.mockResolvedValueOnce(
      xmlOk('<DomainCreateResult Domain="mybiz.com" Registered="true" />'),
    );
    const result = await namecheap.registerDomain("mybiz.com", 2, registrant);
    expect(result).toEqual({ success: true });

    const sent = axios.get.mock.calls[0][0];
    expect(sent).toContain("domains.create");
    expect(sent).toContain("Years=2");
  });

  it("sends the phone in Namecheap's +CC.NNNN format across all four contact roles", async () => {
    axios.get.mockResolvedValueOnce(
      xmlOk('<DomainCreateResult Domain="mybiz.com" Registered="true" />'),
    );
    await namecheap.registerDomain("mybiz.com", 1, registrant);

    const sent = decodeURIComponent(axios.get.mock.calls[0][0]);
    for (const role of ["Registrant", "Tech", "Admin", "AuxBilling"]) {
      expect(sent).toContain(`${role}.Phone=+233.551234987`);
    }
  });

  it("clamps years to the registry's 1-10 range", async () => {
    axios.get.mockResolvedValue(
      xmlOk('<DomainCreateResult Domain="a.com" Registered="true" />'),
    );
    await namecheap.registerDomain("a.com", 99, registrant);
    expect(axios.get.mock.calls[0][0]).toContain("Years=10");

    await namecheap.registerDomain("b.com", 0, registrant);
    expect(axios.get.mock.calls[1][0]).toContain("Years=1");
  });

  it("fails with the API's message when registration is refused", async () => {
    axios.get.mockResolvedValueOnce(xmlError("Domain is not available"));
    const result = await namecheap.registerDomain("taken.com", 1, registrant);
    expect(result).toEqual({ success: false, error: "Domain is not available" });
  });

  it("fails rather than assuming success when the result says not registered", async () => {
    axios.get.mockResolvedValueOnce(
      xmlOk('<DomainCreateResult Domain="mybiz.com" Registered="false" />'),
    );
    const result = await namecheap.registerDomain("mybiz.com", 1, registrant);
    expect(result.success).toBe(false);
  });

  it("refuses an unsupported TLD before spending anything", async () => {
    const result = await namecheap.registerDomain("mybiz.com.gh", 1, registrant);
    expect(result.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("refuses when unconfigured", async () => {
    process.env.NAMECHEAP_API_KEY = "";
    const result = await namecheap.registerDomain("mybiz.com", 1, registrant);
    expect(result.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("sets EazWorld nameservers at registration time when hosting was ordered", async () => {
    process.env.NAMESERVER_1 = "ns1.eazworld.com";
    process.env.NAMESERVER_2 = "ns2.eazworld.com";
    axios.get.mockResolvedValueOnce(
      xmlOk('<DomainCreateResult Domain="mybiz.com" Registered="true" />'),
    );
    await namecheap.registerDomain("mybiz.com", 1, registrant, {
      useEazWorldNameservers: true,
    });
    const sent = decodeURIComponent(axios.get.mock.calls[0][0]);
    expect(sent).toContain("Nameservers=ns1.eazworld.com,ns2.eazworld.com");
  });
});

describe("setEazWorldNameservers", () => {
  it("splits the domain into SLD/TLD and sends both nameservers", async () => {
    process.env.NAMESERVER_1 = "ns1.eazworld.com";
    process.env.NAMESERVER_2 = "ns2.eazworld.com";
    axios.get.mockResolvedValueOnce(xmlOk("<DomainDNSSetCustomResult Update=\"true\" />"));

    const result = await namecheap.setEazWorldNameservers("MyBiz.com");
    expect(result).toEqual({ success: true });

    const sent = decodeURIComponent(axios.get.mock.calls[0][0]);
    expect(sent).toContain("SLD=mybiz");
    expect(sent).toContain("TLD=com");
    expect(sent).toContain("Nameservers=ns1.eazworld.com,ns2.eazworld.com");
  });

  it("reports the API's error message on failure", async () => {
    axios.get.mockResolvedValueOnce(xmlError("Domain not found"));
    const result = await namecheap.setEazWorldNameservers("nope.com");
    expect(result).toEqual({ success: false, error: "Domain not found" });
  });

  it("refuses when unconfigured", async () => {
    process.env.NAMECHEAP_API_KEY = "";
    const result = await namecheap.setEazWorldNameservers("mybiz.com");
    expect(result.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
