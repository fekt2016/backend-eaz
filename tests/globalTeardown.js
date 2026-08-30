// T120 — stop the single shared mongod started in tests/globalSetup.js.
// Runs once, after every suite has finished.
module.exports = async () => {
  const mongod = globalThis.__MONGO_INSTANCE__;
  if (mongod) await mongod.stop();
};
