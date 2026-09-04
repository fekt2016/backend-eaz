/**
 * The connection string, with `<PASSWORD>` filled in.
 *
 * `.env` stores MONGO_URL with a literal `<PASSWORD>` placeholder and keeps the
 * real secret in DATABASE_PASSWORD, so anything connecting has to substitute
 * one into the other first — server.js:71 does it, and every script under
 * scripts/ repeats the same three lines. Connecting with the raw value fails as
 * `bad auth`, which reads like a wrong password rather than a missing one and
 * costs a while to work out.
 *
 * Also accepts the lowercase and MONGO_URI spellings, matching server.js —
 * cPanel's environment editor has historically produced both.
 */
function resolveMongoUrl(env = process.env) {
  const raw = env.MONGO_URL || env.mongo_url || env.MONGO_URI;
  if (!raw) return null;
  const password = env.DATABASE_PASSWORD || env.database_password;
  return raw.includes("<PASSWORD>") && password
    ? raw.replace("<PASSWORD>", password)
    : raw;
}

/** Same, but throws with a usable message instead of returning null/placeholder. */
function requireMongoUrl(env = process.env) {
  const url = resolveMongoUrl(env);
  if (!url) throw new Error("MONGO_URL (or mongo_url / MONGO_URI) is not set.");
  if (url.includes("<PASSWORD>")) {
    throw new Error(
      "MONGO_URL still contains the literal <PASSWORD> placeholder and DATABASE_PASSWORD is not set. " +
      "Connecting would fail as 'bad auth'."
    );
  }
  return url;
}

module.exports = { resolveMongoUrl, requireMongoUrl };
