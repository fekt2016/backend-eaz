const Post = require("../models/Post");
const { POSTS } = require("../src/seedBlog");

// Mirrors the upsert in src/seedBlog.js seed() — keyed on the unique slug,
// with published/author fixed via $setOnInsert so re-seeding never clobbers a
// post an editor has already published. We can't call seed() directly: it
// opens and closes its own Mongoose connection, which would tear down the
// shared in-memory connection from tests/setup.js.
async function seedPosts() {
  await Post.bulkWrite(
    POSTS.map((p) => ({
      updateOne: {
        filter: { slug: p.slug },
        update: {
          $set: {
            title: p.title,
            excerpt: p.excerpt,
            content: p.content,
            category: p.category,
            readTime: p.readTime,
            featured: p.featured === true,
          },
          $setOnInsert: {
            slug: p.slug,
            author: "EazWorld Team",
            published: false,
          },
        },
        upsert: true,
      },
    })),
  );
}

const CATEGORY_ENUM = Post.schema.path("category").enumValues;

describe("Seeded blog posts", () => {
  it("has unique slugs and valid enum categories across the seed data", () => {
    const slugs = POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const p of POSTS) {
      expect(CATEGORY_ENUM).toContain(p.category);
    }
  });

  it("supplies every field the Post model requires", () => {
    for (const p of POSTS) {
      for (const field of ["title", "slug", "excerpt", "content", "category"]) {
        expect(typeof p[field]).toBe("string");
        expect(p[field].length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps content within the blog renderer's supported markdown", () => {
    // BlogArticle.jsx supports "## ", "### ", "- ", "1. ", **bold**, [text](url)
    // only. Backticks and pipe tables render as literal text, so guard them.
    for (const p of POSTS) {
      expect(p.content).not.toContain("`");
      expect(p.content).not.toMatch(/^\s*\|/m);
    }
  });

  it("links only to internal routes that exist on the frontend", () => {
    // Routes verified present under frontend-eaz/src/app.
    const KNOWN_ROUTES = new Set([
      "/services",
      "/hosting",
      "/domains",
      "/book-consultation",
      "/repair",
      "/track",
      "/visit-us",
      "/portfolio",
      "/shop",
    ]);
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    for (const p of POSTS) {
      let m;
      while ((m = linkRe.exec(p.content))) {
        const target = m[1].split("#")[0];
        if (target.startsWith("/")) {
          expect(KNOWN_ROUTES.has(target)).toBe(true);
        }
      }
    }
  });

  it("seeds all posts as unpublished drafts", async () => {
    await seedPosts();

    expect(await Post.countDocuments()).toBe(POSTS.length);
    expect(await Post.countDocuments({ published: true })).toBe(0);

    const stored = await Post.find().lean();
    for (const doc of stored) {
      expect(CATEGORY_ENUM).toContain(doc.category);
      expect(doc.author).toBe("EazWorld Team");
    }
  });

  it("seeds idempotently — re-running neither duplicates nor un-publishes", async () => {
    await seedPosts();
    const firstCount = await Post.countDocuments();
    expect(firstCount).toBe(POSTS.length);

    // Simulate an editor publishing one post via the admin dashboard.
    const target = POSTS[0].slug;
    await Post.updateOne(
      { slug: target },
      { $set: { published: true, publishedAt: new Date() } },
    );

    // Re-seed (e.g. to fix a typo) must not create duplicates...
    await seedPosts();
    expect(await Post.countDocuments()).toBe(firstCount);

    // ...and must not revert the already-published post back to a draft.
    const published = await Post.findOne({ slug: target }).lean();
    expect(published.published).toBe(true);
  });
});
