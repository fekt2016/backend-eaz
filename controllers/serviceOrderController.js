const crypto = require('crypto');
const Paystack = require('@paystack/paystack-sdk');
const ServiceOrder = require('../models/ServiceOrder');
const User = require('../models/User');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, validatePassword } = require('../utils/sanitize');
const { sendAccountCreatedEmail } = require('../utils/email');

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith('sk_')) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn('⚠️  Paystack not configured — service order payments will not work.');
}

// Deposit amounts per package (GHS)
const PACKAGES = {
  'Landing Page':       { deposit: 400,   total: 800   },
  'Business Website':   { deposit: 1250,  total: 2500  },
  'E-commerce Store':   { deposit: 3000,  total: 6000  },
  'Web Application':    { deposit: 7500,  total: 15000 },
};

/**
 * POST /api/v1/services/payment
 * Works for both guests and logged-in users.
 */
const createServicePayment = async (req, res, next) => {
  try {
    if (!paystack) {
      return res.status(503).json({ success: false, error: 'Payment service not configured.' });
    }

    const name         = sanitizeName(req.body.name, 100);
    const email        = sanitizeEmail(req.body.email);
    const phone        = sanitizePhone(req.body.phone);
    const businessName = sanitizeName(req.body.businessName, 200);
    const packageName  = sanitizeText(req.body.package, 100);
    const notes        = sanitizeText(req.body.notes, 1000);
    const password     = req.body.password;

    if (!name || !email || !packageName) {
      return res.status(400).json({ success: false, error: 'Name, email and package are required.' });
    }

    if (password) {
      const pwError = validatePassword(password);
      if (pwError) return res.status(400).json({ success: false, error: pwError });
    }

    // ── Auto-create account if not logged in ──────────────────
    let userId = req.user?._id || null;
    if (!userId) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        // Link to existing account
        userId = existingUser._id;
      } else if (password) {
        // Create new account with provided password
        const newUser = await User.create({
          name,
          email,
          phone:      phone || '',
          password,
          isVerified: true, // auto-verified since they're paying
        });
        userId = newUser._id;
        sendAccountCreatedEmail(newUser, password).catch(() => {});
      }
    }

    const pkg = PACKAGES[packageName];
    if (!pkg) {
      return res.status(400).json({
        success: false,
        error: `Invalid package. Choose one of: ${Object.keys(PACKAGES).join(', ')}`,
      });
    }

    const reference     = `svc_${crypto.randomBytes(8).toString('hex')}`;
    const amountInKobo  = pkg.deposit * 100; // Paystack uses smallest currency unit

    const transaction = await paystack.transaction.initialize({
      email,
      amount:   amountInKobo,
      currency: 'GHS',
      reference,
      channels: ['card', 'mobile_money'],
      metadata: {
        name,
        businessName: businessName || '',
        package:      packageName,
        service:      'Web Design',
        type:         'service_deposit',
      },
      callback_url: `${require("../utils/frontendUrl")()}/payment-success?type=service`,
    });

    if (!transaction.status) {
      return res.status(500).json({ success: false, error: 'Failed to initialize payment. Please try again.' });
    }

    await ServiceOrder.create({
      name,
      email,
      phone:            phone        || undefined,
      businessName:     businessName || undefined,
      service:          'Web Design',
      package:          packageName,
      notes:            notes        || undefined,
      depositAmount:    pkg.deposit,
      totalAmount:      pkg.total,
      paystackReference: reference,
      status:           'pending',
      user:             userId,
    });

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        reference:        transaction.data.reference,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/services/orders  (admin only)
 */
const getServiceOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};
    const orders = await ServiceOrder.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await ServiceOrder.countDocuments(query);
    res.status(200).json({ success: true, data: orders, total });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/services/orders/:id  (admin only)
 */
const updateServiceOrder = async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    const update = {};
    if (status)    update.status    = status;
    if (adminNote) update.adminNote = sanitizeText(adminNote, 500);
    const order = await ServiceOrder.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    res.status(200).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

module.exports = { createServicePayment, getServiceOrders, updateServiceOrder };
