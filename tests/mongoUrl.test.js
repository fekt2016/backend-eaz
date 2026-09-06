// .env stores MONGO_URL with a literal <PASSWORD> and the secret in
// DATABASE_PASSWORD. Connecting with the raw value fails as "bad auth", which
// reads like a wrong password rather than an unsubstituted one — this pins the
// substitution that server.js:71 and every script under scripts/ rely on.
const { resolveMongoUrl, requireMongoUrl } = require("../utils/mongoUrl");

const URL_WITH_PLACEHOLDER = "mongodb://user:<PASSWORD>@host.mongodb.net/eazworld";

describe("resolveMongoUrl", () => {
  it("substitutes the placeholder with DATABASE_PASSWORD", () => {
    const out = resolveMongoUrl({ MONGO_URL: URL_WITH_PLACEHOLDER, DATABASE_PASSWORD: "s3cret" });
    expect(out).toBe("mongodb://user:s3cret@host.mongodb.net/eazworld");
    expect(out).not.toContain("<PASSWORD>");
  });

  it("leaves a URL that already carries its password alone", () => {
    const real = "mongodb://user:already@host.mongodb.net/eazworld";
    expect(resolveMongoUrl({ MONGO_URL: real, DATABASE_PASSWORD: "ignored" })).toBe(real);
  });

  it("accepts the lowercase and MONGO_URI spellings, as server.js does", () => {
    expect(resolveMongoUrl({ mongo_url: URL_WITH_PLACEHOLDER, database_password: "p" }))
      .toContain(":p@");
    expect(resolveMongoUrl({ MONGO_URI: URL_WITH_PLACEHOLDER, DATABASE_PASSWORD: "p" }))
      .toContain(":p@");
  });

  it("returns null when nothing is configured", () => {
    expect(resolveMongoUrl({})).toBeNull();
  });
});

describe("requireMongoUrl", () => {
  it("refuses an unsubstituted placeholder instead of failing later as bad auth", () => {
    expect(() => requireMongoUrl({ MONGO_URL: URL_WITH_PLACEHOLDER }))
      .toThrow(/still contains the literal <PASSWORD>/);
  });

  it("refuses a missing URL", () => {
    expect(() => requireMongoUrl({})).toThrow(/is not set/);
  });

  it("returns the resolved URL when it is usable", () => {
    expect(requireMongoUrl({ MONGO_URL: URL_WITH_PLACEHOLDER, DATABASE_PASSWORD: "ok" }))
      .toBe("mongodb://user:ok@host.mongodb.net/eazworld");
  });
});
