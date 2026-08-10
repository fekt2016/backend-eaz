const mongoose    = require('mongoose');
const crypto      = require('crypto');
const Paystack    = require('@paystack/paystack-sdk');
const PosCustomer = require('../models/PosCustomer');
const RepairJob   = require('../models/RepairJob');
const Part        = require('../models/Part');
const PosPayment  = require('../models/PosPayment');
const Sale        = require('../models/Sale');
const User        = require('../models/User');
const Expense     = require('../models/Expense');
const Supplier    = require('../models/Supplier');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText } = require('../utils/sanitize');
const { cloudinary } = require('../config/cloudinary');
const streamifier    = require('streamifier');
const { notifyCustomer } = require('../services/notify');

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
const paystack = (paystackSecret && paystackSecret.startsWith('sk_'))
  ? new Paystack(paystackSecret)
  : null;

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────

const createCustomer = async (req, res, next) => {
  try {
    const phone   = sanitizePhone(req.body.phone);
    const name    = req.body.name ? sanitizeName(req.body.name, 100) : undefined;
    const email   = req.body.email ? sanitizeEmail(req.body.email) : undefined;
    const address = req.body.address ? sanitizeText(req.body.address, 200) : undefined;
    const notes   = req.body.notes   ? sanitizeText(req.body.notes, 500)   : undefined;

    if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required.' });

    // If phone already exists, return the existing customer rather than failing
    const existing = await PosCustomer.findOne({ phone });
    if (existing) {
      return res.json({ success: true, data: existing, existing: true });
    }

    const customer = await PosCustomer.create({ phone, name, email, address, notes });
    res.status(201).json({ success: true, data: customer });
  } catch (err) { next(err); }
};

const getCustomers = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 30 } = req.query;
    const query = q
      ? { $or: [
          { name:  { $regex: q, $options: 'i' } },
          { phone: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
        ]}
      : {};
    const [customers, total] = await Promise.all([
      PosCustomer.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)),
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
    res.json({ success: true, data: customer });
  } catch (err) { next(err); }
};

// ─── REPAIR JOBS ─────────────────────────────────────────────────────────────

const createJob = async (req, res, next) => {
  try {
    const {
      customerId, deviceType, deviceBrand, deviceModel,
      imei, color, faultDescription, priority, assignedTo, notes, depositPaid,
      requiresDiagnosis, diagnosisFee,
    } = req.body;

    if (!customerId) return res.status(400).json({ success: false, error: 'Customer is required.' });
    const fault = sanitizeText(faultDescription, 1000);
    if (!fault) return res.status(400).json({ success: false, error: 'Fault description is required.' });

    const customer = await PosCustomer.findById(customerId);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found.' });

    const job = await RepairJob.create({
      customer:         customerId,
      deviceType:       deviceType || 'Phone',
      deviceBrand:      sanitizeText(deviceBrand, 60)  || undefined,
      deviceModel:      sanitizeText(deviceModel, 100) || undefined,
      imei:             sanitizeText(imei, 20)         || undefined,
      color:            sanitizeText(color, 40)        || undefined,
      faultDescription:  fault,
      priority:          priority === 'urgent' ? 'urgent' : 'normal',
      assignedTo:        assignedTo || undefined,
      notes:             sanitizeText(notes, 1000) || undefined,
      depositPaid:       Number(depositPaid) || 0,
      requiresDiagnosis: !!requiresDiagnosis,
      diagnosisFee:      requiresDiagnosis ? (Number(diagnosisFee) || 0) : 0,
      createdBy:         req.user._id,
    });

    const populated = await job.populate([
      { path: 'customer', select: 'name phone' },
      { path: 'assignedTo', select: 'name' },
      { path: 'createdBy', select: 'name' },
    ]);

    // Notify customer — job received
    notifyCustomer(populated, 'received').catch(() => {});

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

const getJobs = async (req, res, next) => {
  try {
    const { status, q, priority, assignedTo, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (priority) query.priority = priority;
    if (assignedTo === 'me') query.assignedTo = req.user._id;

    if (q) {
      const customers = await PosCustomer.find({
        $or: [
          { name:  { $regex: q, $options: 'i' } },
          { phone: { $regex: q, $options: 'i' } },
        ],
      }).select('_id');
      query.$or = [
        { jobNumber:    { $regex: q, $options: 'i' } },
        { deviceBrand:  { $regex: q, $options: 'i' } },
        { deviceModel:  { $regex: q, $options: 'i' } },
        { customer: { $in: customers.map(c => c._id) } },
      ];
    }

    const [jobs, total] = await Promise.all([
      RepairJob.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('customer', 'name phone')
        .populate('assignedTo', 'name'),
      RepairJob.countDocuments(query),
    ]);

    // Attach total repair count for each customer in this page
    const customerIds = [...new Set(jobs.map(j => j.customer?._id?.toString()).filter(Boolean))];
    const counts = await RepairJob.aggregate([
      { $match: { customer: { $in: customerIds.map(id => new mongoose.Types.ObjectId(id)) } } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map(c => [c._id.toString(), c.count]));

    const data = jobs.map(j => ({
      ...j.toJSON(),
      customerRepairCount: countMap[j.customer?._id?.toString()] || 1,
    }));

    res.json({ success: true, data, total });
  } catch (err) { next(err); }
};

const getJob = async (req, res, next) => {
  try {
    const job = await RepairJob.findById(req.params.id)
      .populate('customer')
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name')
      .populate('parts.part', 'name sku');

    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const payments = await PosPayment.find({ job: job._id })
      .populate('receivedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: { ...job.toJSON(), payments } });
  } catch (err) { next(err); }
};

const updateJob = async (req, res, next) => {
  try {
    const job = await RepairJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const {
      status, diagnosis, repairWork, notes, laborCost, priority,
      assignedTo, parts, deviceBrand, deviceModel, imei, color, depositPaid,
      requiresDiagnosis, diagnosisFee, estimatedCompletion,
      warrantyDays, warrantyNotes,
    } = req.body;

    const prevStatus = job.status; // capture before change
    if (status)      job.status      = status;
    if (priority)    job.priority    = priority;
    if (assignedTo !== undefined) job.assignedTo = assignedTo || undefined;
    if (diagnosis            !== undefined) job.diagnosis            = sanitizeText(diagnosis,   1000);
    if (repairWork           !== undefined) job.repairWork           = sanitizeText(repairWork,  1000);
    if (notes                !== undefined) job.notes                = sanitizeText(notes,       1000);
    if (estimatedCompletion  !== undefined) job.estimatedCompletion  = estimatedCompletion ? new Date(estimatedCompletion) : undefined;
    if (laborCost !== undefined)       job.laborCost       = Number(laborCost) || 0;
    if (depositPaid !== undefined)     job.depositPaid     = Number(depositPaid) || 0;
    if (requiresDiagnosis !== undefined) {
      job.requiresDiagnosis = !!requiresDiagnosis;
      job.diagnosisFee      = requiresDiagnosis ? (Number(diagnosisFee) || 0) : 0;
    } else if (diagnosisFee !== undefined && job.requiresDiagnosis) {
      job.diagnosisFee = Number(diagnosisFee) || 0;
    }
    if (deviceBrand !== undefined) job.deviceBrand = sanitizeText(deviceBrand, 60);
    if (deviceModel !== undefined) job.deviceModel = sanitizeText(deviceModel, 100);
    if (imei !== undefined)  job.imei  = sanitizeText(imei, 20);
    if (color !== undefined) job.color = sanitizeText(color, 40);

    // Replace parts list — for inventory-linked parts, always use current sellingPrice
    if (Array.isArray(parts)) {
      const inventoryIds = parts
        .filter(p => p.partId)
        .map(p => p.partId);

      const inventoryParts = inventoryIds.length
        ? await Part.find({ _id: { $in: inventoryIds } }).select('_id sellingPrice costPrice name')
        : [];

      const priceMap = Object.fromEntries(inventoryParts.map(p => [p._id.toString(), { sell: p.sellingPrice, cost: p.costPrice }]));

      job.parts = parts
        .filter(p => p.name && String(p.name).trim())
        .map(p => ({
          part:        p.partId || undefined,
          name:        sanitizeText(String(p.name), 100),
          quantity:    Math.max(1, Number(p.quantity) || 1),
          priceAtTime: p.partId && priceMap[p.partId] != null
            ? priceMap[p.partId].sell
            : Math.max(0, Number(p.cost || p.priceAtTime) || 0),
          costAtTime: p.partId && priceMap[p.partId] != null
            ? priceMap[p.partId].cost
            : Math.max(0, Number(p.costAtTime) || 0),
        }));
    }

    // Warranty fields
    if (warrantyDays  !== undefined) job.warrantyDays  = Math.max(0, Number(warrantyDays) || 0);
    if (warrantyNotes !== undefined) job.warrantyNotes = sanitizeText(warrantyNotes, 500);

    if (status === 'collected' && !job.completedAt) {
      job.completedAt = new Date();
      // Set warranty expiry when customer collects the device
      if (job.warrantyDays > 0) {
        const exp = new Date();
        exp.setDate(exp.getDate() + job.warrantyDays);
        job.warrantyExpires = exp;
      }
    }

    await job.save();
    const populated = await job.populate([
      { path: 'customer', select: 'name phone' },
      { path: 'assignedTo', select: 'name' },
      { path: 'parts.part', select: 'name sku' },
    ]);

    // Notify customer if status changed
    if (status && status !== prevStatus) {
      notifyCustomer(populated, status).catch(() => {});
    }

    res.json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ─── JOB PHOTOS ──────────────────────────────────────────────────────────────

const uploadJobPhoto = async (req, res, next) => {
  try {
    const job = await RepairJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
    if (job.photos.length >= 10) return res.status(400).json({ success: false, error: 'Maximum 10 photos per job.' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });

    const caption = req.body.caption ? sanitizeText(req.body.caption, 100) : undefined;

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `eazworld/repairs/${job._id}`, transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto' }] },
        (err, r) => err ? reject(err) : resolve(r)
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    job.photos.push({ url: result.secure_url, publicId: result.public_id, caption });
    await job.save();

    res.status(201).json({ success: true, data: job.photos[job.photos.length - 1] });
  } catch (err) { next(err); }
};

const deleteJobPhoto = async (req, res, next) => {
  try {
    const job = await RepairJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const photo = job.photos.id(req.params.photoId);
    if (!photo) return res.status(404).json({ success: false, error: 'Photo not found.' });

    // Delete from Cloudinary
    if (photo.publicId) {
      await cloudinary.uploader.destroy(photo.publicId).catch(() => {}); // best-effort
    }

    photo.deleteOne();
    await job.save();
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ─── PUBLIC TRACKING ─────────────────────────────────────────────────────────

const getJobByToken = async (req, res, next) => {
  try {
    const job = await RepairJob.findOne({ trackingToken: req.params.token })
      .populate('customer', 'name')
      .select('jobNumber deviceBrand deviceModel deviceType status faultDescription repairWork estimatedCompletion completedAt warrantyDays warrantyExpires warrantyNotes createdAt trackingToken photos');

    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    // Only expose what the customer needs — no internal notes, payments, or staff info
    res.json({
      success: true,
      data: {
        jobNumber:           job.jobNumber,
        customerName:        job.customer?.name,
        device:              [job.deviceBrand, job.deviceModel].filter(Boolean).join(' ') || job.deviceType,
        faultDescription:    job.faultDescription,
        repairWork:          job.repairWork || null,
        status:              job.status,
        estimatedCompletion: job.estimatedCompletion || null,
        completedAt:         job.completedAt || null,
        warrantyDays:        job.warrantyDays || 0,
        warrantyExpires:     job.warrantyExpires || null,
        warrantyNotes:       job.warrantyNotes || null,
        warrantyStatus:      job.warrantyStatus,
        createdAt:           job.createdAt,
        photos:              (job.photos || []).map(p => ({ url: p.url, caption: p.caption || null })),
      },
    });
  } catch (err) { next(err); }
};

// ─── WARRANTY ────────────────────────────────────────────────────────────────

const getWarrantyJobs = async (req, res, next) => {
  try {
    const now  = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Active + expiring soon (not yet expired)
    const active = await RepairJob.find({
      warrantyDays:    { $gt: 0 },
      warrantyExpires: { $gte: now },
    })
      .sort({ warrantyExpires: 1 })
      .populate('customer', 'name phone')
      .populate('assignedTo', 'name')
      .select('jobNumber deviceBrand deviceModel status warrantyDays warrantyExpires warrantyNotes customer assignedTo completedAt');

    // Expired in last 90 days
    const expired = await RepairJob.find({
      warrantyDays:    { $gt: 0 },
      warrantyExpires: { $lt: now, $gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
    })
      .sort({ warrantyExpires: -1 })
      .limit(50)
      .populate('customer', 'name phone')
      .select('jobNumber deviceBrand deviceModel status warrantyDays warrantyExpires warrantyNotes customer completedAt');

    res.json({
      success: true,
      data: {
        active:       active.map(j => ({ ...j.toJSON(), warrantyStatus: j.warrantyStatus })),
        expiringSoon: active.filter(j => new Date(j.warrantyExpires) <= in7d).map(j => j.toJSON()),
        expired:      expired.map(j => ({ ...j.toJSON(), warrantyStatus: 'expired' })),
      },
    });
  } catch (err) { next(err); }
};

// ─── PAYMENTS ────────────────────────────────────────────────────────────────

const addPayment = async (req, res, next) => {
  try {
    const job = await RepairJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const { amount, method, reference, notes } = req.body;
    if (!amount || !method) return res.status(400).json({ success: false, error: 'Amount and method are required.' });

    const payment = await PosPayment.create({
      job:        job._id,
      amount:     Number(amount),
      method,
      reference:  reference ? sanitizeText(reference, 100) : undefined,
      notes:      notes     ? sanitizeText(notes, 300)     : undefined,
      receivedBy: req.user._id,
    });

    // Deduct inventory stock once per job (on first payment)
    if (!job.stockDeducted) {
      const partsWithStock = job.parts.filter(p => p.part);
      for (const p of partsWithStock) {
        await Part.findByIdAndUpdate(p.part, {
          $inc: { quantity: -(p.quantity || 1) },
        });
      }
      job.stockDeducted = true;
      await job.save();
    }

    await payment.populate('receivedBy', 'name');
    res.status(201).json({ success: true, data: payment });
  } catch (err) { next(err); }
};

// ─── INVENTORY ───────────────────────────────────────────────────────────────

const getParts = async (req, res, next) => {
  try {
    const { q, category, lowStock, retail, page = 1, limit = 50 } = req.query;
    const query = {};
    if (category)       query.category  = category;
    if (retail === 'true') query.isRetail = true;
    if (lowStock === 'true') query.$expr = { $lte: ['$quantity', '$lowStockThreshold'] };
    if (q) query.$or = [
      { name:    { $regex: q, $options: 'i' } },
      { sku:     { $regex: q, $options: 'i' } },
      { barcode: { $regex: q, $options: 'i' } },
    ];
    const [parts, total] = await Promise.all([
      Part.find(query).sort({ name: 1 }).skip((page - 1) * limit).limit(Number(limit)).populate('supplier', 'name phone'),
      Part.countDocuments(query),
    ]);
    res.json({ success: true, data: parts, total });
  } catch (err) { next(err); }
};

// ── Fast barcode / IMEI scan lookup ─────────────────────────────────────────
// Returns a product OR an existing repair job — single endpoint, < 50ms
const scanLookup = async (req, res, next) => {
  try {
    const code = sanitizeText(req.params.code, 100).trim();
    if (!code) return res.status(400).json({ success: false, error: 'Code required.' });

    // 1. Exact barcode match on Part (fastest path — indexed)
    const part = await Part.findOne({ barcode: code });
    if (part) return res.json({ success: true, type: 'product', data: part });

    // 2. IMEI match on an active repair job
    if (/^\d{14,15}$/.test(code)) {
      const job = await RepairJob.findOne({ imei: code, status: { $nin: ['collected', 'cancelled'] } })
        .populate('customer', 'name phone')
        .populate('assignedTo', 'name');
      if (job) return res.json({ success: true, type: 'repair_job', data: job });
    }

    // 3. SKU fallback
    const bySku = await Part.findOne({ sku: code });
    if (bySku) return res.json({ success: true, type: 'product', data: bySku });

    return res.status(404).json({ success: false, error: 'Not found. Try searching manually.' });
  } catch (err) { next(err); }
};

const createPart = async (req, res, next) => {
  try {
    const { name, sku, category, quantity, lowStockThreshold, costPrice, sellingPrice, compatibleWith, notes, supplier } = req.body;
    if (!name || costPrice == null || sellingPrice == null) {
      return res.status(400).json({ success: false, error: 'Name, cost price, and selling price are required.' });
    }
    const part = await Part.create({
      name:              sanitizeText(name, 150),
      sku:               sku ? sanitizeText(sku, 50) : undefined,
      category:          category || 'Other',
      quantity:          Number(quantity) || 0,
      lowStockThreshold: Number(lowStockThreshold) || 3,
      costPrice:         Number(costPrice),
      sellingPrice:      Number(sellingPrice),
      supplier:          supplier || undefined,
      compatibleWith:    Array.isArray(compatibleWith) ? compatibleWith.map(s => sanitizeText(s, 100)).filter(Boolean) : [],
      notes:             notes ? sanitizeText(notes, 500) : undefined,
    });
    res.status(201).json({ success: true, data: part });
  } catch (err) { next(err); }
};

const updatePart = async (req, res, next) => {
  try {
    const update = {};
    const fields = ['name', 'sku', 'category', 'quantity', 'lowStockThreshold', 'costPrice', 'sellingPrice', 'supplier', 'compatibleWith', 'notes'];
    for (const f of fields) {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    }
    const part = await Part.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!part) return res.status(404).json({ success: false, error: 'Part not found.' });
    res.json({ success: true, data: part });
  } catch (err) { next(err); }
};

const deletePart = async (req, res, next) => {
  try {
    const part = await Part.findByIdAndDelete(req.params.id);
    if (!part) return res.status(404).json({ success: false, error: 'Part not found.' });
    res.json({ success: true, message: 'Part deleted.' });
  } catch (err) { next(err); }
};

// ─── STAFF ───────────────────────────────────────────────────────────────────

const getStaff = async (req, res, next) => {
  try {
    // roles param lets callers filter: ?roles=staff,technician
    const rolesParam = req.query.roles;
    const roles = rolesParam
      ? rolesParam.split(',').map(r => r.trim()).filter(Boolean)
      : ['staff', 'cashier', 'technician'];
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

    const allowed = ['cashier', 'technician', 'staff'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be cashier, technician, or staff.' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, error: 'Email already registered.' });

    const user = await User.create({ name, email, ...(phone ? { phone } : {}), password, role, isVerified: true });
    res.status(201).json({ success: true, data: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { next(err); }
};

// ─── REPORTS ─────────────────────────────────────────────────────────────────

const getOverview = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    // Date range filter (defaults to all-time for range stats)
    const { from, to } = req.query;
    const rangeStart = from ? new Date(from) : null;
    const rangeEnd   = to   ? new Date(new Date(to).setHours(23, 59, 59, 999)) : null;
    const rangeMatch = rangeStart && rangeEnd ? { createdAt: { $gte: rangeStart, $lte: rangeEnd } } : {};

    const [
      totalJobs, todayJobs, pendingJobs, readyJobs,
      totalCustomers, todayPayments, allPayments, lowStockCount,
    ] = await Promise.all([
      RepairJob.countDocuments(),
      RepairJob.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } }),
      RepairJob.countDocuments({ status: { $in: ['received', 'diagnosing', 'repairing'] } }),
      RepairJob.countDocuments({ status: 'ready' }),
      PosCustomer.countDocuments(),
      PosPayment.aggregate([
        { $match: { createdAt: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      PosPayment.aggregate([
        { $match: Object.keys(rangeMatch).length ? rangeMatch : {} },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Part.countDocuments({ $expr: { $lte: ['$quantity', '$lowStockThreshold'] } }),
    ]);

    // Daily revenue for the range (or last 30 days)
    const chartStart = rangeStart || new Date(new Date(today).setDate(today.getDate() - 29));
    const dailyRevenue = await PosPayment.aggregate([
      { $match: { createdAt: { $gte: chartStart, ...(rangeEnd ? { $lte: rangeEnd } : {}) } } },
      { $group: {
        _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Payment method breakdown
    const paymentMethods = await PosPayment.aggregate([
      { $match: Object.keys(rangeMatch).length ? rangeMatch : {} },
      { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);

    // Job status breakdown
    const jobsByStatus = await RepairJob.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Top parts used in repair jobs
    const topParts = await RepairJob.aggregate([
      { $unwind: '$parts' },
      { $group: {
        _id:      '$parts.name',
        timesUsed: { $sum: '$parts.quantity' },
        revenue:  { $sum: { $multiply: ['$parts.priceAtTime', '$parts.quantity'] } },
        cost:     { $sum: { $multiply: ['$parts.costAtTime',  '$parts.quantity'] } },
      }},
      { $addFields: { profit: { $subtract: ['$revenue', '$cost'] } } },
      { $sort: { timesUsed: -1 } },
      { $limit: 8 },
    ]);

    // Most profitable jobs
    const topProfitJobs = await RepairJob.aggregate([
      { $match: { status: { $in: ['collected', 'ready'] }, ...( Object.keys(rangeMatch).length ? rangeMatch : {} ) } },
      { $addFields: {
        totalRevenue: { $add: [
          { $ifNull: ['$diagnosisFee', 0] },
          { $ifNull: ['$laborCost', 0] },
          { $sum: { $map: { input: '$parts', as: 'p', in: { $multiply: ['$$p.priceAtTime', '$$p.quantity'] } } } },
        ]},
        totalCost: { $sum: { $map: { input: '$parts', as: 'p', in: { $multiply: ['$$p.costAtTime', '$$p.quantity'] } } } },
      }},
      { $addFields: { grossProfit: { $subtract: ['$totalRevenue', '$totalCost'] } } },
      { $sort: { grossProfit: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'poscustomers', localField: 'customer', foreignField: '_id', as: 'customer' } },
      { $unwind: { path: '$customer', preserveNullAndEmpty: true } },
      { $project: { jobNumber: 1, deviceBrand: 1, deviceModel: 1, totalRevenue: 1, totalCost: 1, grossProfit: 1, 'customer.name': 1 } },
    ]);

    // Technician performance
    const techPerformance = await RepairJob.aggregate([
      { $match: { assignedTo: { $exists: true, $ne: null } } },
      { $group: {
        _id:       '$assignedTo',
        jobCount:  { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'collected'] }, 1, 0] } },
      }},
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'tech' } },
      { $unwind: '$tech' },
      { $project: { name: '$tech.name', jobCount: 1, completed: 1 } },
      { $sort: { jobCount: -1 } },
    ]);

    // Recent jobs
    const recentJobs = await RepairJob.find(Object.keys(rangeMatch).length ? rangeMatch : {})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('customer', 'name phone')
      .populate('assignedTo', 'name')
      .select('jobNumber status priority deviceBrand deviceModel createdAt laborCost parts diagnosisFee');

    // Expenses for the same range
    const expenseMatch = rangeStart && rangeEnd
      ? { date: { $gte: rangeStart, $lte: rangeEnd } }
      : {};
    const [expenseTotal, expenseByCategory] = await Promise.all([
      Expense.aggregate([
        { $match: expenseMatch },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: expenseMatch },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
    ]);

    const totalExpenses = expenseTotal[0]?.total || 0;
    const totalRevenue  = allPayments[0]?.total  || 0;

    res.json({
      success: true,
      data: {
        stats: {
          totalJobs,
          todayJobs,
          pendingJobs,
          readyJobs,
          totalCustomers,
          todayRevenue:  todayPayments[0]?.total  || 0,
          totalRevenue,
          totalPayments: allPayments[0]?.count    || 0,
          lowStockCount,
          totalExpenses,
          netProfit:     totalRevenue - totalExpenses,
        },
        dailyRevenue,
        paymentMethods,
        jobsByStatus,
        topParts,
        techPerformance,
        recentJobs,
        expenseByCategory,
        topProfitJobs,
      },
    });
  } catch (err) { next(err); }
};

// ─── REMINDERS ───────────────────────────────────────────────────────────────

const triggerReminders = async (req, res, next) => {
  try {
    const { runReminderJob } = require('../services/reminderJob');
    // Run async — don't wait for it to finish
    runReminderJob().catch(err => console.error('[reminders] manual trigger error:', err.message));
    res.json({ success: true, message: 'Reminder job triggered. Check server logs.' });
  } catch (err) { next(err); }
};

const getUncollectedJobs = async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '3', 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const jobs = await RepairJob.find({
      status:    'ready',
      updatedAt: { $lte: cutoff },
    })
      .sort({ updatedAt: 1 })
      .populate('customer', 'name phone')
      .populate('assignedTo', 'name')
      .select('jobNumber deviceBrand deviceModel status updatedAt remindersSent lastReminderAt customer assignedTo');

    const data = jobs.map(j => ({
      ...j.toJSON(),
      daysWaiting: Math.floor((Date.now() - new Date(j.updatedAt)) / (1000 * 60 * 60 * 24)),
    }));

    res.json({ success: true, data, total: data.length });
  } catch (err) { next(err); }
};

// ─── EXPENSES ────────────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = ['rent','utilities','tools','parts','salaries','marketing','transport','maintenance','other'];

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
    res.status(201).json({ success: true, data: expense });
  } catch (err) { next(err); }
};

const updateExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found.' });
    const { amount, category, description, date, notes } = req.body;
    if (amount      !== undefined) expense.amount      = Number(amount);
    if (category    !== undefined) expense.category    = EXPENSE_CATEGORIES.includes(category) ? category : 'other';
    if (description !== undefined) expense.description = sanitizeText(description, 500);
    if (notes       !== undefined) expense.notes       = sanitizeText(notes, 500);
    if (date        !== undefined) expense.date        = new Date(date);
    await expense.save();
    await expense.populate('createdBy', 'name');
    res.json({ success: true, data: expense });
  } catch (err) { next(err); }
};

const deleteExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found.' });
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
      { name:          { $regex: q, $options: 'i' } },
      { contactPerson: { $regex: q, $options: 'i' } },
      { phone:         { $regex: q, $options: 'i' } },
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
    res.status(201).json({ success: true, data: supplier });
  } catch (err) { next(err); }
};

const updateSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });
    const { name, contactPerson, phone, email, address, notes, isActive } = req.body;
    if (name          !== undefined) supplier.name          = sanitizeName(name, 100);
    if (contactPerson !== undefined) supplier.contactPerson = sanitizeName(contactPerson, 100);
    if (phone         !== undefined) supplier.phone         = sanitizePhone(phone);
    if (email         !== undefined) supplier.email         = sanitizeEmail(email);
    if (address       !== undefined) supplier.address       = sanitizeText(address, 300);
    if (notes         !== undefined) supplier.notes         = sanitizeText(notes, 500);
    if (isActive      !== undefined) supplier.isActive      = Boolean(isActive);
    await supplier.save();
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
};

const deleteSupplier = async (req, res, next) => {
  try {
    // Unlink parts before deleting
    await Part.updateMany({ supplier: req.params.id }, { $unset: { supplier: '' } });
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ─── SALES (atomic) ──────────────────────────────────────────────────────────

/**
 * POST /pos/sales
 * Atomically: validate stock → deduct → record sale → return receipt
 * Uses MongoDB session to prevent partial writes.
 */
const createSale = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      items,          // [{ partId, quantity }]
      paymentMethod,  // cash | momo | card | split
      amountPaid,
      discount = 0,
      momoReference,
      customerName,
      customerId,
      notes,
    } = req.body;

    if (!items?.length)   return res.status(400).json({ success: false, error: 'Cart is empty.' });
    if (!paymentMethod)   return res.status(400).json({ success: false, error: 'Payment method required.' });
    if (amountPaid == null) return res.status(400).json({ success: false, error: 'Amount paid is required.' });

    const saleItems = [];
    let   subtotal  = 0;

    // Validate + lock items within transaction
    for (const { partId, quantity } of items) {
      const qty  = Math.max(1, Number(quantity) || 1);
      const part = await Part.findById(partId).session(session);

      if (!part) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, error: `Product not found: ${partId}` });
      }

      // Stock check — respect allowNegativeStock flag
      if (!part.allowNegativeStock && part.quantity < qty) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error:   `Insufficient stock for "${part.name}". Available: ${part.quantity}, Requested: ${qty}`,
        });
      }

      // Deduct stock atomically
      await Part.findByIdAndUpdate(
        part._id,
        { $inc: { quantity: -qty } },
        { session }
      );

      const line = { part: part._id, name: part.name, barcode: part.barcode, sku: part.sku, quantity: qty, unitPrice: part.sellingPrice, subtotal: part.sellingPrice * qty };
      saleItems.push(line);
      subtotal += line.subtotal;
    }

    const disc    = Number(discount) || 0;
    const total   = Math.max(0, subtotal - disc);
    const paid    = Number(amountPaid);
    const change  = Math.max(0, paid - total);

    if (paid < total && paymentMethod !== 'split') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, error: `Underpaid. Total: ${total}, Paid: ${paid}` });
    }

    const [sale] = await Sale.create([{
      items:         saleItems,
      subtotal,
      discount:      disc,
      total,
      paymentMethod,
      amountPaid:    paid,
      changeDue:     change,
      momoReference: momoReference ? sanitizeText(momoReference, 100) : undefined,
      customer:      customerId    || undefined,
      customerName:  customerName  ? sanitizeName(customerName, 100) : undefined,
      cashier:       req.user._id,
      notes:         notes ? sanitizeText(notes, 300) : undefined,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ success: true, data: sale });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

const getSales = async (req, res, next) => {
  try {
    const { page = 1, limit = 30, q } = req.query;
    const query = { voided: { $ne: true } };
    if (q) query.$or = [
      { saleNumber:    { $regex: q, $options: 'i' } },
      { customerName:  { $regex: q, $options: 'i' } },
    ];
    const [sales, total] = await Promise.all([
      Sale.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit))
        .populate('cashier', 'name').populate('customer', 'name phone'),
      Sale.countDocuments(query),
    ]);
    res.json({ success: true, data: sales, total });
  } catch (err) { next(err); }
};

const getSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('cashier', 'name')
      .populate('customer', 'name phone');
    if (!sale) return res.status(404).json({ success: false, error: 'Sale not found.' });
    res.json({ success: true, data: sale });
  } catch (err) { next(err); }
};

const voidSale = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) { await session.abortTransaction(); return res.status(404).json({ success: false, error: 'Sale not found.' }); }
    if (sale.voided) { await session.abortTransaction(); return res.status(400).json({ success: false, error: 'Sale already voided.' }); }

    // Restore stock
    for (const item of sale.items) {
      if (item.part) {
        await Part.findByIdAndUpdate(item.part, { $inc: { quantity: item.quantity } }, { session });
      }
    }

    sale.voided    = true;
    sale.voidedBy  = req.user._id;
    sale.voidedAt  = new Date();
    sale.voidReason = sanitizeText(req.body.reason, 200) || 'No reason given';
    await sale.save({ session });

    await session.commitTransaction();
    session.endSession();
    res.json({ success: true, data: sale });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// ─── PAYSTACK MOMO CHARGE (repair jobs) ──────────────────────────────────────

const MOMO_PROVIDERS = { mtn: 'mtn', vod: 'vod', atl: 'atl', tgo: 'tgo' };

/**
 * POST /pos/jobs/:id/momo-charge
 * Admin enters customer phone + amount → Paystack sends USSD prompt to customer.
 * Customer approves on their phone → webhook confirms → payment recorded.
 */
const initiateMomoCharge = async (req, res, next) => {
  try {
    if (!paystack) return res.status(503).json({ success: false, error: 'Paystack not configured.' });

    const job = await RepairJob.findById(req.params.id).populate('customer', 'name phone email');
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const { phone, provider = 'mtn', amount, email } = req.body;
    const cleanPhone = sanitizePhone(phone);

    if (!cleanPhone) return res.status(400).json({ success: false, error: 'Phone number is required.' });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: 'Amount is required.' });

    const providerKey = MOMO_PROVIDERS[provider?.toLowerCase()] || 'mtn';
    const amountInPesewas = Math.round(Number(amount) * 100);

    // Paystack needs international format: +233XXXXXXXXX
    const intlPhone = cleanPhone.startsWith('0')
      ? '+233' + cleanPhone.slice(1)
      : cleanPhone.startsWith('233') ? '+' + cleanPhone : cleanPhone;

    // Use customer email or generate a placeholder
    const chargeEmail = email
      || job.customer?.email
      || `${cleanPhone}@pos.eazworld.co`;

    const reference = `pos_${job._id}_${crypto.randomBytes(5).toString('hex')}`;

    const charge = await paystack.charge.create({
      amount:       amountInPesewas,
      email:        chargeEmail,
      currency:     'GHS',
      reference,
      mobile_money: { phone: intlPhone, provider: providerKey },
      metadata: {
        jobId:     job._id.toString(),
        jobNumber: job.jobNumber,
        type:      'pos_repair_payment',
        initiatedBy: req.user._id.toString(),
      },
    });

    if (!charge.status || charge.data?.status === 'failed') {
      const reason = charge.data?.message || charge.message || 'Paystack declined the charge request.';
      console.error('[MoMo] Paystack declined:', reason);
      return res.status(400).json({ success: false, error: reason });
    }

    res.json({
      success:   true,
      reference,
      status:    charge.data?.status,
      message:   charge.data?.display_text || charge.message || 'Payment prompt sent to customer.',
    });
  } catch (err) { next(err); }
};

/**
 * GET /pos/jobs/:id/momo-charge/:reference
 * Poll until the charge is confirmed. Frontend calls this every 3s.
 * On success, records the payment automatically.
 */
const checkMomoCharge = async (req, res, next) => {
  try {
    if (!paystack) return res.status(503).json({ success: false, error: 'Paystack not configured.' });

    const { id, reference } = req.params;

    const verify = await paystack.transaction.verify({ reference });

    if (!verify.status) {
      return res.status(400).json({ success: false, error: verify.message || 'Could not verify charge.' });
    }

    const txData = verify.data;
    const txStatus = txData?.status; // 'success' | 'failed' | 'abandoned' | 'pending'

    // Auto-record payment when Paystack confirms success
    if (txStatus === 'success') {
      // Check if this reference was already recorded to prevent duplicates
      const alreadyRecorded = await PosPayment.findOne({ reference });
      if (!alreadyRecorded) {
        await PosPayment.create({
          job:        id,
          amount:     txData.amount / 100,
          method:     'momo',
          reference,
          receivedBy: req.user._id,
          notes:      `MoMo via Paystack · ${txData.channel || 'mobile_money'}`,
        });

        // Deduct inventory stock once per job
        const job = await RepairJob.findById(id);
        if (job && !job.stockDeducted) {
          const partsWithStock = job.parts.filter(p => p.part);
          for (const p of partsWithStock) {
            await Part.findByIdAndUpdate(p.part, {
              $inc: { quantity: -(p.quantity || 1) },
            });
          }
          job.stockDeducted = true;
          await job.save();
        }
      }
    }

    res.json({
      success: true,
      status:  txStatus,
      amount:  txData?.amount ? txData.amount / 100 : 0,
      message: txData?.gateway_response || txStatus,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createCustomer, getCustomers, getCustomer, updateCustomer,
  createJob, getJobs, getJob, updateJob,
  uploadJobPhoto, deleteJobPhoto,
  addPayment,
  getJobByToken,
  getWarrantyJobs,
  getParts, createPart, updatePart, deletePart,
  scanLookup,
  createSale, getSales, getSale, voidSale,
  initiateMomoCharge, checkMomoCharge,
  getStaff, createStaff,
  getOverview,
  getExpenses, createExpense, updateExpense, deleteExpense,
  triggerReminders, getUncollectedJobs,
  getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
};
