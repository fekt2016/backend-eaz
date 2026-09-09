const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, notify, NOTIFICATION_TYPES, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, PART_REPAIR_ORDER_STATUSES, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange, canTransitionPartRepairOrder, canTransitionJobStatus
} = require('./common');
const { paginate } = require('../../utils/pagination');

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
        ? await Product.find({ _id: { $in: partIds } }).select('_id name price costPrice')
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
            // Snapshots stored in integer pesewas — same unit as the catalogue.
            priceAtTime: Math.round(Number(part.price)),
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

    // Notify the assigned technician — in-app (T12)
    notify(assignedTech, {
      type:  NOTIFICATION_TYPES.JOB_ASSIGNED,
      title: `New job assigned: ${job.jobNumber}`,
      body:  `${populated.deviceBrand || ''} ${populated.deviceModel || ''}`.trim() || 'Repair job',
      link:  `/dashboard/pos/jobs/${job._id}`,
      resourceType: 'RepairJob',
      resourceId:   job.jobNumber,
    }).catch(() => {});

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

    await logFromRequest(req, {
      action: ACTIONS.REPAIR_CREATED,
      resourceType: RESOURCES.REPAIR,
      resourceId: job.jobNumber,
      resourceName: job.jobNumber,
      description: `Created repair job ${job.jobNumber} — ${job.deviceBrand || ''} ${job.deviceModel || ''}`.replace(/\s+/g, ' ').trim(),
      metadata: { deviceType: job.deviceType, priority: job.priority, partsCount: partsList.length },
    });

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

    await log({
      action: ACTIONS.REPAIR_CREATED,
      resourceType: RESOURCES.REPAIR,
      resourceId: populated.jobNumber,
      resourceName: populated.jobNumber,
      description: `Self-serve repair request ${populated.jobNumber} — ${populated.customer?.name || 'guest'} (${populated.customer?.phone || ''})`,
      metadata: { deviceType: populated.deviceType, dropoff: populated.dropoff },
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: req.id,
    });

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
    const { status, q, priority, assignedTo } = req.query;
    // T87 — clamped: an unbounded limit pulls the whole collection into a 512MB heap.
    const { page, limit, skip } = paginate(req.query);
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
        // `_id` breaks ties — several jobs booked in the same minute share a
        // createdAt, and an unstable sort loses one between pages.
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
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

    // Snapshot parts as-deducted before any reassignment below (the parts[]
    // update further down replaces job.parts wholesale) — restock needs to
    // know what inventory was actually taken, not what the client resubmits.
    const deductedParts = job.parts
      .filter(p => p.part && p.stockDeducted)
      .map(p => ({ part: p.part, quantity: p.quantity || 1 }));

    // Snapshot existing custom (non-inventory) part prices by name, so a
    // technician editing the job (e.g. changing a quantity) can't also alter a
    // custom part's price via the same wholesale parts[] replacement — see the
    // isMoneyRole guard below.
    const existingCustomPriceByName = new Map(
      job.parts
        .filter(p => !p.part)
        .map(p => [p.name, { priceAtTime: p.priceAtTime || 0, costAtTime: p.costAtTime || 0 }])
    );

    // Money-bearing fields (laborCost, diagnosisFee, depositPaid, custom-part
    // pricing) can understate or fabricate a customer's bill, so only staff who
    // handle billing may set them — technicians can update diagnosis, repair
    // notes, status, part quantities, etc., but never job money. Mirrors
    // `POST /jobs/:id/payments` (routes/posRoutes.js), which already excludes
    // technician for the same reason.
    const isMoneyRole = ['superadmin', 'admin', 'staff'].includes(req.user?.role);

    const {
      status, diagnosis, repairWork, notes, laborCost, priority,
      assignedTo, parts, deviceBrand, deviceModel, imei, color, depositPaid,
      requiresDiagnosis, diagnosisFee, estimatedCompletion,
      warrantyDays, warrantyNotes,
    } = req.body;

    const prevStatus = job.status; // capture before change
    const prevSnapshot = {
      status: job.status,
      priority: job.priority,
      laborCost: job.laborCost,
      depositPaid: job.depositPaid,
      deviceBrand: job.deviceBrand,
      deviceModel: job.deviceModel,
      assignedTo: job.assignedTo ? job.assignedTo.toString() : '',
      warrantyDays: job.warrantyDays,
    };
    if (status && status !== prevStatus && !canTransitionJobStatus(prevStatus, status)) {
      return res.status(400).json({ success: false, error: `Cannot change status from ${prevStatus} to ${status}.` });
    }
    if (status)      job.status      = status;
    if (priority)    job.priority    = priority;
    // Technicians re-route jobs; an empty value keeps the current assignee so a
    // job is never left unassigned.
    if (assignedTo !== undefined && assignedTo) job.assignedTo = assignedTo;
    if (diagnosis            !== undefined) job.diagnosis            = sanitizeText(diagnosis,   1000);
    if (repairWork           !== undefined) job.repairWork           = sanitizeText(repairWork,  1000);
    if (notes                !== undefined) job.notes                = sanitizeText(notes,       1000);
    if (estimatedCompletion  !== undefined) job.estimatedCompletion  = estimatedCompletion ? new Date(estimatedCompletion) : undefined;
    if (isMoneyRole && laborCost !== undefined)   job.laborCost   = Number(laborCost) || 0;
    if (isMoneyRole && depositPaid !== undefined) job.depositPaid = Number(depositPaid) || 0;
    if (requiresDiagnosis !== undefined) {
      job.requiresDiagnosis = !!requiresDiagnosis;
      if (isMoneyRole) job.diagnosisFee = requiresDiagnosis ? (Number(diagnosisFee) || 0) : 0;
    } else if (isMoneyRole && diagnosisFee !== undefined && job.requiresDiagnosis) {
      job.diagnosisFee = Number(diagnosisFee) || 0;
    }
    if (deviceBrand !== undefined) job.deviceBrand = sanitizeText(deviceBrand, 60);
    if (deviceModel !== undefined) job.deviceModel = sanitizeText(deviceModel, 100);
    if (imei !== undefined)  job.imei  = sanitizeText(imei, 20);
    if (color !== undefined) job.color = sanitizeText(color, 40);

    // Replace parts list — for inventory-linked parts, always use current price
    if (Array.isArray(parts)) {
      const inventoryIds = parts
        .filter(p => p.partId)
        .map(p => p.partId);

      const inventoryParts = inventoryIds.length
        ? await Product.find({ _id: { $in: inventoryIds } }).select('_id price costPrice name')
        : [];

      const priceMap = Object.fromEntries(inventoryParts.map(p => [p._id.toString(), { sell: p.price, cost: p.costPrice }]));

      job.parts = parts
        .filter(p => p.name && String(p.name).trim())
        .map(p => {
          const name = sanitizeText(String(p.name), 100);
          // Custom (non-inventory) part price/cost is client-supplied — only a
          // money role may set or change it. A non-money role (technician) gets
          // the part's existing price if it's already on the job (so they can
          // still edit quantity etc.), or 0 for a brand-new custom line (staff
          // must price it in a follow-up edit).
          const existingCustom = existingCustomPriceByName.get(name);
          return {
            part:        p.partId || undefined,
            name,
            quantity:    Math.max(1, Number(p.quantity) || 1),
            // Snapshots stored in integer pesewas — same unit as Part. Custom
            // (non-inventory) prices arrive from the client already in pesewas.
            priceAtTime: p.partId && priceMap[p.partId] != null
              ? Math.round(Number(priceMap[p.partId].sell))
              : isMoneyRole
                ? Math.max(0, Math.round(Number(p.cost || p.priceAtTime) || 0))
                : (existingCustom?.priceAtTime ?? 0),
            costAtTime: p.partId && priceMap[p.partId] != null
              ? Math.round(Number(priceMap[p.partId].cost))
              : isMoneyRole
                ? Math.max(0, Math.round(Number(p.costAtTime) || 0))
                : (existingCustom?.costAtTime ?? 0),
          };
        });
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

    // Restore inventory once, when a job that already had parts deducted is
    // cancelled — mirrors the shop-order restock in orderController.js.
    if (status === 'cancelled' && prevStatus !== 'cancelled' && job.stockDeducted && !job.stockRestored) {
      for (const p of deductedParts) {
        await Product.findByIdAndUpdate(p.part, { $inc: { stock: p.quantity } });
        // Reverse the sale on the popularity counter as well — clamped, since
        // parts deducted before the counter existed have nothing to subtract.
        await Product.decrementSold(p.part, p.quantity);
      }
      job.stockRestored = true;
    }

    await job.save();

    // Capture assignedTo before populate() below mutates job.assignedTo in
    // place into a populated subdocument — job.assignedTo.toString() after
    // that point returns Mongoose's debug-inspect string, not the hex id.
    const newAssignedTo = job.assignedTo ? job.assignedTo.toString() : '';

    const populated = await job.populate([
      { path: 'customer', select: 'name phone email' },
      { path: 'assignedTo', select: 'name' },
      { path: 'parts.part', select: 'name sku' },
    ]);

    // Notify customer if status changed
    if (status && status !== prevStatus) {
      notifyCustomer(populated, status).catch(() => {});
    }

    const afterSnapshot = {
      status: job.status,
      priority: job.priority,
      laborCost: job.laborCost,
      depositPaid: job.depositPaid,
      deviceBrand: job.deviceBrand,
      deviceModel: job.deviceModel,
      assignedTo: job.assignedTo ? job.assignedTo.toString() : '',
      warrantyDays: job.warrantyDays,
    };

    // Notify the newly-assigned technician on reassignment — in-app (T12)
    if (newAssignedTo && newAssignedTo !== prevSnapshot.assignedTo) {
      notify(newAssignedTo, {
        type:  NOTIFICATION_TYPES.JOB_ASSIGNED,
        title: `Job reassigned to you: ${job.jobNumber}`,
        body:  `${populated.deviceBrand || ''} ${populated.deviceModel || ''}`.trim() || 'Repair job',
        link:  `/dashboard/pos/jobs/${job._id}`,
        resourceType: 'RepairJob',
        resourceId:   job.jobNumber,
      }).catch(() => {});
    }

    const changes = buildChanges(prevSnapshot, afterSnapshot, {
      status: 'Status',
      priority: 'Priority',
      laborCost: 'Labour Cost',
      depositPaid: 'Deposit Paid',
      deviceBrand: 'Device Brand',
      deviceModel: 'Device Model',
      assignedTo: 'Assigned Technician',
      warrantyDays: 'Warranty (days)',
    });
    await logFromRequest(req, {
      action: status && status !== prevStatus ? ACTIONS.REPAIR_STATUS_CHANGED : ACTIONS.REPAIR_UPDATED,
      resourceType: RESOURCES.REPAIR,
      resourceId: job.jobNumber,
      resourceName: job.jobNumber,
      description: status && status !== prevStatus
        ? `Repair job ${job.jobNumber} status changed ${prevStatus} → ${status}`
        : `Updated repair job ${job.jobNumber}`,
      changes,
    });

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
        .select('partName quantity unitPricePesewas amountPesewas status createdAt paystackReference')
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
          pricePesewas: p.priceAtTime || 0,
          isLinked:  Boolean(p.part),
        })),
        partOrders: partOrders.map(o => ({
          id:             o._id,
          partName:       o.partName,
          quantity:       o.quantity,
          amountPesewas:  o.amountPesewas,
          status:         o.status,
          reference:      o.paystackReference || null,
          createdAt:      o.createdAt,
        })),
        repairOrders: repairOrders.map(o => ({
          id:              o._id,
          items:           (o.items || []).map(i => ({
            partName:    i.partName,
            quantity:    i.quantity,
            unitPricePesewas: i.unitPricePesewas,
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
    const { runReminderJob } = require('../../services/reminderJob');
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
      const part = await Product.findById(partId).lean();
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
        unitPricePesewas: Math.round(Number(part.sellingPrice)),
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

const updateRepairOrder = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!PART_REPAIR_ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be pending, paid, or cancelled.' });
    }
    const repairOrder = await RepairOrder.findById(req.params.id);
    if (!repairOrder) return res.status(404).json({ success: false, error: 'Repair order not found.' });
    const prevStatus = repairOrder.status;
    if (!canTransitionPartRepairOrder(prevStatus, status)) {
      return res.status(400).json({ success: false, error: `Cannot change status from ${prevStatus} to ${status}.` });
    }
    repairOrder.status = status;
    if (status === 'paid' && !repairOrder.paidAt) repairOrder.paidAt = new Date();
    await repairOrder.save();
    if (prevStatus !== status) {
      await logFromRequest(req, {
        action: ACTIONS.REPAIR_ORDER_STATUS_CHANGED,
        resourceType: RESOURCES.REPAIR_ORDER,
        resourceId: repairOrder._id,
        resourceName: String(repairOrder._id),
        description: `Repair order status changed ${prevStatus} → ${status}`,
        changes: [{ field: 'status', label: 'Status', before: prevStatus, after: status }],
      });
    }
    res.json({ success: true, data: repairOrder });
  } catch (err) { next(err); }
};

// ─── CUSTOMER: my repairs ────────────────────────────────────────────────────
// A logged-in customer's repair jobs, matched to their account by phone (repairs
// link to a PosCustomer, keyed by a unique phone). Returns the tracking token so
// the client can deep-link to the public /track/:token page.

module.exports = {
  createJob,
  createPublicJob,
  getJobs,
  getJob,
  updateJob,
  uploadJobPhoto,
  deleteJobPhoto,
  getJobByToken,
  getWarrantyJobs,
  getMyRepairs,
  triggerReminders,
  getUncollectedJobs,
  createRepairOrder,
  updateRepairOrder,
};
