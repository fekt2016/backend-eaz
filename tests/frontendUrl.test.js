// T119 — frontendUrl() used to return "" in production when neither FRONTEND_URL
// nor CLIENT_URL was set. That value is interpolated into the Paystack
// `callback_url` (orderController, hostingOrderController, pos/paymentController,
// domainController, serviceOrderController) and into the customer tracking links
// in services/notify.js — so an empty string meant Paystack received a RELATIVE
// callback and customers were texted a link with no host, with nothing logged.
//
// The module reads NODE_ENV once at load, so each case re-requires it in a fresh
// module registry rather than mutating a cached constant.
const PATH = "../utils/frontendUrl";

// NODE_ENV is read once at module load, but FRONTEND_URL/CLIENT_URL are read on
// every call — so the env must stay applied while the returned function runs,
// and is restored in afterEach rather than immediately.
const ORIGINAL = { ...process.env };

function loadWith(env) {
  Object.assign(process.env, env);
  let mod;
  jest.isolateModules(() => {
    mod = require(PATH);
  });
  return mod;
}

afterEach(() => {
  for (const k of ["NODE_ENV", "FRONTEND_URL", "CLIENT_URL"]) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe("frontendUrl (T119)", () => {
  it("returns the configured URL in production", () => {
    const f = loadWith({ NODE_ENV: "production", FRONTEND_URL: "https://www.eazworld.co" });
    expect(f()).toBe("https://www.eazworld.co");
  });

  it("strips a trailing slash so callers can concatenate paths safely", () => {
    const f = loadWith({ NODE_ENV: "production", FRONTEND_URL: "https://www.eazworld.co/" });
    expect(f()).toBe("https://www.eazworld.co");
  });

  it("falls back to CLIENT_URL when FRONTEND_URL is absent", () => {
    const f = loadWith({ NODE_ENV: "production", FRONTEND_URL: "", CLIENT_URL: "https://alt.eazworld.co" });
    expect(f()).toBe("https://alt.eazworld.co");
  });

  // The actual defect. Before T119 this returned "" and every caller carried on.
  it("THROWS in production when neither is set, rather than returning an empty string", () => {
    const f = loadWith({ NODE_ENV: "production", FRONTEND_URL: "", CLIENT_URL: "" });
    expect(() => f()).toThrow(/FRONTEND_URL/);
    // Specifically: it must not hand back something a caller would happily
    // interpolate into a Paystack callback_url.
    expect(() => f()).not.toThrow(/Cannot read/);
  });

  it("still returns localhost in development with nothing configured", () => {
    const f = loadWith({ NODE_ENV: "development", FRONTEND_URL: "", CLIENT_URL: "" });
    expect(f()).toBe("http://localhost:3000");
  });

  it("ignores a whitespace-only value, which is as broken as an empty one", () => {
    const f = loadWith({ NODE_ENV: "production", FRONTEND_URL: "   ", CLIENT_URL: "" });
    expect(() => f()).toThrow(/FRONTEND_URL/);
  });
});
