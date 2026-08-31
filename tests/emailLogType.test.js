// T61 regression guard: every email `type` value used in the codebase must be a
// valid EmailLog.type enum value. The original T61 fix set type:'two_factor' but
// that value was missing from the enum, so EmailLog.create() rejected it and the
// send() helper's silent .catch() swallowed the error — 2FA emails were never
// logged. This test fails if any email type used in code is not in the enum.
const fs = require('fs');
const path = require('path');
const EmailLog = require('../models/EmailLog');

const enumValues = EmailLog.schema.path('type').enumValues;

function typesUsedIn(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  return [...src.matchAll(/type:\s*'([a-z_]+)'/g)].map((m) => m[1]);
}

// Scanning only email.js and hostingEmail.js is what let this recur: renewalJob.js
// ('terminated_notice') and notify.js ('repair_reminder') both send mail and both
// used a type the enum did not have, invisibly, because this guard never read them.
// Any new file that sends email belongs in this list.
const EMAIL_SENDING_FILES = [
  'utils/email.js',
  'utils/hostingEmail.js',
  'utils/renewalJob.js',
  'services/notify.js',
];

describe('T61 — EmailLog.type enum covers every type used in code', () => {
  const used = [...new Set(EMAIL_SENDING_FILES.flatMap(typesUsedIn))];

  test.each(used)("'%s' is a valid EmailLog.type enum value", (t) => {
    expect(enumValues).toContain(t);
  });

  test("two_factor and account_created are both present (the T61 regression)", () => {
    expect(enumValues).toEqual(expect.arrayContaining(['two_factor', 'account_created']));
  });

  test.each(['terminated_notice', 'repair_reminder'])(
    "'%s' persists — it was sent for months and logged nothing",
    async (type) => {
      const doc = await EmailLog.create({ to: 'user@example.com', subject: 'x', type, status: 'sent' });
      expect(doc._id).toBeDefined();
    }
  );

  test('a two_factor EmailLog actually persists (not swallowed by validation)', async () => {
    const doc = await EmailLog.create({ to: 'user@example.com', subject: '2FA', type: 'two_factor', status: 'sent' });
    expect(doc._id).toBeDefined();
    expect(await EmailLog.countDocuments({ type: 'two_factor' })).toBe(1);
  });
});
