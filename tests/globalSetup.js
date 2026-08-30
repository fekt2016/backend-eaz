// T120 — start ONE mongod for the entire Jest run.
//
// Previously tests/setup.js ran `MongoMemoryServer.create()` inside a
// `beforeAll`, and because setupFilesAfterEach runs per test FILE, that meant
// one mongod process started and stopped for each of the 82 suites. Late in a
// full run they stopped starting at all — "Instance failed to start within
// 10000ms", followed by "Operation buffering timed out after 10000ms" as
// mongoose queries piled up against a connection that never opened. A full
// serial run took 73 minutes and produced 21 failures across 3 suites, none of
// which fail in isolation.
//
// globalSetup runs once, before any worker starts, so the binary is launched a
// single time and every suite connects to it.
//
// It is a STANDALONE, deliberately. A single-node replica set would also serve
// posSale.test.js's transactions and remove that file's private instance — but
// measured on a fixed 12-suite batch it was SLOWER overall (145s vs 110s), because
// every write then pays journal + oplog cost. The startup saving is real but the
// per-write tax outweighs it. So: one standalone here for the 81 ordinary suites,
// and posSale.test.js keeps its own replset for the transactional path. Two mongod
// starts per run instead of 83.
const { MongoMemoryServer } = require("mongodb-memory-server");

// Pin the mongod binary to a version that supports this host's macOS.
// MongoDB 8.x requires macOS 14+; 7.0.x supports macOS 12+.
const MONGOD_VERSION = process.env.MONGOMS_VERSION || "7.0.14";

module.exports = async () => {
  const mongod = await MongoMemoryServer.create({
    binary: { version: MONGOD_VERSION },
  });

  // globalTeardown reads this off the same globalThis to stop the instance.
  globalThis.__MONGO_INSTANCE__ = mongod;

  // Workers are forked after globalSetup, so they inherit this.
  process.env.MONGO_TEST_URI = mongod.getUri();
};
