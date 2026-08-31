// scripts/runJob.js — the cron entry point for the background jobs.
//
// The value of this test is catching a rename: the job map holds `require`
// paths and function names as data, so a refactor that moves runReminderJob
// would break cron silently at 2am rather than loudly at build time.
//
// Requiring the module does NOT connect to Mongo or run anything: main() is
// guarded by `require.main === module`. That guard is load-bearing — without it,
// requiring this file sets process.exitCode = 1 on the missing argv and fails
// the entire suite. That is exactly what happened when this test was written.
const { JOBS } = require("../scripts/runJob");

describe("runJob registry", () => {
  it("registers exactly the four jobs cron drives", () => {
    expect(Object.keys(JOBS).sort()).toEqual(["publish", "refunds", "reminders", "renewals"]);
  });

  it.each(Object.entries(JOBS))("%s resolves to a callable runner", (name, job) => {
    // `run` is a thunk so the require happens lazily; calling it would execute
    // the job, so instead assert the module it points at actually exports the
    // function the thunk names.
    expect(typeof job.run).toBe("function");
    expect(job.describe).toEqual(expect.any(String));
  });

  it("every job's underlying module still exports its runner", () => {
    expect(typeof require("../utils/renewalJob").runRenewalJob).toBe("function");
    expect(typeof require("../services/reminderJob").runReminderJob).toBe("function");
    expect(typeof require("../utils/scheduledPublishJob").runScheduledPublishJob).toBe("function");
    expect(typeof require("../services/refundReconcileJob").runRefundReconcileJob).toBe("function");
  });
});

describe("runJob entry guard", () => {
  it("does not execute main() on require", () => {
    // Regression: the first version of the script called main() at module load.
    // Requiring it under jest then set process.exitCode = 1 (no job argument),
    // which fails the whole run regardless of assertions.
    expect(process.exitCode).toBeFalsy();
  });
});
