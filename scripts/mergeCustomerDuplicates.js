/**
 * One-off migration: merge duplicate PosCustomer records that share the same phone number.
 * For each group of duplicates, the OLDEST record is kept; all RepairJobs are re-pointed to it;
 * the newer duplicates are deleted.
 * Usage: node scripts/mergeCustomerDuplicates.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const PosCustomer = require('../models/PosCustomer');
const RepairJob   = require('../models/RepairJob');

const rawUri    = process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
const MONGO_URI  = rawUri && rawUri.includes('<PASSWORD>') && dbPassword
  ? rawUri.replace('<PASSWORD>', dbPassword)
  : rawUri;

if (!MONGO_URI) { console.error('No MongoDB URI found in .env'); process.exit(1); }

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // Find all phone values that appear more than once
  const dupes = await PosCustomer.aggregate([
    { $group: { _id: '$phone', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (dupes.length === 0) {
    console.log('No duplicate phone numbers found. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${dupes.length} phone number(s) with duplicates:\n`);

  let totalMerged = 0;

  for (const group of dupes) {
    // Fetch full docs sorted oldest first
    const docs = await PosCustomer.find({ _id: { $in: group.ids } }).sort({ createdAt: 1 });
    const [keep, ...remove] = docs;

    const removeIds = remove.map(d => d._id);

    // Merge name: use the first non-empty name across the group
    const mergedName = docs.map(d => d.name).find(n => n && n.trim()) || undefined;
    if (mergedName && mergedName !== keep.name) {
      await PosCustomer.findByIdAndUpdate(keep._id, { name: mergedName });
    }

    // Re-assign all jobs from duplicates to the kept record
    const jobResult = await RepairJob.updateMany(
      { customer: { $in: removeIds } },
      { $set: { customer: keep._id } }
    );

    // Delete the duplicates
    await PosCustomer.deleteMany({ _id: { $in: removeIds } });

    console.log(`Phone ${group.phone || keep.phone}:`);
    console.log(`  Kept     : ${keep._id} (${keep.name || 'no name'}, created ${keep.createdAt.toISOString()})`);
    remove.forEach(d => console.log(`  Removed  : ${d._id} (${d.name || 'no name'})`));
    console.log(`  Jobs re-assigned: ${jobResult.modifiedCount}`);
    console.log();

    totalMerged += removeIds.length;
  }

  console.log(`Done. Removed ${totalMerged} duplicate customer record(s).`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
