const { z } = require('zod');

// Blank/whitespace-only input (an omitted form field posts as '', not undefined)
// must be treated as "not provided," not run through format validation — without
// this, z.string().email() rejects an intentionally-empty email with "Invalid
// email" before the .refine() below ever gets a chance to give the real message.
const blankToUndefined = (val) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

// Every controller here runs sanitizeEmail() before using the value, so a padded
// address is a legitimate request today. Validating the raw string would reject
// it before that runs — trim first, then check the format.
const trimBlankToUndefined = (val) => {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  return trimmed === '' ? undefined : trimmed;
};

const registerSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.preprocess(trimBlankToUndefined, z.string().email('Invalid email').optional()),
    phone: z.preprocess(blankToUndefined, z.string().optional()),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.phone), {
    message: 'Provide an email or phone number.',
    path: ['email'],
  });

// NOT `.email()` on `email`. The login controller reads `req.body.email ||
// req.body.phone` into ONE identifier and then tries BOTH sanitizeEmail and
// sanitizePhone on it — so a customer typing their phone number into the email
// field logs in successfully today, which is the common case in Ghana.
// Demanding an email format here would break that. This schema therefore only
// guarantees "an identifier and a password are present"; deciding whether the
// identifier is a usable email or phone stays in the controller, which has the
// better error messages for it.
const loginSchema = z
  .object({
    email: z.preprocess(blankToUndefined, z.string().optional()),
    phone: z.preprocess(blankToUndefined, z.string().optional()),
    password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.phone), {
    message: 'Email or phone and password are required.',
    path: ['email'],
  });

// Trimmed before the format check: the controller runs sanitizeEmail(), so
// " Me@Example.com " is a legitimate request today. Validating the raw string
// would reject it before that ever runs.
const forgotPasswordSchema = z.object({
  email: z.preprocess(trimBlankToUndefined, z.string().email('Invalid email')),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['user', 'admin', 'staff', 'technician', 'superadmin']).default('user'),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  createUserSchema,
};
