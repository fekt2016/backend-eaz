// T42 hygiene pass (not load-bearing for the fix — see tasks.md/postXss.test.js).
// The security fix itself is render-time (frontend DOMPurify) + write-time
// (sanitizePostContent, applied to every create/update going forward). This
// script just brings already-stored Post.content in line with what a fresh
// write would already produce today. Idempotent — safe to run more than once.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { sanitizePostContent } = require('../utils/sanitize');

const rawUri    = process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
const MONGO_URI  = rawUri && rawUri.includes('<PASSWORD>') && dbPassword
  ? rawUri.replace('<PASSWORD>', dbPassword) : rawUri;

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected.${DRY_RUN ? ' (dry run — no writes)' : ''}`);
  const col = mongoose.connection.db.collection('posts');
  const docs = await col.find({}).toArray();
  let changed = 0;
  for (const d of docs) {
    if (typeof d.content !== 'string') continue;
    const clean = sanitizePostContent(d.content, 50000) || '';
    if (clean !== d.content) {
      changed++;
      console.log(`  [${d.slug || d._id}] content changed by re-sanitization`);
      if (!DRY_RUN) await col.updateOne({ _id: d._id }, { $set: { content: clean } });
    }
  }
  console.log(`Done. ${changed} of ${docs.length} post(s) ${DRY_RUN ? 'would be' : 'were'} changed.`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e.message); process.exit(1); });
