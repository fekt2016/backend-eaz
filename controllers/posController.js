const mongoose    = require('mongoose');
const crypto      = require('crypto');
const Paystack    = require('@paystack/paystack-sdk');
const PosCustomer = require('../models/PosCustomer');
const RepairJob   = require('../models/RepairJob');
const Part        = require('../models/Part');
const PosPayment  = require('../models/PosPayment');
const PartOrder   = require('../models/PartOrder');
const RepairOrder = require('../models/RepairOrder');
const DeliveryZone = require('../models/DeliveryZone');
const Sale        = require('../models/Sale');
const User        = require('../models/User');
const Expense     = require('../models/Expense');
const Supplier    = require('../models/Supplier');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText } = require('../utils/sanitize');
const { deductPartStock } = require('../utils/deductPartStock');
const { cloudinary } = require('../config/cloudinary');
const streamifier    = require('streamifier');
const { notifyCustomer, sendCredentialsSms } = require('../services/notify');
const { sendAccountCreatedEmail } = require('../utils/email');

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
const paystack = (paystackSecret && paystackSecret.startsWith('sk_'))
  ? new Paystack(paystackSecret)
  : null;

const FRONTEND_URL = require('../utils/frontendUrl')();

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('233')) digits = `0${digits.slice(3)}`;
  return digits;
}

/**
 * Outstanding balance for a job in pesewas, mirroring the staff POS invoice:
 *   total  = (requiresDiagnosis ? diagnosisFee : 0) + Σ(parts.priceAtTime × qty) + laborCost
 *   paid   = Σ(PosPayment.amount)
 * All monetary fields are already integer pesewas, so no conversion is needed.
 */
function computeJobBalancePesewas(job, payments = []) {
  const partsTotal = (job.parts || []).reduce(
    (s, p) => s + (p.priceAtTime || 0) * (p.quantity || 1),
    0
  );
  const total =
    (job.requiresDiagnosis ? Number(job.diagnosisFee) || 0 : 0) +
    partsTotal +
    (Number(job.laborCost) || 0);
  const paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  return Math.max(0, Math.round(total - paid));
}

/**
 * Deduct inventory for every inventory-linked job part that hasn't been deducted
 * yet, flagging each line so it's never double-counted. Guarded via
 * deductPartStock — stock never goes negative unless the Part opts in. Mutates
 * `job.parts[].stockDeducted`; the caller is responsible for saving the job.
 */
async function deductJobPartsOnce(job) {
  for (const p of job.parts) {
    if (p.part && !p.stockDeducted) {
      const res = await deductPartStock(p.part, p.quantity || 1);
      if (!res.ok) {
        console.error(`[stock] decrement skipped for part ${p.part} on job ${job.jobNumber} — insufficient stock.`);
      }
      p.stockDeducted = true;
    }
  }
}

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────

/** Generate a cryptographically-strong password meeting validatePassword rules. */
function generatePassword(length = 12) {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghijkmnopqrstuvwxyz';
  const digits  = '23456789';
  const symbols = '@#$!%&*';
  const all     = upper + lower + digits + symbols;
  const pick    = (chars) => chars[crypto.randomInt(chars.length)];
  const chars   = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  for (let i = chars.length; i < length; i++) chars.push(pick(all));
  // Fisher–Yates shuffle so the required character classes aren't at fixed positions
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

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

    res.status(201).json({ success: true, data: customer, account });
  } catch (err) { next(err); }
};

const getCustomers = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 30 } = req.query;
    const query = q
      ? { $or: [
          { name:  { $regex: escapeRegex(q), $options: 'i' } },
          { phone: { $regex: escapeRegex(q), $options: 'i' } },
          { email: { $regex: escapeRegex(q), $options: 'i' } },
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

const ACTIVE_JOB_STATUSES = ['received', 'diagnosing', 'waiting_for_parts', 'repairing', 'ready'];

/** Assign the least-loaded technician from the User collection to a job. */
async function findTechnicianToAssign() {
  const technicians = await User.find({ role: 'technician' }).select('_id name').lean();
  if (!technicians.length) return null;

  const activeCounts = await RepairJob.aggregate([
    { $match: { assignedTo: { $in: technicians.map(t => t._id) }, status: { $in: ACTIVE_JOB_STATUSES } } },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(activeCounts.map(c => [c._id.toString(), c.count]));

  technicians.sort((a, b) => (counts[a._id.toString()] || 0) - (counts[b._id.toString()] || 0));
  return technicians[0]._id;
}

const createJob = async (req, res, next) => {
  try {
    const {
      customerId, deviceType, deviceBrand, deviceModel,
      imei, color, faultDescription, priority, assignedTo, notes, depositPaid,
      requiresDiagnosis, diagnosisFee, dropoff, pickupAddress,
      parts, paymentAmount, paymentMethod, paymentReference,
    } = req.body;

    if (!customerId) return res.status(400).json({ success: false, error: 'Customer is required.' });
    const fault = sanitizeText(faultDescription, 1000);
    if (!fault) return res.status(400).json({ success: false, error: 'Fault description is required.' });

    // How the device reaches the shop — walk-in by default, or rider pickup
    const cleanDropoff = dropoff === 'rider' ? 'rider' : 'bring';
    const cleanPickup  = pickupAddress !== undefined ? sanitizeText(pickupAddress, 300) : undefined;
    if (cleanDropoff === 'rider' && !cleanPickup) {
      return res.status(400).json({ success: false, error: 'Pickup address is required when the device is sent by rider.' });
    }

    const customer = await PosCustomer.findById(customerId);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found.' });

    // Resolve inventory-linked parts → snapshot name + prices at time of job
    let partsList = [];
    if (Array.isArray(parts) && parts.length) {
      const partIds = parts.map(p => p.partId).filter(Boolean);
      const inventory = partIds.length
        ? await Part.find({ _id: { $in: partIds } }).select('_id name sellingPrice costPrice')
        : [];
      const partMap = Object.fromEntries(inventory.map(p => [p._id.toString(), p]));
      partsList = parts
        .filter(p => p.partId && partMap[p.partId])
        .map(p => {
          const part = partMap[p.partId];
          return {
            part:        part._id,
            name:        part.name,
            quantity:    Math.max(1, Number(p.quantity) || 1),
            // Snapshots stored in integer pesewas — same unit as Part.
            priceAtTime: Math.round(Number(part.sellingPrice)),
            costAtTime:  Math.round(Number(part.costPrice)),
          };
        });
    }

    // Assign a technician — if none (or an invalid one) was supplied, pick the
    // least-loaded technician from the User collection so every job is assigned.
    let assignedTech = assignedTo;
    if (assignedTech && !mongoose.Types.ObjectId.isValid(assignedTech)) assignedTech = undefined;
    if (assignedTech) {
      const tech = await User.findOne({ _id: assignedTech, role: 'technician' }).select('_id');
      if (!tech) assignedTech = undefined;
    }
    if (!assignedTech) assignedTech = await findTechnicianToAssign();
    if (!assignedTech) {
      return res.status(400).json({ success: false, error: 'No technician available. Create a technician (Users → Add Staff) and try again.' });
    }

    const job = await RepairJob.create({
      customer:         customerId,
      deviceType:       deviceType || 'Phone',
      deviceBrand:      sanitizeText(deviceBrand, 60)  || undefined,
      deviceModel:      sanitizeText(deviceModel, 100) || undefined,
      imei:             sanitizeText(imei, 20)         || undefined,
      color:            sanitizeText(color, 40)        || undefined,
      faultDescription:  fault,
      priority:          priority === 'urgent' ? 'urgent' : 'normal',
      assignedTo:        assignedTech || undefined,
      notes:             sanitizeText(notes, 1000) || undefined,
      depositPaid:       Number(depositPaid) || 0,
      requiresDiagnosis: !!requiresDiagnosis,
      diagnosisFee:      requiresDiagnosis ? (Number(diagnosisFee) || 0) : 0,
      parts:             partsList,
      createdBy:         req.user._id,
    });

    const populated = await job.populate([
      { path: 'customer', select: 'name phone email' },
      { path: 'assignedTo', select: 'name' },
      { path: 'createdBy', select: 'name' },
      { path: 'parts.part', select: 'name sku' },
    ]);

    // Notify customer — job received
    notifyCustomer(populated, 'received').catch(() => {});

    // Record an upfront payment (parts / deposit) with the job from the start.
    const paid = Number(paymentAmount) || 0;
    if (paid > 0) {
      const method = ['cash', 'momo', 'card'].includes(paymentMethod) ? paymentMethod : 'cash';
      await PosPayment.create({
        job:        job._id,
        amount:     paid,
        method,
        reference:  paymentReference ? sanitizeText(paymentReference, 100) : undefined,
        receivedBy: req.user._id,
      });

      // Deduct inventory once — guarded, and per-line flagged so online
      // part-orders that already reserved stock aren't double-counted.
      if (!job.stockDeducted) {
        await deductJobPartsOnce(job);
        job.stockDeducted = true;
        await job.save();
      }
    }

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ─── PUBLIC JOB REQUEST (self-serve online intake) ───────────────────────────

/**
 * POST /track/repair-requests
 * Public — a customer books a repair online with no account.
 * They choose how the device reaches the shop: 'bring' (walk-in) or 'rider'
 * (they send a rider / we arrange pickup). Auto-assigns the least-loaded
 * technician and texts/emails the tracking link.
 */
const createPublicJob = async (req, res, next) => {
  try {
    const {
      name, email, phone,
      deviceType, deviceBrand, deviceModel, imei, color,
      faultDescription, dropoff, pickupAddress,
    } = req.body;

    const cleanPhone = sanitizePhone(phone);
    if (!cleanPhone) {
      return res.status(400).json({ success: false, error: 'A valid phone number is required.' });
    }

    const fault = sanitizeText(faultDescription, 1000);
    if (!fault) {
      return res.status(400).json({ success: false, error: 'Please tell us what seems wrong with the device.' });
    }

    const cleanDropoff = dropoff === 'rider' ? 'rider' : 'bring';
    const cleanPickup  = sanitizeText(pickupAddress, 300);
    if (cleanDropoff === 'rider' && !cleanPickup) {
      return res.status(400).json({ success: false, error: 'Please add the pickup address for the rider.' });
    }

    const allowedTypes = ['Phone', 'Tablet', 'Laptop', 'Smartwatch', 'Other'];
    const cleanType    = allowedTypes.includes(deviceType) ? deviceType : 'Phone';

    // Reuse the customer by phone — never duplicate.
    let customer = await PosCustomer.findOne({ phone: cleanPhone });
    if (!customer) {
      customer = await PosCustomer.create({
        phone: cleanPhone,
        name:  sanitizeName(name, 100) || undefined,
        email: sanitizeEmail(email) || undefined,
      });
    }

    const assignedTech = await findTechnicianToAssign();

    const job = await RepairJob.create({
      customer:         customer._id,
      deviceType:       cleanType,
      deviceBrand:      sanitizeText(deviceBrand, 60)   || undefined,
      deviceModel:      sanitizeText(deviceModel, 100)  || undefined,
      imei:             sanitizeText(imei, 20)          || undefined,
      color:            sanitizeText(color, 40)         || undefined,
      faultDescription: fault,
      dropoff:          cleanDropoff,
      pickupAddress:    cleanDropoff === 'rider' ? cleanPickup : undefined,
      assignedTo:       assignedTech || undefined,
      // No staff creator — this came in through the website
      createdBy:        undefined,
    });

    const populated = await job.populate([
      { path: 'customer', select: 'name phone email' },
      { path: 'assignedTo', select: 'name' },
    ]);

    // Tell the customer immediately — SMS/email with the tracking link
    notifyCustomer(populated, 'received').catch(() => {});

    res.status(201).json({
      success: true,
      data: {
        jobNumber:     populated.jobNumber,
        trackingToken: populated.trackingToken,
        trackingUrl:   `${FRONTEND_URL}/track/${populated.trackingToken}`,
        dropoff:       populated.dropoff,
        pickupAddress: populated.pickupAddress || null,
        customer: populated.customer
          ? { name: populated.customer.name, phone: populated.customer.phone }
          : null,
      },
    });
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
      const safe = escapeRegex(q);
      const customers = await PosCustomer.find({
        $or: [
          { name:  { $regex: safe, $options: 'i' } },
          { phone: { $regex: safe, $options: 'i' } },
        ],
      }).select('_id');
      query.$or = [
        { jobNumber:    { $regex: safe, $options: 'i' } },
        { deviceBrand:  { $regex: safe, $options: 'i' } },
        { deviceModel:  { $regex: safe, $options: 'i' } },
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
    // Technicians re-route jobs; an empty value keeps the current assignee so a
    // job is never left unassigned.
    if (assignedTo !== undefined && assignedTo) job.assignedTo = assignedTo;
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
          // Snapshots stored in integer pesewas — same unit as Part. Custom
          // (non-inventory) prices arrive from the client already in pesewas.
          priceAtTime: p.partId && priceMap[p.partId] != null
            ? Math.round(Number(priceMap[p.partId].sell))
            : Math.max(0, Math.round(Number(p.cost || p.priceAtTime) || 0)),
          costAtTime: p.partId && priceMap[p.partId] != null
            ? Math.round(Number(priceMap[p.partId].cost))
            : Math.max(0, Math.round(Number(p.costAtTime) || 0)),
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
      { path: 'customer', select: 'name phone email' },
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
      .select('jobNumber deviceBrand deviceModel deviceType status faultDescription repairWork estimatedCompletion completedAt warrantyDays warrantyExpires warrantyNotes createdAt trackingToken parts photos dropoff pickupAddress requiresDiagnosis diagnosisFee laborCost depositPaid');

    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const [partOrders, repairOrders, payments] = await Promise.all([
      PartOrder.find({ job: job._id })
        .select('partName quantity unitPriceGhs amountGhs status createdAt paystackReference')
        .sort({ createdAt: -1 }),
      RepairOrder.find({ job: job._id })
        .select('items shippingFeePesewas subtotalPesewas totalPesewas status createdAt paystackReference deliveryZone')
        .sort({ createdAt: -1 }),
      PosPayment.find({ job: job._id }).select('amount').lean(),
    ]);

    const balancePesewas = computeJobBalancePesewas(job, payments);
    const payable = ['received', 'diagnosing', 'waiting_for_parts', 'repairing', 'ready'].includes(job.status);

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
        dropoff:             job.dropoff || 'bring',
        pickupAddress:       job.pickupAddress || null,
        balanceDuePesewas:   balancePesewas,
        canPayBalance:       payable && balancePesewas > 0,
        photos:              (job.photos || []).map(p => ({ url: p.url, caption: p.caption || null })),
        parts:               (job.parts || []).map(p => ({
          id:        p._id,
          name:      p.name,
          quantity:  p.quantity,
          priceGhs:  p.priceAtTime || 0,
          isLinked:  Boolean(p.part),
        })),
        partOrders: partOrders.map(o => ({
          id:             o._id,
          partName:       o.partName,
          quantity:       o.quantity,
          amountGhs:      o.amountGhs,
          status:         o.status,
          reference:      o.paystackReference || null,
          createdAt:      o.createdAt,
        })),
        repairOrders: repairOrders.map(o => ({
          id:              o._id,
          items:           (o.items || []).map(i => ({
            partName:    i.partName,
            quantity:    i.quantity,
            unitPriceGhs: i.unitPriceGhs,
          })),
          shippingFeePesewas: o.shippingFeePesewas,
          subtotalPesewas:    o.subtotalPesewas,
          totalPesewas:       o.totalPesewas,
          status:         o.status,
          reference:      o.paystackReference || null,
          createdAt:      o.createdAt,
        })),
      },
    });
  } catch (err) { next(err); }
};

/**
 * POST /track/:token/part-orders
 * Public — the customer prepays for a part on their repair job via Paystack.
 * The part must already be a line on the job; the price is always read
 * server-side from the job (never from the client).
 */
const createPartOrder = async (req, res, next) => {
  try {
    if (!paystack) return res.status(503).json({ success: false, error: 'Paystack not configured.' });

    const { token } = req.params;
    const { partLineId, quantity = 1, name, phone, email: rawEmail } = req.body;

    const job = await RepairJob.findOne({ trackingToken: token }).populate('customer', 'name phone email');
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const cleanPhone = sanitizePhone(phone);
    if (!cleanPhone) return res.status(400).json({ success: false, error: 'Phone number is required.' });
    if (!job.customer?.phone || normalizePhone(cleanPhone) !== normalizePhone(job.customer.phone)) {
      return res.status(403).json({ success: false, error: 'Phone number does not match this repair job.' });
    }

    // Capture the customer's email so future repair updates go by email (primary channel).
    const cleanEmail = sanitizeEmail(rawEmail);
    if (cleanEmail && (!job.customer?.email || job.customer.email !== cleanEmail)) {
      await PosCustomer.findByIdAndUpdate(job.customer._id, { email: cleanEmail });
    }

    if (!mongoose.Types.ObjectId.isValid(partLineId)) {
      return res.status(400).json({ success: false, error: 'Invalid part.' });
    }
    const partLine = job.parts.id(partLineId);
    if (!partLine) return res.status(400).json({ success: false, error: 'Part not found on this job.' });
    if (!Number(partLine.priceAtTime)) {
      return res.status(400).json({ success: false, error: 'This part has no price yet. Please contact the shop.' });
    }

    const qty          = Math.max(1, Math.min(10, Math.floor(Number(quantity) || 1)));
    // priceAtTime is already integer pesewas; the *Ghs field names are kept for
    // compatibility but now carry pesewas (see PHASE7 money standardization).
    const unitPriceGhs = Math.max(0, Math.round(Number(partLine.priceAtTime)));
    const amountGhs    = unitPriceGhs * qty;
    const subtotalPesewas = amountGhs;

    const email     = cleanEmail || job.customer?.email || `${cleanPhone}@pos.eazworld.co`;
    const reference = `PRT_${job._id}_${crypto.randomBytes(5).toString('hex')}`;

    const transaction = await paystack.transaction.initialize({
      email,
      amount:   subtotalPesewas,
      currency: 'GHS',
      reference,
      channels: ['card', 'mobile_money'],
      metadata: { type: 'repair_part_order', jobId: job._id.toString(), jobNumber: job.jobNumber },
      callback_url: `${FRONTEND_URL}/track/${token}`,
    });

    if (!transaction.status) {
      return res.status(500).json({ success: false, error: 'Failed to initialize payment.' });
    }

    const partOrder = await PartOrder.create({
      job:            job._id,
      part:           partLine.part || undefined,
      partName:       partLine.name,
      quantity:       qty,
      unitPriceGhs,
      subtotalPesewas,
      amountGhs,
      customerName:   sanitizeName(name, 100),
      customerPhone:  cleanPhone,
      status:         'pending',
      paystackReference: transaction.data.reference,
    });

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        reference:        transaction.data.reference,
        partOrderId:      partOrder._id,
      },
    });
  } catch (err) { next(err); }
};

/**
 * GET /track/parts
 * Public — the parts catalogue customers can order for their repair. Only
 * sellable, in-stock parts with a price are shown; cost/supplier stays hidden.
 */
const getPublicParts = async (req, res, next) => {
  try {
    const { q, category } = req.query;
    const query = { sellingPrice: { $gt: 0 } };
    if (category && category !== 'all') query.category = category;
    if (q && String(q).trim()) {
      const term = String(q).trim();
      query.$or = [
        { name:           { $regex: escapeRegex(term), $options: 'i' } },
        { sku:            { $regex: escapeRegex(term), $options: 'i' } },
        { barcode:        { $regex: escapeRegex(term), $options: 'i' } },
        { compatibleWith: { $regex: escapeRegex(term), $options: 'i' } },
      ];
    }
    const parts = await Part.find(query)
      .select('name sku category sellingPrice quantity lowStockThreshold compatibleWith description images')
      .sort({ name: 1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: parts });
  } catch (err) { next(err); }
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * POST /track/:token/orders
 * Public — the customer prepays for one or more parts selected from the
 * catalogue (plus an optional rider shipping fee) in a single Paystack
 * transaction. Prices are always read server-side from the Part and
 * DeliveryZone; never from the client.
 */
const createRepairOrder = async (req, res, next) => {
  try {
    if (!paystack) return res.status(503).json({ success: false, error: 'Paystack not configured.' });

    const { token } = req.params;
    const { items, shippingZoneId, name, phone, email: rawEmail } = req.body;

    const job = await RepairJob.findOne({ trackingToken: token }).populate('customer', 'name phone email');
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const cleanPhone = sanitizePhone(phone);
    if (!cleanPhone) return res.status(400).json({ success: false, error: 'Phone number is required.' });
    if (!job.customer?.phone || normalizePhone(cleanPhone) !== normalizePhone(job.customer.phone)) {
      return res.status(403).json({ success: false, error: 'Phone number does not match this repair job.' });
    }

    // Capture the customer's email so future repair updates go by email (primary channel).
    const cleanEmail = sanitizeEmail(rawEmail);
    if (cleanEmail && (!job.customer?.email || job.customer.email !== cleanEmail)) {
      await PosCustomer.findByIdAndUpdate(job.customer._id, { email: cleanEmail });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Select at least one part to order.' });
    }
    if (items.length > 10) {
      return res.status(400).json({ success: false, error: 'Too many parts in one order.' });
    }

    const lineItems = [];
    let subtotalPesewas = 0;

    for (const it of items) {
      const partId = it?.partId;
      const qty    = Math.max(1, Math.min(10, Math.floor(Number(it?.quantity) || 1)));
      if (!mongoose.Types.ObjectId.isValid(partId)) {
        return res.status(400).json({ success: false, error: 'Invalid part selected.' });
      }
      const part = await Part.findById(partId).lean();
      if (!part || !Number(part.sellingPrice) || part.sellingPrice <= 0) {
        return res.status(400).json({ success: false, error: 'That part is not available for ordering.' });
      }
      if (part.quantity < qty) {
        return res.status(400).json({ success: false, error: `Only ${part.quantity} in stock for ${part.name}.` });
      }
      const subtotal = Number(part.sellingPrice) * qty;
      lineItems.push({
        part:           part._id,
        partName:       part.name,
        quantity:       qty,
        // Stored in integer pesewas (field name kept for compatibility).
        unitPriceGhs:   Math.round(Number(part.sellingPrice)),
        subtotalPesewas: subtotal,
      });
      subtotalPesewas += subtotal;
    }

    // Rider shipping — only meaningful when the device comes by rider.
    let shippingFeePesewas = 0;
    let deliveryZone = undefined;
    if (job.dropoff === 'rider' && shippingZoneId) {
      if (!mongoose.Types.ObjectId.isValid(shippingZoneId)) {
        return res.status(400).json({ success: false, error: 'Invalid shipping zone.' });
      }
      const zone = await DeliveryZone.findOne({ _id: shippingZoneId, isActive: true }).lean();
      if (!zone) return res.status(400).json({ success: false, error: 'Shipping zone not found.' });
      deliveryZone      = zone._id;
      shippingFeePesewas = Number(zone.fee) || 0;
    }

    const totalPesewas = subtotalPesewas + shippingFeePesewas;
    const email     = cleanEmail || job.customer?.email || `${cleanPhone}@pos.eazworld.co`;
    const reference = `RPO_${job._id}_${crypto.randomBytes(5).toString('hex')}`;

    const transaction = await paystack.transaction.initialize({
      email,
      amount:   totalPesewas,
      currency: 'GHS',
      reference,
      channels: ['card', 'mobile_money'],
      metadata: { type: 'repair_order', jobId: job._id.toString(), jobNumber: job.jobNumber },
      callback_url: `${FRONTEND_URL}/track/${token}`,
    });

    if (!transaction.status) {
      return res.status(500).json({ success: false, error: 'Failed to initialize payment.' });
    }

    const repairOrder = await RepairOrder.create({
      job:             job._id,
      items:           lineItems,
      deliveryZone:    deliveryZone || undefined,
      shippingFeePesewas,
      subtotalPesewas,
      totalPesewas,
      customerName:    sanitizeName(name, 100),
      customerPhone:   cleanPhone,
      status:          'pending',
      paystackReference: transaction.data.reference,
    });

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        reference:        transaction.data.reference,
        repairOrderId:    repairOrder._id,
      },
    });
  } catch (err) { next(err); }
};

/**
 * POST /track/:token/balance-payment
 * Public — the customer pays the outstanding invoice balance (diagnosis +
 * parts + labour) in one Paystack transaction. The amount is always computed
 * server-side from the job and its recorded payments, never trusted from the
 * client. The phone must match the one on the repair receipt.
 */
const createBalancePayment = async (req, res, next) => {
  try {
    if (!paystack) return res.status(503).json({ success: false, error: 'Paystack not configured.' });

    const { token } = req.params;
    const { phone } = req.body;

    const job = await RepairJob.findOne({ trackingToken: token }).populate('customer', 'name phone email');
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const cleanPhone = sanitizePhone(phone);
    if (!cleanPhone) return res.status(400).json({ success: false, error: 'Phone number is required.' });
    if (!job.customer?.phone || normalizePhone(cleanPhone) !== normalizePhone(job.customer.phone)) {
      return res.status(403).json({ success: false, error: 'Phone number does not match this repair job.' });
    }

    const payments = await PosPayment.find({ job: job._id }).select('amount').lean();
    const balancePesewas = computeJobBalancePesewas(job, payments);

    if (balancePesewas <= 0) {
      return res.status(400).json({ success: false, error: 'Nothing is outstanding on this repair.' });
    }

    const email     = job.customer?.email || `${cleanPhone}@pos.eazworld.co`;
    const reference = `JBAL_${job._id}_${crypto.randomBytes(5).toString('hex')}`;

    const transaction = await paystack.transaction.initialize({
      email,
      amount:   balancePesewas,
      currency: 'GHS',
      reference,
      channels: ['card', 'mobile_money'],
      metadata: { type: 'job_balance', jobId: job._id.toString(), jobNumber: job.jobNumber },
      callback_url: `${FRONTEND_URL}/track/${token}`,
    });

    if (!transaction.status) {
      return res.status(500).json({ success: false, error: 'Failed to initialize payment.' });
    }

    await RepairJob.updateOne(
      { _id: job._id },
      {
        $push: {
          balancePayments: {
            reference,
            amountPesewas: balancePesewas,
            status:        'pending',
          },
        },
      }
    );

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: transaction.data.authorization_url,
        reference:        transaction.data.reference,
        amountPesewas:    balancePesewas,
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

    // Deduct inventory once per job (on first payment) — guarded, and per-line
    // flagged so an online part-order that already reserved stock isn't
    // double-counted here.
    if (!job.stockDeducted) {
      await deductJobPartsOnce(job);
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
      { name:    { $regex: escapeRegex(q), $options: 'i' } },
      { sku:     { $regex: escapeRegex(q), $options: 'i' } },
      { barcode: { $regex: escapeRegex(q), $options: 'i' } },
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
    const { name, sku, category, quantity, lowStockThreshold, costPrice, sellingPrice, compatibleWith, description, images, notes, supplier } = req.body;
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
      description:       description ? sanitizeText(description, 1000) : '',
      images:            Array.isArray(images) ? images.map(i => sanitizeText(i, 500)).filter(Boolean) : [],
      notes:             notes ? sanitizeText(notes, 500) : undefined,
    });
    res.status(201).json({ success: true, data: part });
  } catch (err) { next(err); }
};

const updatePart = async (req, res, next) => {
  try {
    const update = {};
    const fields = ['name', 'sku', 'category', 'quantity', 'lowStockThreshold', 'costPrice', 'sellingPrice', 'supplier', 'compatibleWith', 'description', 'images', 'notes'];
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

/** Technicians list — any POS role can read it so staff can assign jobs. */
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
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
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

// ─── MY DASHBOARD (staff & technician — scoped to the logged-in user) ─────────
// Technician: analytics for the jobs assigned to them, plus recent jobs to update.
// Staff:      the jobs they created, plus the sales (products) they rang up and
//             low-stock parts. Staff may see money; technicians never do.
const getMyOverview = async (req, res, next) => {
  try {
    const userId  = req.user._id;
    const isTech  = req.user.role === 'technician';
    const canSeeMoney = !isTech; // technicians never see money

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    // Which jobs "belong" to this user (drives the personal stat counters):
    //  - technicians own the jobs assigned to them
    //  - everyone else owns the jobs they created
    const jobScope = isTech ? { assignedTo: userId } : { createdBy: userId };

    // The recent-jobs list is intentionally broader than the stat scope: staff
    // should see shop-wide activity (including online-booked jobs that have no
    // creator, and jobs logged by colleagues) so the list is never empty just
    // because they didn't personally create the jobs. Technicians still see
    // only the jobs assigned to them.
    const recentScope = isTech ? { assignedTo: userId } : {};

    const [
      myTotalJobs, myTodayJobs, myPendingJobs, myReadyJobs, myCompletedJobs,
      jobsByStatus, recentJobs,
    ] = await Promise.all([
      RepairJob.countDocuments(jobScope),
      RepairJob.countDocuments({ ...jobScope, createdAt: { $gte: today, $lt: tomorrow } }),
      RepairJob.countDocuments({ ...jobScope, status: { $in: ['received', 'diagnosing', 'repairing'] } }),
      RepairJob.countDocuments({ ...jobScope, status: 'ready' }),
      RepairJob.countDocuments({ ...jobScope, status: 'collected' }),
      RepairJob.aggregate([
        { $match: jobScope },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      RepairJob.find(recentScope)
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('customer', 'name phone')
        .populate('assignedTo', 'name')
        .select('jobNumber status priority deviceBrand deviceModel createdAt parts diagnosisFee laborCost depositPaid'),
    ]);

    const stats = { myTotalJobs, myTodayJobs, myPendingJobs, myReadyJobs, myCompletedJobs };

    // Staff (and above) additionally see the sales they rang up + stock health.
    if (canSeeMoney) {
      const [salesAgg, todaySalesAgg, lowStockCount] = await Promise.all([
        Sale.aggregate([
          { $match: { cashier: userId, voided: { $ne: true } } },
          { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        Sale.aggregate([
          { $match: { cashier: userId, voided: { $ne: true }, createdAt: { $gte: today, $lt: tomorrow } } },
          { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        Part.countDocuments({ $expr: { $lte: ['$quantity', '$lowStockThreshold'] } }),
      ]);
      stats.mySalesCount        = salesAgg[0]?.count        || 0;
      stats.mySalesRevenue      = salesAgg[0]?.revenue      || 0;
      stats.myTodaySalesCount   = todaySalesAgg[0]?.count   || 0;
      stats.myTodaySalesRevenue = todaySalesAgg[0]?.revenue || 0;
      stats.lowStockCount       = lowStockCount;
    }

    res.json({
      success: true,
      data: {
        scope: isTech ? 'technician' : 'staff',
        stats,
        jobsByStatus,
        recentJobs,
      },
    });
  } catch (err) { next(err); }
};

// ─── PART-ORDERS MANAGEMENT (staff) ──────────────────────────────────────────
// Customer part-payments tied to repair jobs (created on the public /track page,
// normally auto-paid by the Paystack webhook). Staff can review them here and
// adjust status — e.g. mark a cash-settled order paid, or cancel a stale one.
const getPartOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = {};
    if (['pending', 'paid', 'cancelled'].includes(status)) query.status = status;
    const [partOrders, repairOrders] = await Promise.all([
      PartOrder.find(query)
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('job', 'jobNumber deviceBrand deviceModel')
        .lean(),
      RepairOrder.find(query)
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('job', 'jobNumber deviceBrand deviceModel')
        .lean(),
    ]);
    // Merge both kinds, newest first, tagged by type so the UI can render each.
    const orders = [
      ...partOrders.map(o => ({ ...o, orderType: 'part' })),
      ...repairOrders.map(o => ({ ...o, orderType: 'repair' })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
};

const updatePartOrder = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['pending', 'paid', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be pending, paid, or cancelled.' });
    }
    const partOrder = await PartOrder.findById(req.params.id);
    if (!partOrder) return res.status(404).json({ success: false, error: 'Part order not found.' });
    partOrder.status = status;
    if (status === 'paid' && !partOrder.paidAt) partOrder.paidAt = new Date();
    await partOrder.save();
    res.json({ success: true, data: partOrder });
  } catch (err) { next(err); }
};

const updateRepairOrder = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['pending', 'paid', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be pending, paid, or cancelled.' });
    }
    const repairOrder = await RepairOrder.findById(req.params.id);
    if (!repairOrder) return res.status(404).json({ success: false, error: 'Repair order not found.' });
    repairOrder.status = status;
    if (status === 'paid' && !repairOrder.paidAt) repairOrder.paidAt = new Date();
    await repairOrder.save();
    res.json({ success: true, data: repairOrder });
  } catch (err) { next(err); }
};

// ─── CUSTOMER: my repairs ────────────────────────────────────────────────────
// A logged-in customer's repair jobs, matched to their account by phone (repairs
// link to a PosCustomer, keyed by a unique phone). Returns the tracking token so
// the client can deep-link to the public /track/:token page.
const getMyRepairs = async (req, res, next) => {
  try {
    // Staff-side roles see every repair job; customers only see their own,
    // matched by the phone (and/or email) linked to their login account.
    if (['superadmin', 'admin', 'staff', 'technician'].includes(req.user.role)) {
      const jobs = await RepairJob.find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .select('jobNumber deviceBrand deviceModel status createdAt estimatedCompletion trackingToken')
        .lean();
      return res.json({ success: true, data: jobs });
    }

    const or = [];
    if (req.user.email) {
      or.push({ email: String(req.user.email).toLowerCase() });
    }
    if (req.user.phone) {
      const digits = normalizePhone(req.user.phone);
      const variants = new Set([req.user.phone, digits]);
      if (digits.startsWith('0')) {
        variants.add(`233${digits.slice(1)}`);
        variants.add(`+233${digits.slice(1)}`);
      }
      if (!/^0/.test(digits) && digits.startsWith('233')) {
        variants.add(`0${digits.slice(3)}`);
      }
      or.push({ phone: { $in: [...variants] } });
    }
    if (!or.length) return res.json({ success: true, data: [] });

    const customers = await PosCustomer.find({ $or: or }).select('_id').lean();
    if (!customers.length) return res.json({ success: true, data: [] });

    const ids = customers.map((c) => c._id);
    const jobs = await RepairJob.find({ customer: { $in: ids } })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('jobNumber deviceBrand deviceModel status createdAt estimatedCompletion trackingToken')
      .lean();
    res.json({ success: true, data: jobs });
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

      const line = {
        part: part._id,
        name: part.name,
        barcode: part.barcode,
        sku: part.sku,
        quantity: qty,
        // Sale stored in integer pesewas — same unit as Part.
        unitPrice: Math.round(Number(part.sellingPrice)),
        subtotal: Math.round(Number(part.sellingPrice)) * qty,
      };
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
    const amountInPesewas = Math.round(Number(amount)); // client sends pesewas

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
 * POST /pos/jobs/:id/card-charge
 * Staff initiates a Paystack card charge for an in-store customer.
 * Returns a checkout link staff can open on their own screen or send to the
 * customer's phone. Webhook + polling confirm it.
 */
const initiateCardCharge = async (req, res, next) => {
  try {
    if (!paystack) return res.status(503).json({ success: false, error: 'Paystack not configured.' });

    const job = await RepairJob.findById(req.params.id).populate('customer', 'name phone email');
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

    const { amount, email } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: 'Amount is required.' });

    const amountInPesewas = Math.round(Number(amount)); // client sends pesewas

    // Use customer email or generate a placeholder
    const chargeEmail = email
      || job.customer?.email
      || `${sanitizePhone(job.customer?.phone) || 'customer'}@pos.eazworld.co`;

    const reference = `poscard_${job._id}_${crypto.randomBytes(5).toString('hex')}`;

    const transaction = await paystack.transaction.initialize({
      amount:       amountInPesewas,
      email:        chargeEmail,
      currency:     'GHS',
      reference,
      channels:     ['card'],
      metadata: {
        jobId:      job._id.toString(),
        jobNumber:  job.jobNumber,
        type:       'pos_repair_payment',
        initiatedBy: req.user._id.toString(),
      },
      callback_url: `${FRONTEND_URL}/dashboard/pos/jobs/${job._id}`,
    });

    if (!transaction.status) {
      const reason = transaction.message || 'Paystack declined the card charge request.';
      console.error('[Card] Paystack declined:', reason);
      return res.status(400).json({ success: false, error: reason });
    }

    res.json({
      success:         true,
      reference,
      authorizationUrl: transaction.data.authorization_url,
      message:         transaction.message || 'Card payment link ready. Open it for the customer.',
    });
  } catch (err) { next(err); }
};

/**
 * GET /pos/jobs/:id/momo-charge/:reference | /card-charge/:reference
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
    const channel = txData?.channel || ''; // 'card' | 'mobile_money' | 'ussd' | ...
    const method  = channel === 'card' ? 'card' : 'momo';

    // Auto-record payment when Paystack confirms success
    if (txStatus === 'success') {
      // Check if this reference was already recorded to prevent duplicates
      const alreadyRecorded = await PosPayment.findOne({ reference });
      if (!alreadyRecorded) {
        await PosPayment.create({
          job:        id,
          amount:     txData.amount, // Paystack reports pesewas
          method,
          reference,
          receivedBy: req.user._id,
          notes:      `${method === 'card' ? 'Card' : 'MoMo'} via Paystack · ${channel || 'card'}`,
        });

        // Deduct inventory once per job — guarded, per-line flagged.
        const job = await RepairJob.findById(id);
        if (job && !job.stockDeducted) {
          await deductJobPartsOnce(job);
          job.stockDeducted = true;
          await job.save();
        }
      }
    }

    res.json({
      success: true,
      status:  txStatus,
      amount:  txData?.amount || 0, // pesewas
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
  getJobByToken, createPartOrder, getMyRepairs, createPublicJob,
  getPublicParts, createRepairOrder, createBalancePayment,
  getWarrantyJobs,
  getParts, createPart, updatePart, deletePart,
  scanLookup,
  createSale, getSales, getSale, voidSale,
  initiateMomoCharge, checkMomoCharge, initiateCardCharge,
  getTechnicians, getStaff, createStaff,
  getOverview, getMyOverview,
  getPartOrders, updatePartOrder, updateRepairOrder,
  getExpenses, createExpense, updateExpense, deleteExpense,
  triggerReminders, getUncollectedJobs,
  getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
};
