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
// The registrar is Namecheap. It HAS a sandbox, but a test run must still never
// reach the live API by accident: blanking these makes `namecheap.hasConfig()`
// false, so an unmocked path cannot spend money. Set NAMECHEAP_SANDBOX and real
// sandbox credentials deliberately, in a scratch run, never in the suite.
process.env.NAMECHEAP_API_USER = "";
process.env.NAMECHEAP_API_KEY = "";
process.env.NAMECHEAP_CLIENT_IP = "";
process.env.NAMECHEAP_SANDBOX = "";
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

// T120 — connect to the ONE mongod started in tests/globalSetup.js rather than
// booting a new one per file. This block used to call
// `MongoMemoryServer.create()`, which ran once per test FILE (82 of them);
// late in a full run the instances stopped starting and the suite produced 21
// failures that never reproduce in isolation. The binary version now lives in
// globalSetup.js, which is the only place that launches mongod.
//
// The database is named per JEST WORKER, not per test file. An earlier version
// of this used one database per file; across 82 files that left 82 databases
// accumulating inside the single mongod, and a full run took 127 minutes —
// WORSE than the 73-minute baseline it was meant to fix, because WiredTiger
// carried every one of those databases' files and indexes for the whole run.
// Per-worker keeps the count bounded (exactly one under --runInBand), and the
// afterEach wipe below is what isolates suites from each other.

beforeAll(async () => {
  const uri = process.env.MONGO_TEST_URI;
  if (!uri) {
    throw new Error(
      "MONGO_TEST_URI is not set — tests/globalSetup.js did not run. " +
      "Run the suite through the jest config (npm test), not by requiring setup.js directly."
    );
  }

  const dbName = "test_w" + (process.env.JEST_WORKER_ID || "1");
  await mongoose.connect(uri, { dbName });
});

afterEach(async () => {
  // Wipe every collection so each test starts from a clean slate.
  //
  // This enumerates collections from the DRIVER, not from
  // `mongoose.connection.collections`. The Mongoose registry only lists models
  // loaded in THIS file, so suites that reach past Mongoose to the raw driver
  // (`mongoose.connection.db.collection(...)`, as the migration suites do) left
  // collections behind that were never wiped. That was invisible when every file
  // had its own mongod; with the instance shared it leaked into the next file
  // and made posMoneyMigration's idempotency test fail.
  //
  // deleteMany, not dropDatabase: dropping the database per file was measured at
  // >20 minutes PER SUITE (a full run had not cleared 10 of 82 suites in 3.5
  // hours) because every index has to be rebuilt afterwards. Emptying is cheap
  // and gives the same isolation.
  const collections = await mongoose.connection.db.listCollections().toArray();
  await Promise.all(
    collections.map((c) => mongoose.connection.db.collection(c.name).deleteMany({}))
  );
});

afterAll(async () => {
  // Only disconnect — the shared instance is stopped once in globalTeardown.js.
  // No dropDatabase here: the afterEach above already leaves the database empty,
  // and dropping it per file was catastrophically slow (see the note above).
  await mongoose.disconnect();
});
