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
  clearMocks: true,
  // Keep test output focused; ignore deps and seed scripts.
  testPathIgnorePatterns: ["/node_modules/"],
};
