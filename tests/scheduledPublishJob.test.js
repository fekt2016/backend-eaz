const Post = require("../models/Post");
const { runScheduledPublishJob } = require("../utils/scheduledPublishJob");

const base = {
  excerpt: "x",
  content: "body",
  category: "General",
};

const minutesFromNow = (m) => new Date(Date.now() + m * 60 * 1000);

describe("Scheduled publish job", () => {
  it("publishes due posts and stamps publishedAt with the scheduled time", async () => {
    const when = minutesFromNow(-5);
    await Post.create({ ...base, title: "Due", slug: "due", scheduledFor: when });

    const { published } = await runScheduledPublishJob();
    expect(published).toBe(1);

    const doc = await Post.findOne({ slug: "due" }).lean();
    expect(doc.published).toBe(true);
    expect(new Date(doc.publishedAt).getTime()).toBe(when.getTime());
  });

  it("leaves posts scheduled for the future untouched", async () => {
    await Post.create({ ...base, title: "Future", slug: "future", scheduledFor: minutesFromNow(60) });

    const { published } = await runScheduledPublishJob();
    expect(published).toBe(0);
    expect((await Post.findOne({ slug: "future" })).published).toBe(false);
  });

  it("ignores posts with no scheduledFor", async () => {
    await Post.create({ ...base, title: "Manual", slug: "manual" });

    await runScheduledPublishJob();
    expect((await Post.findOne({ slug: "manual" })).published).toBe(false);
  });

  it("never re-touches an already-published post", async () => {
    const originalDate = minutesFromNow(-1000);
    await Post.create({
      ...base,
      title: "Live",
      slug: "live",
      published: true,
      publishedAt: originalDate,
      scheduledFor: minutesFromNow(-5), // past, but already published
    });

    await runScheduledPublishJob();

    const doc = await Post.findOne({ slug: "live" }).lean();
    expect(doc.published).toBe(true);
    // publishedAt must not be overwritten by the scheduled time
    expect(new Date(doc.publishedAt).getTime()).toBe(originalDate.getTime());
  });

  it("is safe to run again with nothing due", async () => {
    await Post.create({ ...base, title: "Due2", slug: "due2", scheduledFor: minutesFromNow(-5) });

    expect((await runScheduledPublishJob()).published).toBe(1);
    expect((await runScheduledPublishJob()).published).toBe(0);
  });
});
