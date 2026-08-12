/**
 * Dev/ops: create (or reset) one demo account per role.
 * Usage: node scripts/seedRoleAccounts.js
 *
 * Idempotent — if an email already exists, its role, password and verified
 * status are updated (no duplicate is created). Passwords are hashed by the
 * User model's pre-save hook.
 *
 * ⚠️ These are shared, known credentials. Change them (or delete the accounts)
 *    before going anywhere near real production use.
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

const ACCOUNTS = [
  { role: 'superadmin', name: 'Super Admin', email: 'superadmin@eazworld.com', password: 'Eaz@Super2026' },
  { role: 'admin',      name: 'Admin',       email: 'admin@eazworld.com',      password: 'Eaz@Admin2026' },
  { role: 'staff',      name: 'Staff',       email: 'staff@eazworld.com',      password: 'Eaz@Staff2026' },
  { role: 'technician', name: 'Technician',  email: 'technician@eazworld.com', password: 'Eaz@Tech2026' },
  { role: 'user',       name: 'Customer',    email: 'customer@eazworld.com',   password: 'Eaz@Customer2026' },
];

async function main() {
  const db = resolveMongoUrl();
  await mongoose.connect(db, { maxPoolSize: 3, serverSelectionTimeoutMS: 10_000 });

  const results = [];
  for (const acc of ACCOUNTS) {
    let user = await User.findOne({ email: acc.email }).select('+password');
    let action;
    if (user) {
      user.name       = acc.name;
      user.role       = acc.role;
      user.password   = acc.password; // re-hashed by pre-save hook
      user.isVerified = true;
      await user.save();
      action = 'updated';
    } else {
      user = await User.create({ ...acc, isVerified: true });
      action = 'created';
    }
    results.push({ role: acc.role, email: acc.email, password: acc.password, action });
  }

  console.log('\nRole accounts ready:\n');
  console.log('ROLE        EMAIL                       PASSWORD           STATUS');
  console.log('----------  --------------------------  -----------------  -------');
  for (const r of results) {
    console.log(
      `${r.role.padEnd(10)}  ${r.email.padEnd(26)}  ${r.password.padEnd(17)}  ${r.action}`
    );
  }
  console.log('\n⚠️  Change these passwords before real production use.\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
