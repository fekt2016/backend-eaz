const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, PART_REPAIR_ORDER_STATUSES, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange, canTransitionPartRepairOrder
} = require('./common');

const getParts = async (req, res, next) => {
  try {
    const { q, category, lowStock, retail, includeProducts, page = 1, limit = 50 } = req.query;
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

    // Optionally merge shop products (the online shop catalogue) into POS
    // searches so cashiers can ring up in-store products too.
    let data = parts;
    if (includeProducts === 'true') {
      const prodQuery = { isActive: true };
      if (q) prodQuery.$or = [
        { name: { $regex: escapeRegex(q), $options: 'i' } },
        { sku:  { $regex: escapeRegex(q), $options: 'i' } },
      ];
      const products = await Product.find(prodQuery)
        .select('name sku price stock category')
        .sort({ name: 1 })
        .limit(Number(limit))
        .lean();
      data = [...data, ...products.map(normalizeProduct)];
    }

    res.json({ success: true, data, total });
  } catch (err) { next(err); }
};

// ── Fast barcode / IMEI scan lookup ─────────────────────────────────────────
// Returns a product OR an existing repair job — single endpoint, < 50ms

/**
 * Shape a shop Product into the sellable line the POS cashier expects. Products
 * store price (pesewas) + stock; parts store sellingPrice + quantity. Both map
 * onto the same frontend cart shape, flagged with `_kind` so the client can
 * send back the right id.
 */

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

    // 3. SKU fallback on Part, then shop Product
    const bySku = await Part.findOne({ sku: code });
    if (bySku) return res.json({ success: true, type: 'product', data: bySku });

    const product = await Product.findOne({ sku: code, isActive: true }).lean();
    if (product) return res.json({ success: true, type: 'product', data: normalizeProduct(product) });

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
    await logFromRequest(req, {
      action: ACTIONS.INVENTORY_CREATED,
      resourceType: RESOURCES.INVENTORY,
      resourceId: part._id,
      resourceName: part.name,
      description: `Created inventory item ${part.name} (qty ${part.quantity})`,
      metadata: { sku: part.sku || '', category: part.category },
    });
    res.status(201).json({ success: true, data: part });
  } catch (err) { next(err); }
};

const updatePart = async (req, res, next) => {
  try {
    const existing = await Part.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Part not found.' });

    const update = {};
    const fields = ['name', 'sku', 'category', 'quantity', 'lowStockThreshold', 'costPrice', 'sellingPrice', 'supplier', 'compatibleWith', 'description', 'images', 'notes'];
    for (const f of fields) {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    }
    const part = await Part.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!part) return res.status(404).json({ success: false, error: 'Part not found.' });

    const before = {
      name: existing.name, sku: existing.sku, category: existing.category, quantity: existing.quantity,
      lowStockThreshold: existing.lowStockThreshold, costPrice: existing.costPrice, sellingPrice: existing.sellingPrice,
    };
    const after = {
      name: part.name, sku: part.sku, category: part.category, quantity: part.quantity,
      lowStockThreshold: part.lowStockThreshold, costPrice: part.costPrice, sellingPrice: part.sellingPrice,
    };
    const changes = buildChanges(before, after, {
      name: 'Name', sku: 'SKU', category: 'Category', quantity: 'Quantity',
      lowStockThreshold: 'Low Stock Threshold', costPrice: 'Cost Price', sellingPrice: 'Selling Price',
    });
    const stockAdjusted = 'quantity' in update;
    await logFromRequest(req, {
      action: stockAdjusted ? ACTIONS.INVENTORY_STOCK_ADJUSTED : ACTIONS.INVENTORY_UPDATED,
      resourceType: RESOURCES.INVENTORY,
      resourceId: part._id,
      resourceName: part.name,
      description: stockAdjusted
        ? `Stock adjusted for ${part.name} (${existing.quantity} → ${part.quantity})`
        : `Updated inventory item ${part.name}`,
      changes,
    });

    res.json({ success: true, data: part });
  } catch (err) { next(err); }
};

const deletePart = async (req, res, next) => {
  try {
    const part = await Part.findByIdAndDelete(req.params.id);
    if (!part) return res.status(404).json({ success: false, error: 'Part not found.' });
    await logFromRequest(req, {
      action: ACTIONS.INVENTORY_DELETED,
      resourceType: RESOURCES.INVENTORY,
      resourceId: part._id,
      resourceName: part.name,
      description: `Deleted inventory item ${part.name}`,
    });
    res.json({ success: true, message: 'Part deleted.' });
  } catch (err) { next(err); }
};

// ─── STAFF ───────────────────────────────────────────────────────────────────

/** Technicians list — any POS role can read it so staff can assign jobs. */

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

    const qty              = Math.max(1, Math.min(10, Math.floor(Number(quantity) || 1)));
    const unitPricePesewas = Math.max(0, Math.round(Number(partLine.priceAtTime)));
    const amountPesewas    = unitPricePesewas * qty;
    const subtotalPesewas  = amountPesewas;

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
      unitPricePesewas,
      subtotalPesewas,
      amountPesewas,
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
    if (!PART_REPAIR_ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be pending, paid, or cancelled.' });
    }
    const partOrder = await PartOrder.findById(req.params.id);
    if (!partOrder) return res.status(404).json({ success: false, error: 'Part order not found.' });
    const prevStatus = partOrder.status;
    if (!canTransitionPartRepairOrder(prevStatus, status)) {
      return res.status(400).json({ success: false, error: `Cannot change status from ${prevStatus} to ${status}.` });
    }
    partOrder.status = status;
    if (status === 'paid' && !partOrder.paidAt) partOrder.paidAt = new Date();
    await partOrder.save();
    if (prevStatus !== status) {
      await logFromRequest(req, {
        action: ACTIONS.PART_ORDER_STATUS_CHANGED,
        resourceType: RESOURCES.PART_ORDER,
        resourceId: partOrder._id,
        resourceName: partOrder.partName || String(partOrder._id),
        description: `Part order status changed ${prevStatus} → ${status} (${partOrder.partName || partOrder._id})`,
        changes: [{ field: 'status', label: 'Status', before: prevStatus, after: status }],
      });
    }
    res.json({ success: true, data: partOrder });
  } catch (err) { next(err); }
};

module.exports = {
  getParts,
  scanLookup,
  createPart,
  updatePart,
  deletePart,
  getPublicParts,
  createPartOrder,
  getPartOrders,
  updatePartOrder,
};
