/**
 * Run one background job to completion, then exit. Built for cron.
 *
 * WHY THIS EXISTS
 *
 * The four jobs below were scheduled with `setInterval` inside server.js. That
 * worked under PM2, which keeps the process alive forever. It does NOT work
 * under Phusion Passenger on cPanel: Passenger idles an app out when there is no
 * traffic, and an idled app fires no timers. A quiet night meant renewal
 * reminders never sent, scheduled posts never published, and refunds never
 * reconciled — silently, with nothing in the logs to say so.
 *
 * Driving them from cPanel cron instead makes the schedule the platform's job
 * rather than the process's. It also fixes T96 as a side effect: in-process
 * timers double-run if the API is ever scaled past one instance, whereas cron
 * runs once regardless of how many app processes exist.
 *
 * Usage:
 *   node scripts/runJob.js <renewals|reminders|publish|refunds>
 *   npm run job:renewals
 *
 * Exit codes: 0 on success, 1 on failure — so cron's MAILTO reports a real
 * failure rather than staying silent.
 *
 * See docs/HOSTING.md for the crontab entries and their schedules.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

// Each job's module exports a single async runner. Required lazily inside the
// job's own entry so a broken module takes down only that job, not every one.
const JOBS = {
  renewals: {
    describe: 'hosting renewal reminders, suspensions and terminations',
    run: () => require('../utils/renewalJob').runRenewalJob(),
  },
  reminders: {
    describe: 'uncollected device reminders',
    run: () => require('../services/reminderJob').runReminderJob(),
  },
  publish: {
    describe: 'scheduled blog publishing',
    run: () => require('../utils/scheduledPublishJob').runScheduledPublishJob(),
  },
  refunds: {
    describe: 'refund reconciliation (T15)',
    run: () => require('../services/refundReconcileJob').runRefundReconcileJob(),
  },
};

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
  const name = (process.argv[2] || '').trim().toLowerCase();
  // hasOwnProperty, not a bare index: `constructor` and `__proto__` are truthy on
  // any object literal and would sail past the guard into a Mongo connect.
  const job = Object.prototype.hasOwnProperty.call(JOBS, name) ? JOBS[name] : null;

  if (!job) {
    console.error(`Unknown job: ${name || '(none given)'}`);
    console.error(`Available: ${Object.keys(JOBS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Fail loudly on run 1 if cron handed us a stripped environment. Variables set
  // in cPanel's "Setup Node.js App" reach the Passenger web process ONLY — cron
  // inherits nothing — so without a real .env beside the app this job would
  // otherwise die on an unhelpful connection error every night, unnoticed.
  require('../utils/validateEnv').validateEnv();

  // A one-shot process needs a much smaller pool than the API's 5, and no
  // reason to wait 30s to discover Mongo is unreachable.
  await mongoose.connect(resolveMongoUrl(), {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  // renewalJob prices nothing, but reminderJob and refundReconcileJob touch
  // money-bearing documents and the publish job renders templates that show
  // prices. Warm the pricing cache so none of them reads the env fallback.
  await require('../services/pricingSettings').refresh().catch(() => {});

  const startedAt = Date.now();
  console.log(`[runJob] ${name} — ${job.describe}`);

  try {
    await job.run();
    console.log(`[runJob] ${name} finished in ${Date.now() - startedAt}ms`);
  } catch (err) {
    // Deliberately NOT swallowed the way the in-process `.catch(() => {})`
    // callers did: under cron a non-zero exit is the only way anyone finds out.
    console.error(`[runJob] ${name} FAILED after ${Date.now() - startedAt}ms:`, err.message);
    process.exitCode = 1;
  }
}

// Only run when invoked directly. Without this guard, `require`-ing the module
// (as the test does) executes main(), which sets process.exitCode = 1 on the
// missing argv and would fail the whole test run for no reason.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error('[runJob] fatal:', err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = { JOBS, main };
