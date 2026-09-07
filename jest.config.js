/** Jest configuration for the EazWorld backend (integration-style API tests). */
module.exports = {
  testEnvironment: "node",
  // T120 — ONE mongod for the whole run, started before any worker.
  globalSetup: "<rootDir>/tests/globalSetup.js",
  globalTeardown: "<rootDir>/tests/globalTeardown.js",
  // Per-file: connect mongoose to that instance, set test env defaults, clean up.
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  testMatch: ["**/tests/**/*.test.js"],
  // First run may download the mongod binary — give it room.
  testTimeout: 30000,
  // Jest defaults to (cores - 1) workers: 7 here, all of them driving ONE
  // shared in-memory mongod that needs CPU of its own. That over-subscription
  // was the whole flaky-test class — a rotating cast of suites failing in full
  // runs and passing alone, with symptoms that are starvation rather than
  // logic: hooks timing out, socket hang-ups, and responses arriving mangled
  // ("Parse Error: Expected HTTP/, RTSP/ or ICE/").
  //
  // The work itself was never slow. The index build that timed out at 30,000ms
  // takes 280ms measured on its own — a 100x gap that no amount of raising
  // timeouts would have honestly addressed.
  //
  // 4 leaves room for mongod and the main process. Measured against 7 below.
  maxWorkers: 4,
  clearMocks: true,
  // Keep test output focused; ignore deps and seed scripts.
  testPathIgnorePatterns: ["/node_modules/"],
};
