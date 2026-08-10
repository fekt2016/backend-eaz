// Shared test setup: spin up an in-memory MongoDB, connect Mongoose, and reset
// state between tests. Runs before every test file (jest setupFilesAfterEnv).
//
// Test env defaults are set here BEFORE any test requires `../app`, so modules
// that read process.env at import time get sane values instead of real secrets.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

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
