/**
 * One-off / ops: set any user's role by email.
 * Idempotent — setting a role the user already has rewrites the same value.
 *
 * Usage: npm run user:set-role -- user@example.com [role]
 *   (the `--` is required so npm forwards the arguments to the script)
 * Role defaults to 'superadmin' if omitted.
 * Valid roles: superadmin, admin, staff, technician, user
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

const VALID_ROLES = ['superadmin', 'admin', 'staff', 'technician', 'user'];

async function main() {
  const emailArg = (process.argv[2] || '').trim().toLowerCase();
  const roleArg  = (process.argv[3] || 'superadmin').trim().toLowerCase();

  if (!emailArg) {
    console.error('Usage: node scripts/setUserAdmin.js user@example.com [role]');
    console.error('Roles:', VALID_ROLES.join(', '));
    process.exit(1);
  }

  if (!VALID_ROLES.includes(roleArg)) {
    console.error(`Invalid role "${roleArg}". Valid roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const db = resolveMongoUrl();
  await mongoose.connect(db, { maxPoolSize: 3, serverSelectionTimeoutMS: 10_000 });
  logDbTarget();

  const user = await User.findOneAndUpdate(
    { email: emailArg },
    { role: roleArg },
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
