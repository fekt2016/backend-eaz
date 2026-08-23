const { z } = require('zod');

// Blank/whitespace-only input (an omitted form field posts as '', not undefined)
// must be treated as "not provided," not run through format validation — without
// this, z.string().email() rejects an intentionally-empty email with "Invalid
// email" before the .refine() below ever gets a chance to give the real message.
const blankToUndefined = (val) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

const registerSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.preprocess(blankToUndefined, z.string().email('Invalid email').optional()),
    phone: z.preprocess(blankToUndefined, z.string().optional()),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.phone), {
    message: 'Provide an email or phone number.',
    path: ['email'],
  });

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email'),
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
