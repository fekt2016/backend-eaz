/**
 * Print which database a one-off script is actually pointed at.
 *
 * Every script under scripts/ and src/ resolves its connection string via
 * `dotenv.config({ path: "./.env" })`, and this repo's .env points at the live
 * Atlas cluster. So running any of them with no MONGO_URL exported in the shell
 * quietly targets PRODUCTION — including the seeds, which delete and recreate
 * data. Call this right after `mongoose.connect(...)` so whoever ran the command
 * can see the target before it does any work.
 *
 *   const { logDbTarget } = require("../utils/dbTarget");
 *   await mongoose.connect(db, {...});
 *   logDbTarget();            // → Target: cluster0-shard-00-01.xxx.mongodb.net/eazworld
 *
 * Never prints credentials: the host and database name come from the live
 * connection object, not from the URI string.
 */
const mongoose = require("mongoose");

const logDbTarget = (label = "Target") => {
  const { host, name } = mongoose.connection;
  console.log(`${label}: ${host || "unknown-host"}/${name || "unknown-db"}`);
};

module.exports = { logDbTarget };
