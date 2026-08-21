const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange
} = require('./common');

const getExpenses = async (req, res, next) => {
  try {
    const { from, to, category, page = 1, limit = 30 } = req.query;
    const query = {};
    if (category && EXPENSE_CATEGORIES.includes(category)) query.category = category;
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to)   query.date.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    const [expenses, total, summary] = await Promise.all([
      Expense.find(query)
        .sort({ date: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('createdBy', 'name'),
      Expense.countDocuments(query),
      Expense.aggregate([
        { $match: query },
        { $group: {
          _id:   '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        }},
        { $sort: { total: -1 } },
      ]),
    ]);

    const totalAmount = summary.reduce((s, c) => s + c.total, 0);
    res.json({ success: true, data: expenses, total, summary, totalAmount });
  } catch (err) { next(err); }
};

const createExpense = async (req, res, next) => {
  try {
    const { amount, category, description, date, notes } = req.body;
    if (!amount || !description) return res.status(400).json({ success: false, error: 'Amount and description are required.' });
    const expense = await Expense.create({
      amount:      Number(amount),
      category:    EXPENSE_CATEGORIES.includes(category) ? category : 'other',
      description: sanitizeText(description, 500),
      notes:       notes ? sanitizeText(notes, 500) : undefined,
      date:        date ? new Date(date) : new Date(),
      createdBy:   req.user._id,
    });
    await expense.populate('createdBy', 'name');
    await logFromRequest(req, {
      action: ACTIONS.EXPENSE_CREATED,
      resourceType: RESOURCES.EXPENSE,
      resourceId: expense._id,
      resourceName: expense.description,
      description: `Recorded expense: ${expense.description} (${expense.category})`,
    });
    res.status(201).json({ success: true, data: expense });
  } catch (err) { next(err); }
};

const updateExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found.' });
    const before = {
      amount: expense.amount, category: expense.category,
      description: expense.description, notes: expense.notes,
      date: expense.date,
    };
    const { amount, category, description, date, notes } = req.body;
    if (amount      !== undefined) expense.amount      = Number(amount);
    if (category    !== undefined) expense.category    = EXPENSE_CATEGORIES.includes(category) ? category : 'other';
    if (description !== undefined) expense.description = sanitizeText(description, 500);
    if (notes       !== undefined) expense.notes       = sanitizeText(notes, 500);
    if (date        !== undefined) expense.date        = new Date(date);
    await expense.save();
    await expense.populate('createdBy', 'name');
    const changes = buildChanges(before, {
      amount: expense.amount, category: expense.category,
      description: expense.description, notes: expense.notes,
      date: expense.date,
    }, {
      amount: 'Amount', category: 'Category', description: 'Description',
      notes: 'Notes', date: 'Date',
    });
    await logFromRequest(req, {
      action: ACTIONS.EXPENSE_UPDATED,
      resourceType: RESOURCES.EXPENSE,
      resourceId: expense._id,
      resourceName: expense.description,
      description: `Updated expense: ${expense.description}`,
      changes,
    });
    res.json({ success: true, data: expense });
  } catch (err) { next(err); }
};

const deleteExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found.' });
    await logFromRequest(req, {
      action: ACTIONS.EXPENSE_DELETED,
      resourceType: RESOURCES.EXPENSE,
      resourceId: expense._id,
      resourceName: expense.description,
      description: `Deleted expense: ${expense.description}`,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ─── SUPPLIERS ───────────────────────────────────────────────────────────────

const getSuppliers = async (req, res, next) => {
  try {
    const { q, active } = req.query;
    const query = {};
    if (active === 'true')  query.isActive = true;
    if (active === 'false') query.isActive = false;
    if (q) query.$or = [
      { name:          { $regex: escapeRegex(q), $options: 'i' } },
      { contactPerson: { $regex: escapeRegex(q), $options: 'i' } },
      { phone:         { $regex: escapeRegex(q), $options: 'i' } },
    ];
    const suppliers = await Supplier.find(query).sort({ name: 1 });
    res.json({ success: true, data: suppliers, total: suppliers.length });
  } catch (err) { next(err); }
};

const getSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });

    // Parts linked to this supplier
    const parts = await Part.find({ supplier: supplier._id })
      .select('name sku category quantity costPrice sellingPrice lowStockThreshold')
      .sort({ name: 1 });

    res.json({ success: true, data: { supplier, parts } });
  } catch (err) { next(err); }
};

const createSupplier = async (req, res, next) => {
  try {
    const { name, contactPerson, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Supplier name is required.' });
    const supplier = await Supplier.create({
      name:          sanitizeName(name, 100),
      contactPerson: contactPerson ? sanitizeName(contactPerson, 100) : undefined,
      phone:         phone    ? sanitizePhone(phone)          : undefined,
      email:         email    ? sanitizeEmail(email)          : undefined,
      address:       address  ? sanitizeText(address, 300)    : undefined,
      notes:         notes    ? sanitizeText(notes, 500)      : undefined,
      createdBy:     req.user._id,
    });
    await logFromRequest(req, {
      action: ACTIONS.SUPPLIER_CREATED,
      resourceType: RESOURCES.SUPPLIER,
      resourceId: supplier._id,
      resourceName: supplier.name,
      description: `Added supplier ${supplier.name}`,
    });
    res.status(201).json({ success: true, data: supplier });
  } catch (err) { next(err); }
};

const updateSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });
    const before = {
      name: supplier.name, contactPerson: supplier.contactPerson, phone: supplier.phone,
      email: supplier.email, address: supplier.address, notes: supplier.notes, isActive: supplier.isActive,
    };
    const { name, contactPerson, phone, email, address, notes, isActive } = req.body;
    if (name          !== undefined) supplier.name          = sanitizeName(name, 100);
    if (contactPerson !== undefined) supplier.contactPerson = sanitizeName(contactPerson, 100);
    if (phone         !== undefined) supplier.phone         = sanitizePhone(phone);
    if (email         !== undefined) supplier.email         = sanitizeEmail(email);
    if (address       !== undefined) supplier.address       = sanitizeText(address, 300);
    if (notes         !== undefined) supplier.notes         = sanitizeText(notes, 500);
    if (isActive      !== undefined) supplier.isActive      = Boolean(isActive);
    await supplier.save();
    const changes = buildChanges(before, {
      name: supplier.name, contactPerson: supplier.contactPerson, phone: supplier.phone,
      email: supplier.email, address: supplier.address, notes: supplier.notes, isActive: supplier.isActive,
    }, {
      name: 'Name', contactPerson: 'Contact Person', phone: 'Phone',
      email: 'Email', address: 'Address', notes: 'Notes', isActive: 'Active',
    });
    await logFromRequest(req, {
      action: ACTIONS.SUPPLIER_UPDATED,
      resourceType: RESOURCES.SUPPLIER,
      resourceId: supplier._id,
      resourceName: supplier.name,
      description: `Updated supplier ${supplier.name}`,
      changes,
    });
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
};

const deleteSupplier = async (req, res, next) => {
  try {
    // Unlink parts before deleting
    await Part.updateMany({ supplier: req.params.id }, { $unset: { supplier: '' } });
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });
    await logFromRequest(req, {
      action: ACTIONS.SUPPLIER_DELETED,
      resourceType: RESOURCES.SUPPLIER,
      resourceId: supplier._id,
      resourceName: supplier.name,
      description: `Deleted supplier ${supplier.name}`,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ─── SALES (atomic) ──────────────────────────────────────────────────────────

/**
 * POST /pos/sales
 * Atomically: validate stock → deduct → record sale → return receipt
 * Uses MongoDB session to prevent partial writes.
 */

module.exports = {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};
