// Replacing `xss-clean`, which was abandoned in 2022 while sitting in the
// request path of every route. These tests pin the replacement to the old
// library's exact output — the expected values below were recorded by running
// xss-clean itself, not written from its documentation.
//
// Fidelity matters here beyond tidiness: input passes through this middleware
// before a password is hashed, so escaping one character more or fewer would
// invalidate stored hashes for any password containing that character.
const sanitizeInput = require("../middleware/sanitizeInput");
const { sanitize } = require("../middleware/sanitizeInput");

describe("sanitizeInput — matches the library it replaces", () => {
  // Each pair is [input, what xss-clean produced].
  const recorded = [
    [{ name: "Tom & Jerry" }, { name: "Tom & Jerry" }],
    [{ bio: "<script>alert(1)</script>" }, { bio: "&lt;script>alert(1)&lt;/script>" }],
    [{ q: "a > b < c" }, { q: "a > b &lt; c" }],
    [{ pw: "p@ss&word<1>" }, { pw: "p@ss&word&lt;1>" }],
    [{ quote: 'He said "hi"' }, { quote: 'He said "hi"' }],
    [{ apos: "it's" }, { apos: "it's" }],
    [{ nested: { deep: ["a&b", "<b>"] } }, { nested: { deep: ["a&b", "&lt;b>"] } }],
    [{ spaced: "  padded  " }, { spaced: "  padded  " }],
  ];

  it.each(recorded)("escapes %j exactly as before", (input, expected) => {
    expect(sanitize(JSON.parse(JSON.stringify(input)))).toEqual(expected);
  });

  it("escapes only `<` — not `&` or `>`", () => {
    // The whole contract in one line. xss-filters escapes `<` alone, because
    // that is all it takes to stop a tag opening in an HTML data context.
    expect(sanitize({ v: "&<>" })).toEqual({ v: "&&lt;>" });
  });

  it("keeps non-strings as their own type", () => {
    const out = sanitize({ num: 42, bool: true, nil: null, float: 1.5 });
    expect(out).toEqual({ num: 42, bool: true, nil: null, float: 1.5 });
    expect(typeof out.num).toBe("number");
    expect(out.nil).toBeNull();
  });

  it("does NOT trim values", () => {
    // The old library trimmed the JSON text it built internally, never the
    // values inside it. Trimming here would silently change stored data.
    expect(sanitize({ v: "  x  " })).toEqual({ v: "  x  " });
  });

  it("reaches through arrays and nested objects", () => {
    expect(sanitize({ a: [{ b: ["<x>"] }] })).toEqual({ a: [{ b: ["&lt;x>"] }] });
  });

  it("handles an empty body without throwing", () => {
    expect(sanitize({})).toEqual({});
    expect(sanitize([])).toEqual([]);
  });
});

describe("sanitizeInput — as middleware", () => {
  const run = (req) => new Promise((resolve) => sanitizeInput()(req, {}, resolve));

  it("cleans body, query and params, then calls next", async () => {
    const req = {
      body: { bio: "<script>x</script>" },
      query: { q: "<b>" },
      params: { id: "<i>" },
    };

    await run(req);

    expect(req.body).toEqual({ bio: "&lt;script>x&lt;/script>" });
    expect(req.query).toEqual({ q: "&lt;b>" });
    expect(req.params).toEqual({ id: "&lt;i>" });
  });

  it("skips what a request does not carry", async () => {
    const req = { body: { a: "<x>" } };
    await expect(run(req)).resolves.toBeUndefined();
    expect(req.body).toEqual({ a: "&lt;x>" });
    expect(req.query).toBeUndefined();
  });

  it("survives a payload JSON could not round-trip", async () => {
    // The old library did JSON.stringify → parse on every request and would
    // throw on a circular reference. This walks the object instead.
    const req = { body: { name: "<x>" } };
    req.body.self = req.body;
    await expect(run(req)).resolves.toBeUndefined();
    expect(req.body.name).toBe("&lt;x>");
  });
});
