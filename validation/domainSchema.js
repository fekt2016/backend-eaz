const { z } = require('zod');

const searchSchema = z.object({
  domain: z.string().min(1, 'Domain name is required'),
});

const paymentSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  email: z.string().email('Invalid email'),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  customerName: z.string().optional(),
  fullName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  registrantInfo: z.record(z.unknown()).optional(),
  years: z.number().min(1).max(10).optional(),
});

module.exports = { searchSchema, paymentSchema };
