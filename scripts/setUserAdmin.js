/**
 * One-off / ops: promote a user to admin by email.
 * Usage: node scripts/setUserAdmin.js user@example.com
 * Loads ../.env (same as server): MONGO_URL, DATABASE_PASSWORD, mongo_url, MONGO_URI
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
  const emailArg = (process.argv[2] || '').trim().toLowerCase();
  if (!emailArg) {
    console.error('Usage: node scripts/setUserAdmin.js user@example.com');
    process.exit(1);
  }

  const db = resolveMongoUrl();
  await mongoose.connect(db, {
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 10_000,
  });

  const user = await User.findOneAndUpdate(
    { email: emailArg },
    { role: 'admin' },
    { new: true }
  );

  if (!user) {
    console.error(`No user found with email: ${emailArg}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`OK — ${user.email} is now role: ${user.role}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
