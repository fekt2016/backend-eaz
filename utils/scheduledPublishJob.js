/**
 * EazWorld Blog — Scheduled Publish Job
 *
 * Runs on a schedule. Finds unpublished posts whose `scheduledFor` time has
 * arrived and publishes them, stamping `publishedAt` with the scheduled time
 * so the public blog orders them by their intended date.
 *
 * A post is a candidate when: published === false AND scheduledFor is set AND
 * scheduledFor <= now. Already-published posts are never touched.
 */

const Post = require('../models/Post');
const logger = require('./logger');

async function runScheduledPublishJob() {
  const now = new Date();

  // Lean read keeps this cheap on the 512MB heap — we only need id + date.
  const due = await Post.find({
    published: false,
    scheduledFor: { $ne: null, $lte: now },
  })
    .select('_id scheduledFor slug')
    .lean();

  if (due.length === 0) return { published: 0 };

  const ops = due.map((p) => ({
    updateOne: {
      filter: { _id: p._id, published: false },
      update: { $set: { published: true, publishedAt: p.scheduledFor || now } },
    },
  }));
  const result = await Post.bulkWrite(ops);

  const count = result.modifiedCount || 0;
  if (count > 0) {
    logger.info(
      `[scheduled-publish] Published ${count} post(s): ${due.map((p) => p.slug).join(', ')}`,
    );
  }
  return { published: count };
}

module.exports = { runScheduledPublishJob };
