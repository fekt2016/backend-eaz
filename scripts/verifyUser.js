/**
 * One-off: verify a user account by email.
 * Usage: node scripts/verifyUser.js user@example.com
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const { logDbTarget } = require('../utils/dbTarget');

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
    console.error('Usage: node scripts/verifyUser.js user@example.com');
    process.exit(1);
  }

  const db = resolveMongoUrl();
  await mongoose.connect(db, { maxPoolSize: 3, serverSelectionTimeoutMS: 10_000 });
  logDbTarget();

  const user = await User.findOneAndUpdate(
    { email: emailArg },
    { isVerified: true, verifyPin: undefined, verifyPinExpires: undefined },
    { new: true }
  );

  if (!user) {
    console.error(`No user found with email: ${emailArg}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`OK — ${user.email} (role: ${user.role}) is now verified: ${user.isVerified}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
