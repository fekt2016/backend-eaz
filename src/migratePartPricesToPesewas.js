const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Part = require("../models/Part");
const { logDbTarget } = require("../utils/dbTarget");

dotenv.config({ path: "./.env" });

const mongoUrlRaw =
  process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
if (!mongoUrlRaw) {
  console.error("MONGO_URL is not defined in environment variables");
  process.exit(1);
}

const dbPassword =
  process.env.DATABASE_PASSWORD || process.env.database_password;
const db =
  mongoUrlRaw.includes("<PASSWORD>") && dbPassword
    ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
    : mongoUrlRaw;

// One-off migration: Part costPrice/sellingPrice were stored in major GHS
// (e.g. 250 = GH₵250). Standardize to integer minor units (pesewas ×100).
async function migrate() {
  await mongoose.connect(db, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");
  logDbTarget();

  const before = await Part.countDocuments();
  const res = await Part.updateMany(
    {},
    [
      {
        $set: {
          costPrice: { $multiply: ["$costPrice", 100] },
          sellingPrice: { $multiply: ["$sellingPrice", 100] },
        },
      },
    ],
  );
  console.log(
    `Parts converted — ${before} total, ${res.matchedCount} matched, ${res.modifiedCount} updated`,
  );

  const sample = await Part.find().sort({ createdAt: -1 }).limit(3)
    .select("name sellingPrice costPrice");
  console.log("Sample (pesewas):", JSON.stringify(sample, null, 2));

  await mongoose.connection.close();
  console.log("Migration complete");
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
