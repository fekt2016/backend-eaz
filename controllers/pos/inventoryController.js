const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, PART_REPAIR_ORDER_STATUSES, ACCESSORY_CATEGORIES, ACCESSORY_PART_CATEGORY, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, asInventoryItem, asProductFields, formatDateOnly, pctChange, canTransitionPartRepairOrder
} = require('./common');
const { paginate } = require('../../utils/pagination');

const getParts = async (req, res, next) => {
  try {
    // `includeProducts` is accepted and ignored — shop stock and bench parts are
    // one collection now, so every search already spans both. It used to give
    // products only what was left of `limit` after the parts, so a search
    // matching a full page of parts returned no products at all.
    const { q, category, kind, lowStock, retail } = req.query;
    // T87 — clamped: an unbounded limit pulls the whole collection into a 512MB heap.
    const { page, limit, skip } = paginate(req.query);
    const query = {};

    // T110 — coarse "what kind of thing is this" filter. Bench stock and shop
    // stock share one collection now, so this is a property of the document, not
    // a separate table. An unrecognised `kind` is ignored rather than 400'd, so a
    // stale bookmark degrades to "everything" instead of an error page.
    // Collected rather than assigned: `$or` is already taken by the `q` search
    // below, and two filters both writing `query.$and` would overwrite one another.
    const and = [];

    if (kind === 'parts') {
      // Bench stock, minus the repair taxonomy's own "Accessory" type — a case is
      // an accessory to whoever is looking for one, whichever way it was entered.
      query.partCategory = { $ne: null, $nin: [ACCESSORY_PART_CATEGORY] };
    } else if (kind === 'accessories') {
      and.push({ $or: [
        { partCategory: ACCESSORY_PART_CATEGORY },
        { partCategory: null, category: { $in: ACCESSORY_CATEGORIES } },
      ] });
    } else if (kind === 'other') {
      query.partCategory = null;
      query.category = { $nin: ACCESSORY_CATEGORIES };
    }

    // Category matches either taxonomy: the repair one (Screen, Battery, …) or
    // the shop one (Phones, Accessories, …).
    if (category) and.push({ $or: [{ partCategory: category }, { category }] });
    // Only what the counter may sell.
    if (retail === 'true') query.sellInStore = true;
    // Applies to everything now — products had no threshold field before the
    // merge, so shop stock could never show up in a low-stock check.
    if (lowStock === 'true') query.$expr = { $lte: ['$stock', '$lowStockThreshold'] };
    if (and.length) query.$and = and;
    if (q) query.$or = [
      { name:    { $regex: escapeRegex(q), $options: 'i' } },
      { sku:     { $regex: escapeRegex(q), $options: 'i' } },
      // Barcode search reaches shop stock now; Product had no barcode at all.
      { barcode: { $regex: escapeRegex(q), $options: 'i' } },
    ];

    const [items, total] = await Promise.all([
      Product.find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .populate('supplier', 'name phone')
        .lean(),
      Product.countDocuments(query),
    ]);

    res.json({ success: true, data: items.map(asInventoryItem), total });
  } catch (err) { next(err); }
};

// ── Fast barcode / IMEI scan lookup ─────────────────────────────────────────
// Returns a product OR an existing repair job — single endpoint, < 50ms

/**
 * Shape a shop Product into the sellable line the POS cashier expects. Products
 * The POS clients still speak the old part vocabulary (sellingPrice, quantity),
 * onto the same frontend cart shape, flagged with `_kind` so the client can
 * send back the right id.
 */

const scanLookup = async (req, res, next) => {
  try {
    const code = sanitizeText(req.params.code, 100).trim();
    if (!code) return res.status(400).json({ success: false, error: 'Code required.' });

    // 1. Exact barcode match (indexed). Reaches shop stock as well as bench
    //    parts now — a shop product could not be scanned at all before.
    const byBarcode = await Product.findOne({ barcode: code }).lean();
    if (byBarcode) return res.json({ success: true, type: 'product', data: asInventoryItem(byBarcode) });

    // 2. IMEI match on an active repair job
    if (/^\d{14,15}$/.test(code)) {
      const job = await RepairJob.findOne({ imei: code, status: { $nin: ['collected', 'cancelled'] } })
        .populate('customer', 'name phone')
        .populate('assignedTo', 'name');
      if (job) return res.json({ success: true, type: 'repair_job', data: job });
    }

    // 3. SKU fallback — one collection, so one query where there were two.
    const bySku = await Product.findOne({ sku: code }).lean();
    if (bySku) return res.json({ success: true, type: 'product', data: asInventoryItem(bySku) });

    // 4. A variant's own SKU. Variants live on shop stock and were invisible to
    //    the scanner while POS read a separate collection.
    const byVariant = await Product.findOne({ 'variants.sku': code }).lean();
    if (byVariant) return res.json({ success: true, type: 'product', data: asInventoryItem(byVariant) });

    return res.status(404).json({ success: false, error: 'Not found. Try searching manually.' });
  } catch (err) { next(err); }
};

const createPart = async (req, res, next) => {
  try {
    const { name, category, quantity, lowStockThreshold, costPrice, sellingPrice } = req.body;
    if (!name || costPrice == null || sellingPrice == null) {
      return res.status(400).json({ success: false, error: 'Name, cost price, and selling price are required.' });
    }

    const part = await Product.create({
      ...asProductFields(req.body),
      name:              sanitizeText(name, 150),
      category:          category || 'Other',
      partCategory:      category || 'Other',
      stock:             Number(quantity) || 0,
      lowStockThreshold: Number(lowStockThreshold) || 3,
      compatibleWith:    Array.isArray(req.body.compatibleWith) ? req.body.compatibleWith.map(v => sanitizeText(v, 100)).filter(Boolean) : [],
      description:       req.body.description ? sanitizeText(req.body.description, 1000) : '',
      images:            Array.isArray(req.body.images) ? req.body.images.map(i => sanitizeText(i, 500)).filter(Boolean) : [],
      notes:             req.body.notes ? sanitizeText(req.body.notes, 500) : '',
      // Bench stock is not listed online by default — the old Part model
      // defaulted `isRetail` to false and inventory screens relied on that.
      // Staff opt an item into the shop deliberately.
      sellOnline:   false,
      sellInStore:  true,
      useInRepairs: true,
      isActive:     false,
      // slug is generated by the model when absent (POS supplies only a name).
    });

    await logFromRequest(req, {
      action: ACTIONS.INVENTORY_CREATED,
      resourceType: RESOURCES.INVENTORY,
      resourceId: part._id,
      resourceName: part.name,
      description: `Created inventory item ${part.name} (qty ${part.stock})`,
      metadata: { sku: part.sku || '', category: part.partCategory },
    });
    res.status(201).json({ success: true, data: asInventoryItem(part) });
  } catch (err) { next(err); }
};

const updatePart = async (req, res, next) => {
  try {
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Part not found.' });

    const update = asProductFields(req.body);
    const part = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!part) return res.status(404).json({ success: false, error: 'Part not found.' });

    // The audit trail keeps speaking the inventory screen's language, so a
    // stock adjustment logged before the merge and one logged after read the
    // same in the activity log.
    const snapshot = (d) => ({
      name: d.name, sku: d.sku, category: d.partCategory || d.category, quantity: d.stock,
      lowStockThreshold: d.lowStockThreshold, costPrice: d.costPrice, sellingPrice: d.price,
    });
    const changes = buildChanges(snapshot(existing), snapshot(part), {
      name: 'Name', sku: 'SKU', category: 'Category', quantity: 'Quantity',
      lowStockThreshold: 'Low Stock Threshold', costPrice: 'Cost Price', sellingPrice: 'Selling Price',
    });
    const stockAdjusted = 'stock' in update;
    await logFromRequest(req, {
      action: stockAdjusted ? ACTIONS.INVENTORY_STOCK_ADJUSTED : ACTIONS.INVENTORY_UPDATED,
      resourceType: RESOURCES.INVENTORY,
      resourceId: part._id,
      resourceName: part.name,
      description: stockAdjusted
        ? `Stock adjusted for ${part.name} (${existing.stock} → ${part.stock})`
        : `Updated inventory item ${part.name}`,
      changes,
    });

    res.json({ success: true, data: asInventoryItem(part) });
  } catch (err) { next(err); }
};

const deletePart = async (req, res, next) => {
  try {
    const part = await Product.findByIdAndDelete(req.params.id);
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
    // Only what a customer may actually buy for their repair: priced, and
    // flagged for the counter. `sellInStore` replaces the old `isRetail`.
    const query = { price: { $gt: 0 }, sellInStore: true };
    if (category && category !== 'all') {
      query.$and = [{ $or: [{ partCategory: category }, { category }] }];
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      query.$or = [
        { name:           { $regex: escapeRegex(term), $options: 'i' } },
        { sku:            { $regex: escapeRegex(term), $options: 'i' } },
        { barcode:        { $regex: escapeRegex(term), $options: 'i' } },
        { compatibleWith: { $regex: escapeRegex(term), $options: 'i' } },
      ];
    }
    const parts = await Product.find(query)
      .select('name sku category partCategory price stock lowStockThreshold compatibleWith description images')
      .sort({ name: 1 })
      .limit(100)
      .lean();
    // Cost and supplier are never selected above, so they cannot leak here.
    res.json({ success: true, data: parts.map(asInventoryItem) });
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
