/*
 * One-off seed for TASK VERIFICATION (T12/T13/T19/T20/T21).
 * Creates a technician, staff, and admin login + a PosCustomer + RepairJobs in
 * several statuses so the merged features can be exercised in the running app.
 * Safe to re-run: it removes the same test docs by their marker before recreating.
 *
 * Run: node src/seedVerifyTasks.js
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const User = require("../models/User");
const PosCustomer = require("../models/PosCustomer");
const RepairJob = require("../models/RepairJob");
const { logDbTarget } = require("../utils/dbTarget");

const resolveDbUrl = () => {
  const mongoUrlRaw =
    process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!mongoUrlRaw) throw new Error("MONGO_URL is not defined in environment variables");
  const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
  return mongoUrlRaw.includes("<PASSWORD>") && dbPassword
    ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
    : mongoUrlRaw;
};

const PASSWORD = "VerifyPass123!";
const TEST_EMAILS = {
  technician: "verify.tech@example.com",
  staff: "verify.staff@example.com",
  admin: "verify.admin@example.com",
};
const CUSTOMER_PHONE = "+233200000999";

async function seed() {
  await mongoose.connect(resolveDbUrl());
  console.log("✅ connected");
  logDbTarget();

  // --- users (delete + recreate so the password hook re-runs cleanly) ---
  await User.deleteMany({ email: { $in: Object.values(TEST_EMAILS) } });
  const mkUser = (name, email, role) =>
    new User({ name, email, password: PASSWORD, role, isVerified: true, twoFactorEnabled: false }).save();
  const tech = await mkUser("Verify Technician", TEST_EMAILS.technician, "technician");
  await mkUser("Verify Staff", TEST_EMAILS.staff, "staff");
  await mkUser("Verify Admin", TEST_EMAILS.admin, "admin");
  console.log("✅ users created (password for all: %s)", PASSWORD);

  // --- pos customer ---
  let customer = await PosCustomer.findOne({ phone: CUSTOMER_PHONE });
  if (!customer) {
    customer = await PosCustomer.create({
      name: "Verify Customer",
      phone: CUSTOMER_PHONE,
      email: "verify.customer@example.com",
    });
  }

  // --- repair jobs in the statuses T19/T20 care about ---
  await RepairJob.deleteMany({ imei: "VERIFYSEED" });
  const base = {
    customer: customer._id,
    imei: "VERIFYSEED",
    deviceType: "Phone",
    deviceBrand: "Apple",
    deviceModel: "iPhone 13",
    faultDescription: "Screen cracked, verification seed job",
    assignedTo: tech._id,
    createdBy: tech._id,
    dropoff: "bring",
  };
  const statuses = ["received", "diagnosing", "repairing", "ready", "cancelled"];
  const jobs = [];
  for (const status of statuses) {
    // .save() (not insertMany) so the jobNumber/trackingToken pre-save hook runs
    const job = await new RepairJob({ ...base, status }).save();
    jobs.push(job);
    console.log(`  job ${job.jobNumber}  status=${status}  id=${job._id}`);
  }

  console.log("\n================ VERIFY SEED DONE ================");
  console.log("Login (all): password =", PASSWORD);
  console.log("  technician:", TEST_EMAILS.technician);
  console.log("  staff     :", TEST_EMAILS.staff);
  console.log("  admin     :", TEST_EMAILS.admin);
  console.log("Repair job IDs by status:");
  jobs.forEach((j) => console.log(`  ${j.status.padEnd(11)} -> /dashboard/pos/jobs/${j._id}`));
  console.log("=================================================");

  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error("SEED ERROR:", e);
  process.exit(1);
});
