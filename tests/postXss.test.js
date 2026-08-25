// T42: BlogArticle.jsx renders post.content via dangerouslySetInnerHTML.
// The primary fix is frontend (DOMPurify at render time, frontend-eaz).
// This is the backend defense-in-depth half: sanitizePostContent strips
// literal HTML tags + the javascript: scheme from Post.content on write.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const Post = require("../models/Post");
const { sanitizePostContent } = require("../utils/sanitize");

async function makeAdminToken() {
  const user = await User.create({
    name: "Admin", email: `admin-${Date.now()}@t.com`, password: "Password123!", role: "admin",
  });
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
}

describe("sanitizePostContent (unit)", () => {
  it("HTML-encodes a <script> tag and its contents (inert, never re-parsed as a tag)", () => {
    expect(sanitizePostContent("Before <script>alert(document.cookie)</script> after"))
      .toBe("Before &lt;script&gt;alert(document.cookie)&lt;/script&gt; after");
  });

  it("HTML-encodes a disallowed tag carrying an onerror attribute", () => {
    expect(sanitizePostContent('Before <img src=x onerror="alert(1)"> after'))
      .toBe('Before &lt;img src=x onerror="alert(1)"&gt; after');
  });

  it("strips the javascript: scheme from a markdown link, keeping the markdown syntax", () => {
    expect(sanitizePostContent("[Click here](javascript:alert(document.cookie))"))
      .toBe("[Click here](alert(document.cookie))");
  });

  it("leaves normal markdown (bold, real links, headers, lists) completely untouched", () => {
    const md = "## Heading\n\n**bold text** and a [real link](https://example.com)\n\n- item one\n- item two";
    expect(sanitizePostContent(md)).toBe(md);
  });

  it("returns undefined for empty/non-string input", () => {
    expect(sanitizePostContent("")).toBeUndefined();
    expect(sanitizePostContent(null)).toBeUndefined();
    expect(sanitizePostContent(undefined)).toBeUndefined();
  });
});

describe("POST/PATCH /api/v1/posts — content sanitized on write (T42)", () => {
  it("HTML-encodes a <script> tag in content on create, inert in storage", async () => {
    const token = await makeAdminToken();
    const res = await request(app)
      .post("/api/v1/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: `XSS Test ${Date.now()}`,
        excerpt: "excerpt",
        category: "SEO",
        content: "Before <script>alert(1)</script> after",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe("Before &lt;script&gt;alert(1)&lt;/script&gt; after");

    const stored = await Post.findById(res.body.data._id);
    expect(stored.content).toBe("Before &lt;script&gt;alert(1)&lt;/script&gt; after");
  });

  it("strips the javascript: scheme from content on update", async () => {
    const token = await makeAdminToken();
    const created = await request(app)
      .post("/api/v1/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: `XSS Update Test ${Date.now()}`,
        excerpt: "excerpt",
        category: "SEO",
        content: "safe content",
      });

    const res = await request(app)
      .patch(`/api/v1/posts/${created.body.data._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "[Click](javascript:alert(document.cookie))" });

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe("[Click](alert(document.cookie))");
  });

  it("leaves normal markdown content unchanged on create", async () => {
    const token = await makeAdminToken();
    const content = "## Intro\n\n**Key point** and a [link](https://example.com).";
    const res = await request(app)
      .post("/api/v1/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: `Normal Post ${Date.now()}`,
        excerpt: "excerpt",
        category: "SEO",
        content,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe(content);
  });
});
