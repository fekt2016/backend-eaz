/** Jest configuration for the EazWorld backend (integration-style API tests). */
module.exports = {
  testEnvironment: "node",
  // Global setup: in-memory Mongo + test env defaults + per-test cleanup.
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  testMatch: ["**/tests/**/*.test.js"],
  // First run may download the mongod binary — give it room.
  testTimeout: 30000,
  clearMocks: true,
  // Keep test output focused; ignore deps and seed scripts.
  testPathIgnorePatterns: ["/node_modules/"],
};
