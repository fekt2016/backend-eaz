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

describe('T61 — EmailLog.type enum covers every type used in code', () => {
  const used = [...new Set([...typesUsedIn('utils/email.js'), ...typesUsedIn('utils/hostingEmail.js')])];

  test.each(used)("'%s' is a valid EmailLog.type enum value", (t) => {
    expect(enumValues).toContain(t);
  });

  test("two_factor and account_created are both present (the T61 regression)", () => {
    expect(enumValues).toEqual(expect.arrayContaining(['two_factor', 'account_created']));
  });

  test('a two_factor EmailLog actually persists (not swallowed by validation)', async () => {
    const doc = await EmailLog.create({ to: 'user@example.com', subject: '2FA', type: 'two_factor', status: 'sent' });
    expect(doc._id).toBeDefined();
    expect(await EmailLog.countDocuments({ type: 'two_factor' })).toBe(1);
  });
});
