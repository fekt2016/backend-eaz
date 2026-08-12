/**
 * One-off migration: the `cashier` role has been merged into `staff`.
 * Reassigns every existing user with role "cashier" to "staff".
 *
 * Safe to run more than once (it's a no-op once no cashiers remain).
 *
 * Usage: node scripts/mergeCashierToStaff.js
 *
 * Note: this only touches the User.role field. The `cashier` field on the Sale
 * model (which records *who* rang up a sale) is unrelated and is left untouched.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../models/User');

function resolveMongoUrl() {
  const mongoUrlRaw =
    process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI || '';
  if (!mongoUrlRaw) {
    throw new Error('Set MONGO_URL (or mongo_url / MONGO_URI) in backend-eaz/.env');
  }
  const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
  if (mongoUrlRaw.includes('<PASSWORD>') && dbPassword) {
    return mongoUrlRaw.replace('<PASSWORD>', dbPassword);
  }
  return mongoUrlRaw;
}

async function main() {
  const db = resolveMongoUrl();
  await mongoose.connect(db, { maxPoolSize: 3, serverSelectionTimeoutMS: 10_000 });

  const before = await User.countDocuments({ role: 'cashier' });
  if (before === 0) {
    console.log('No cashier accounts found — nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  const result = await User.updateMany({ role: 'cashier' }, { $set: { role: 'staff' } });
  console.log(`Migrated ${result.modifiedCount} cashier account(s) to staff.`);

  const remaining = await User.countDocuments({ role: 'cashier' });
  console.log(`Cashier accounts remaining: ${remaining}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
