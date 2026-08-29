// Shared test setup: spin up an in-memory MongoDB, connect Mongoose, and reset
// state between tests. Runs before every test file (jest setupFilesAfterEnv).
//
// Test env defaults are set here BEFORE any test requires `../app`, so modules
// that read process.env at import time get sane values instead of real secrets.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

// ── Keep the suite hermetic ────────────────────────────────────────────────
// `app.js` runs `dotenv.config()`, and this repo's .env holds LIVE credentials.
// Without this block the suite really does call third parties: a password-reset
// test was sending mail through Resend and getting back
// "403 — the eazworld.com domain is not verified", which surfaced as a
// "Cannot log after tests are done" warning and made a fully green run still
// exit 1. Real network I/O also makes runs nondeterministic.
//
// These are ASSIGNED, not deleted: dotenv only fills keys that are absent from
// process.env, so an empty string here wins over the .env value. Paystack gets a
// dummy secret rather than an empty one because refunds.test.js signs its webhook
// payload with it — the value only has to match itself, not be real. It must keep
// the `sk_` prefix: controllers gate on `paystackSecret.startsWith("sk_")` before
// constructing the client, and a secret without it leaves `paystack` undefined,
// turning every refund route into a 500. The SDK itself is mocked in the tests.
process.env.RESEND_API_KEY = "";
// T62 — same hermeticity rule: whatever RESEND_FROM_EMAIL is set to in .env
// must not leak into test runs (it only changes the From header, but a test
// should never depend on live mail config).
process.env.RESEND_FROM_EMAIL = "";
process.env.CLOUDINARY_API_KEY = "";
process.env.CLOUDINARY_API_SECRET = "";
process.env.NAMECHEAP_API_KEY = "";
// T64 — the registrar is Spaceship now, and unlike Namecheap it has NO sandbox:
// every registration spends real money. Blanking these makes `spaceship.hasConfig()`
// false, so an unmocked path can't reach the live registrar from a test run.
process.env.SPACESHIP_API_KEY = "";
process.env.SPACESHIP_API_SECRET = "";
// Same hermeticity rule as the registrar above: a resolved distance costs real
// money per element, and a test must never reach Google. Blanking this makes
// googleDistance.hasConfig() false, so the admin resolve endpoint refuses
// before any HTTP call. Tests that need distances write NeighborhoodDistance
// rows directly.
process.env.GOOGLE_MAPS_API_KEY = "";
process.env.HUBTEL_CLIENT_ID = "";
process.env.HUBTEL_CLIENT_SECRET = "";
process.env.PAYSTACK_SECRET = "sk_test_eazworld_dummy_secret";
process.env.PAYSTACK_KEY = process.env.PAYSTACK_SECRET;

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Pin the mongod binary to a version that supports this host's macOS.
// MongoDB 8.x requires macOS 14+; 7.0.x supports macOS 12+. Override via
// MONGOMS_VERSION if you're on a newer OS and want a different build.
const MONGOD_VERSION = process.env.MONGOMS_VERSION || "7.0.14";

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: MONGOD_VERSION } });
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  // Wipe every collection so each test starts from a clean slate.
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
