const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Post = require("../models/Post");
const User = require("../models/User");
const { sanitizeMessage } = require("../utils/sanitize");

// T42: blog bodies are rendered as HTML on the storefront. The frontend escapes them
// (BlogArticle), and this is the defence-in-depth half — nothing executable should be
// stored in the first place. The old implementation stripped only whole <script>
// blocks and the literal "javascript:", both of which were trivially reconstructed.

const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);

// Normalise the way a browser does before deciding whether output is executable —
// browsers drop tab/newline/CR inside a URL before parsing its scheme.
const CTRL_RE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(32) + "]", "g");
const looksExecutable = (s) =>
  /<script|onerror|onload|onclick|<iframe|<svg|javascript:|vbscript:|data:text\/html/.test(
    String(s).replace(CTRL_RE, "").toLowerCase(),
  );

describe("sanitizeMessage — executable markup (T42)", () => {
  it.each([
    ["a whole script block", "<script>alert(1)</script>"],
    // The old single-pass replace *built* this payload: removing the inner
    // <script></script> let the outer fragments close up into a live tag.
    ["a nested script that reconstructs itself", "<scr<script></script>ipt>alert(1)</script>"],
    ["a javascript: URL that reconstructs itself", '<a href="javasjavascript:cript:alert(1)">x</a>'],
    ["an onerror handler", "<img src=x onerror=alert(1)>"],
    ["an onload handler on svg", "<svg onload=alert(1)>"],
    ["an iframe", '<iframe src="//evil.com"></iframe>'],
    ["a data:text/html URL", '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ["a mixed-case scheme", '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ["a tab-obfuscated scheme", '<a href="java' + TAB + 'script:alert(1)">x</a>'],
    ["a newline-obfuscated scheme", '<a href="java' + NL + 'script:alert(1)">x</a>'],
    ["a body onload", "<body onload=alert(1)>"],
  ])("strips %s", (_label, payload) => {
    expect(looksExecutable(sanitizeMessage(payload, 50000) || "")).toBe(false);
  });

  it.each([
    ["markdown emphasis", "Great **post**, thanks!"],
    ["a markdown link", "See [docs](https://example.com)."],
    ["prose that merely mentions the words", "Java Script: a book review"],
    ["comparison operators", "5 < 10 and 10 > 5"],
    ["multi-line content", "line one" + NL + "line two"],
    ["a legitimate data:image URL", '<a href="data:image/png;base64,iVBOR">logo</a>'],
  ])("leaves %s untouched", (_label, text) => {
    expect(sanitizeMessage(text, 50000)).toBe(text);
  });

  it("returns undefined for empty or non-string input", () => {
    expect(sanitizeMessage("")).toBeUndefined();
    expect(sanitizeMessage(null)).toBeUndefined();
    expect(sanitizeMessage("   ")).toBeUndefined();
  });

  it("returns undefined when a payload strips down to nothing", () => {
    expect(sanitizeMessage("<script>alert(1)</script>")).toBeUndefined();
  });

  it("still honours maxLen", () => {
    expect(sanitizeMessage("x".repeat(500), 100)).toHaveLength(100);
  });
});

describe("POST /api/v1/posts — content is sanitised on write (T42)", () => {
  async function adminToken() {
    const user = await User.create({
      name: "Admin",
      email: `admin-${Date.now()}@t.com`,
      password: "Password123!",
      role: "admin",
    });
    return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  }

  const base = {
    title: "Hello",
    excerpt: "An excerpt",
    category: "SEO",
  };

  it("does not persist an executable payload from a post body", async () => {
    const token = await adminToken();

    const res = await request(app)
      .post("/api/v1/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...base,
        content: 'Intro text.<img src=x onerror=alert(1)><script>alert(2)</script>',
      });

    expect(res.status).toBe(201);
    const stored = await Post.findById(res.body.data._id).select("+content");
    expect(looksExecutable(stored.content)).toBe(false);
    expect(stored.content).toContain("Intro text.");
  });

  it("sanitises on update too, not just create", async () => {
    const token = await adminToken();
    const post = await Post.create({
      ...base,
      slug: "hello-update",
      content: "Clean body.",
      readTime: "1 min read",
    });

    const res = await request(app)
      .patch(`/api/v1/posts/${post._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: '<iframe src="//evil.com"></iframe>Updated body.' });

    expect(res.status).toBe(200);
    const stored = await Post.findById(post._id).select("+content");
    expect(looksExecutable(stored.content)).toBe(false);
    expect(stored.content).toContain("Updated body.");
  });
});
