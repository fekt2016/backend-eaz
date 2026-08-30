const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange
} = require('./common');
const { paginate } = require('../../utils/pagination');

const createCustomer = async (req, res, next) => {
  try {
    const phone   = sanitizePhone(req.body.phone);
    const name    = req.body.name ? sanitizeName(req.body.name, 100) : undefined;
    const email   = req.body.email ? sanitizeEmail(req.body.email) : undefined;
    const address = req.body.address ? sanitizeText(req.body.address, 200) : undefined;
    const notes   = req.body.notes   ? sanitizeText(req.body.notes, 500)   : undefined;

    // accountVia: 'email' (default when email present) | 'phone' | 'none'
    const accountVia = req.body.accountVia || (email ? 'email' : 'none');
    if (!['email', 'phone', 'none'].includes(accountVia)) {
      return res.status(400).json({ success: false, error: "accountVia must be 'email', 'phone', or 'none'." });
    }

    if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required.' });

    // If phone already exists, return the existing customer rather than failing
    const existing = await PosCustomer.findOne({ phone });
    if (existing) {
      return res.json({ success: true, data: existing, existing: true });
    }

    const customer = await PosCustomer.create({ phone, name, email, address, notes });

    // Auto-create a login account when the staff asked for one (email or phone).
    let account = { created: false, reason: 'not-requested' };
    if (accountVia !== 'none') {
      try {
        if (accountVia === 'email' && !email) {
          account = { created: false, reason: 'email-required' };
        } else {
          const password = generatePassword();
          const userEmail = accountVia === 'email'
            ? email
            : `${phone.replace(/\D/g, '')}@eazworld.local`; // synthetic email for phone accounts

          const existingUser = await User.findOne({ email: userEmail });
          if (existingUser) {
            account = { created: false, reason: 'email-already-registered' };
          } else {
            const user = await User.create({
              name:       name || `Customer ${phone}`,
              email: userEmail,
              phone,
              password,
              role: 'user',
              isVerified: true, // staff confirmed the customer in person
            });
            if (accountVia === 'email') {
              sendAccountCreatedEmail(user, password).catch(() => {});
            } else {
              sendCredentialsSms(phone, name, password).catch(() => {});
            }
            account = { created: true, via: accountVia, email: user.email };
          }
        }
      } catch (err) {
        // Account creation is best-effort — never fail the customer creation because of it
        console.error('[createCustomer] auto-account failed:', err.message);
        account = { created: false, reason: 'error' };
      }
    }

    await logFromRequest(req, {
      action: ACTIONS.CUSTOMER_CREATED,
      resourceType: RESOURCES.CUSTOMER,
      resourceId: customer._id,
      resourceName: customer.name || customer.phone,
      description: `Created POS customer ${customer.name || customer.phone} (${customer.phone})`,
      metadata: { accountVia },
    });

    res.status(201).json({ success: true, data: customer, account });
  } catch (err) { next(err); }
};

const getCustomers = async (req, res, next) => {
  try {
    const { q } = req.query;
    // T87 — clamped: an unbounded limit pulls the whole collection into a 512MB heap.
    const { limit, skip } = paginate(req.query);
    const query = q
      ? { $or: [
          { name:  { $regex: escapeRegex(q), $options: 'i' } },
          { phone: { $regex: escapeRegex(q), $options: 'i' } },
          { email: { $regex: escapeRegex(q), $options: 'i' } },
        ]}
      : {};
    const [customers, total] = await Promise.all([
      PosCustomer.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PosCustomer.countDocuments(query),
    ]);
    res.json({ success: true, data: customers, total });
  } catch (err) { next(err); }
};

const getCustomer = async (req, res, next) => {
  try {
    const customer = await PosCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found.' });
    const jobs = await RepairJob.find({ customer: customer._id })
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'name')
      .select('jobNumber deviceBrand deviceModel status createdAt totalAmount laborCost parts');
    res.json({ success: true, data: { customer, jobs } });
  } catch (err) { next(err); }
};

const updateCustomer = async (req, res, next) => {
  try {
    const update = {};
    if (req.body.name)    update.name    = sanitizeName(req.body.name, 100);
    if (req.body.phone)   update.phone   = sanitizePhone(req.body.phone);
    if (req.body.email)   update.email   = sanitizeEmail(req.body.email);
    if (req.body.address) update.address = sanitizeText(req.body.address, 200);
    if (req.body.notes)   update.notes   = sanitizeText(req.body.notes, 500);
    const customer = await PosCustomer.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found.' });
    await logFromRequest(req, {
      action: ACTIONS.CUSTOMER_UPDATED,
      resourceType: RESOURCES.CUSTOMER,
      resourceId: customer._id,
      resourceName: customer.name || customer.phone,
      description: `Updated POS customer ${customer.name || customer.phone}`,
      changes: Object.keys(update).map((k) => ({ field: k, label: k, before: null, after: update[k] })),
    });
    res.json({ success: true, data: customer });
  } catch (err) { next(err); }
};

// ─── REPAIR JOBS ─────────────────────────────────────────────────────────────

module.exports = {
  createCustomer,
  getCustomers,
  getCustomer,
  updateCustomer,
};
