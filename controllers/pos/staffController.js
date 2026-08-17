const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange
} = require('./common');

const getTechnicians = async (req, res, next) => {
  try {
    const technicians = await User.find({ role: 'technician' })
      .select('name phone role')
      .sort({ name: 1 });
    res.json({ success: true, data: technicians });
  } catch (err) { next(err); }
};

const getStaff = async (req, res, next) => {
  try {
    // roles param lets callers filter: ?roles=staff,technician
    const rolesParam = req.query.roles;
    const roles = rolesParam
      ? rolesParam.split(',').map(r => r.trim()).filter(Boolean)
      : ['staff', 'technician'];
    const staff = await User.find({ role: { $in: roles } })
      .select('name email phone role createdAt')
      .sort({ name: 1 });
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
};

const createStaff = async (req, res, next) => {
  try {
    const { validatePassword } = require('../utils/sanitize');
    const name  = sanitizeName(req.body.name);
    const email = sanitizeEmail(req.body.email);
    const phone = sanitizePhone(req.body.phone || '');
    const { password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password are required.' });
    }
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ success: false, error: pwError });

    const allowed = ['technician', 'staff'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be technician or staff.' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, error: 'Email already registered.' });

    const user = await User.create({ name, email, ...(phone ? { phone } : {}), password, role, isVerified: true });
    await logFromRequest(req, {
      action: ACTIONS.STAFF_CREATED,
      resourceType: RESOURCES.STAFF,
      resourceId: user._id,
      resourceName: user.email,
      description: `Created staff account ${user.name} (${user.email}) as ${role}`,
      metadata: { role },
    });
    res.status(201).json({ success: true, data: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { next(err); }
};

// ─── REPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  getTechnicians,
  getStaff,
  createStaff,
};
