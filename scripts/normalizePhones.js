const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const rawUri    = process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
const MONGO_URI  = rawUri && rawUri.includes('<PASSWORD>') && dbPassword
  ? rawUri.replace('<PASSWORD>', dbPassword) : rawUri;

function normalizePhone(str) {
  if (!str) return null;
  let d = str.replace(/\D/g, '');
  if (d.startsWith('233') && d.length === 12) d = '0' + d.slice(3);
  if (d.length === 9) d = '0' + d;
  return d.slice(0, 10) || null;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');
  const col = mongoose.connection.db.collection('poscustomers');
  const docs = await col.find({}).toArray();
  let updated = 0;
  for (const d of docs) {
    const norm = normalizePhone(d.phone);
    if (norm && norm !== d.phone) {
      await col.updateOne({ _id: d._id }, { $set: { phone: norm } });
      console.log(`  ${d.phone} → ${norm}`);
      updated++;
    }
  }
  console.log(`Done. ${updated} phone(s) normalized.`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e.message); process.exit(1); });
