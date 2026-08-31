// scripts/runJob.js — the cron entry point for the background jobs.
//
// Requiring the module does NOT connect to Mongo or run anything: main() is
// guarded by `require.main === module`. That guard is load-bearing — without it,
// requiring this file sets process.exitCode = 1 on the missing argv and fails
// the entire suite. That is exactly what happened when this test was written.
//
// The job map holds require paths and function names as data, so a rename would
// break cron silently at 2am rather than loudly at build time. An earlier version
// of this file only asserted `typeof job.run === "function"`, which is trivially
// true of any thunk and would pass with a typo inside it. These mock the four
// modules and assert each thunk actually reaches the right one.
jest.mock("../utils/renewalJob", () => ({ runRenewalJob: jest.fn() }));
jest.mock("../services/reminderJob", () => ({ runReminderJob: jest.fn() }));
jest.mock("../utils/scheduledPublishJob", () => ({ runScheduledPublishJob: jest.fn() }));
jest.mock("../services/refundReconcileJob", () => ({ runRefundReconcileJob: jest.fn() }));

const { JOBS } = require("../scripts/runJob");

const renewals = require("../utils/renewalJob");
const reminders = require("../services/reminderJob");
const publish = require("../utils/scheduledPublishJob");
const refunds = require("../services/refundReconcileJob");

beforeEach(() => jest.clearAllMocks());

describe("runJob registry", () => {
  it("registers exactly the four jobs cron drives", () => {
    expect(Object.keys(JOBS).sort()).toEqual(["publish", "refunds", "reminders", "renewals"]);
  });

  it.each([
    ["renewals", () => renewals.runRenewalJob],
    ["reminders", () => reminders.runReminderJob],
    ["publish", () => publish.runScheduledPublishJob],
    ["refunds", () => refunds.runRefundReconcileJob],
  ])("%s calls its own runner and no other", (name, getRunner) => {
    JOBS[name].run();

    expect(getRunner()).toHaveBeenCalledTimes(1);

    const all = [
      renewals.runRenewalJob,
      reminders.runReminderJob,
      publish.runScheduledPublishJob,
      refunds.runRefundReconcileJob,
    ];
    const others = all.filter((fn) => fn !== getRunner());
    others.forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it("describes each job for the cron log line", () => {
    for (const job of Object.values(JOBS)) {
      expect(job.describe).toEqual(expect.any(String));
      expect(job.describe.length).toBeGreaterThan(0);
    }
  });
});

describe("runJob entry guard", () => {
  it("does not execute main() on require", () => {
    // Regression: the first version called main() at module load, so requiring
    // it under jest set process.exitCode = 1 (no job argument), failing the
    // whole run regardless of assertions.
    expect(process.exitCode).toBeFalsy();
  });

  it("does not treat inherited Object properties as jobs", () => {
    // `JOBS['constructor']` is truthy on any object literal. A bare index would
    // sail past the unknown-job guard and open a Mongo connection.
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(Object.prototype.hasOwnProperty.call(JOBS, key)).toBe(false);
    }
  });
});
