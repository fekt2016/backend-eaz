const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange, formatGhs
} = require('./common');

// Thrown for a deliberate business-rule abort inside a withTransaction()
// callback (never a DB/transient error) — caught once outside the
// transaction and turned into the matching HTTP response.
class SaleError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const createSale = async (req, res, next) => {
  try {
    const {
      items,          // [{ partId?, productId?, quantity }]
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

    // Seed this month's sale-number counter before the transaction opens — an
    // upsert of a missing counter row from inside two concurrent transactions
    // races into an E11000 that withTransaction won't retry (T47).
    await Sale.ensureNumberCounter();

    const session = await mongoose.startSession();
    let sale;
    try {
      // withTransaction retries the whole callback on a MongoDB
      // TransientTransactionError (e.g. the driver's default 5ms
      // maxTransactionLockRequestTimeoutMillis being hit under concurrent
      // writes to the same part/product) instead of surfacing a 500 to the
      // cashier on ordinary lock contention. Safe to retry as a unit: every
      // read/write below is scoped to `session`, and nothing outside the
      // transaction is mutated until it actually commits.
      await session.withTransaction(async () => {
        const saleItems = [];
        let   subtotal  = 0;

        for (const { partId, productId, quantity } of items) {
          const qty = Math.max(1, Number(quantity) || 1);

          // Repair-part line (inventory)
          if (partId) {
            const part = await Part.findById(partId).session(session);
            if (!part) throw new SaleError(404, `Product not found: ${partId}`);

            // Stock check — respect allowNegativeStock flag
            if (!part.allowNegativeStock && part.quantity < qty) {
              throw new SaleError(400, `Insufficient stock for "${part.name}". Available: ${part.quantity}, Requested: ${qty}`);
            }

            await Part.findByIdAndUpdate(part._id, { $inc: { quantity: -qty } }, { session });

            saleItems.push({
              part:      part._id,
              name:      part.name,
              barcode:   part.barcode,
              sku:       part.sku,
              quantity:  qty,
              // Sale stored in integer pesewas — same unit as Part.
              unitPrice: Math.round(Number(part.sellingPrice)),
              subtotal:  Math.round(Number(part.sellingPrice)) * qty,
            });
            subtotal += Math.round(Number(part.sellingPrice)) * qty;
            continue;
          }

          // Shop-product line (online catalogue sold over the counter)
          if (productId) {
            const product = await Product.findById(productId).session(session);
            if (!product) throw new SaleError(404, `Product not found: ${productId}`);
            if (!product.isActive) throw new SaleError(400, `"${product.name}" is not available for sale.`);

            // Stock check — products always respect stock
            if (product.stock < qty) {
              throw new SaleError(400, `Insufficient stock for "${product.name}". Available: ${product.stock}, Requested: ${qty}`);
            }

            // An over-the-counter sale is real demand, so it counts toward the
            // same `sold` figure the storefront shows (T48) — same update as the
            // stock deduction, so the two can never diverge.
            await Product.findByIdAndUpdate(product._id, { $inc: { stock: -qty, sold: qty } }, { session });

            saleItems.push({
              product:   product._id,
              name:      product.name,
              barcode:   product.sku || undefined,
              sku:       product.sku,
              quantity:  qty,
              // Sale stored in integer pesewas — same unit as Product.
              unitPrice: Math.round(Number(product.price)),
              subtotal:  Math.round(Number(product.price)) * qty,
            });
            subtotal += Math.round(Number(product.price)) * qty;
            continue;
          }

          throw new SaleError(400, 'Each cart item needs a partId or productId.');
        }

        const disc    = Number(discount) || 0;
        const total   = Math.max(0, subtotal - disc);
        const paid    = Number(amountPaid);
        const change  = Math.max(0, paid - total);

        if (paid < total && paymentMethod !== 'split') {
          throw new SaleError(400, `Underpaid. Total: ${total}, Paid: ${paid}`);
        }

        const [createdSale] = await Sale.create([{
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

        sale = createdSale;
      });
    } finally {
      session.endSession();
    }

    await logFromRequest(req, {
      action: ACTIONS.SALE_CREATED,
      resourceType: RESOURCES.SALE,
      resourceId: sale.saleNumber,
      resourceName: sale.saleNumber,
      description: `POS sale ${sale.saleNumber} — ${formatGhs(sale.total)} via ${sale.paymentMethod}`,
      metadata: { paymentMethod: sale.paymentMethod, totalPesewas: sale.total, itemsCount: sale.items.length },
    });

    res.status(201).json({ success: true, data: sale });
  } catch (err) {
    if (err instanceof SaleError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    next(err);
  }
};

// Only these roles may look at another cashier's sales. Everyone else — staff and
// technicians — is pinned to their own, regardless of what they ask for.
const CAN_SEE_ALL_SALES = ['superadmin', 'admin'];
const canSeeAllSales = (user) => CAN_SEE_ALL_SALES.includes(user?.role);

const getSales = async (req, res, next) => {
  try {
    const { page = 1, limit = 30, q, cashierId } = req.query;
    // Clamp pagination — an unbounded `limit` would let one request pull the whole
    // sales history on a 512MB heap.
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));

    const query = { voided: { $ne: true } };

    // Scope: staff see only what they rang up. This is enforced from req.user, never
    // from a client-supplied id, so passing ?cashierId= as staff cannot widen it.
    if (canSeeAllSales(req.user)) {
      if (cashierId) {
        if (!mongoose.Types.ObjectId.isValid(cashierId)) {
          return res.status(400).json({ success: false, error: 'Invalid cashier id.' });
        }
        query.cashier = cashierId;
      }
    } else {
      query.cashier = req.user._id;
    }

    if (q) query.$or = [
      { saleNumber:    { $regex: escapeRegex(q), $options: 'i' } },
      { customerName:  { $regex: escapeRegex(q), $options: 'i' } },
    ];
    const [sales, total] = await Promise.all([
      Sale.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum)
        .populate('cashier', 'name').populate('customer', 'name phone'),
      Sale.countDocuments(query),
    ]);
    res.json({ success: true, data: sales, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) { next(err); }
};

/**
 * GET /api/v1/pos/sales/summary
 *
 * Powers the Sell page's sales section. Staff get their own totals; admin and
 * superadmin additionally get a per-cashier breakdown so they can see who sold what.
 * Money is integer pesewas throughout, like the rest of POS.
 */
const getSalesSummary = async (req, res, next) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const seeAll = canSeeAllSales(req.user);
    const mine   = { cashier: req.user._id, voided: { $ne: true } };

    const [allTime, today, byStaff] = await Promise.all([
      Sale.aggregate([
        { $match: mine },
        { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Sale.aggregate([
        { $match: { ...mine, createdAt: { $gte: startOfToday } } },
        { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      seeAll
        ? Sale.aggregate([
            { $match: { voided: { $ne: true } } },
            {
              $group: {
                _id: '$cashier',
                revenue: { $sum: '$total' },
                count: { $sum: 1 },
                todayRevenue: {
                  $sum: { $cond: [{ $gte: ['$createdAt', startOfToday] }, '$total', 0] },
                },
                todayCount: {
                  $sum: { $cond: [{ $gte: ['$createdAt', startOfToday] }, 1, 0] },
                },
              },
            },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'staff' } },
            { $unwind: { path: '$staff', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                cashierId: '$_id',
                // A sale whose cashier account was deleted still counts; don't drop it.
                name: { $ifNull: ['$staff.name', 'Unknown'] },
                revenue: 1, count: 1, todayRevenue: 1, todayCount: 1,
              },
            },
            { $sort: { revenue: -1 } },
          ])
        : Promise.resolve(null),
    ]);

    res.json({
      success: true,
      data: {
        scope: seeAll ? 'all' : 'own',
        mine: {
          count:        allTime[0]?.count   || 0,
          revenue:      allTime[0]?.revenue || 0,
          todayCount:   today[0]?.count     || 0,
          todayRevenue: today[0]?.revenue   || 0,
        },
        // Only present for admin/superadmin.
        byStaff: byStaff || undefined,
      },
    });
  } catch (err) { next(err); }
};

const getSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('cashier', 'name')
      .populate('customer', 'name phone');
    if (!sale) return res.status(404).json({ success: false, error: 'Sale not found.' });
    // Same scoping as the list: staff may only open a sale they rang up. 404 rather
    // than 403 so the endpoint doesn't confirm that someone else's sale id exists.
    if (!canSeeAllSales(req.user) && String(sale.cashier?._id || sale.cashier) !== String(req.user._id)) {
      return res.status(404).json({ success: false, error: 'Sale not found.' });
    }
    res.json({ success: true, data: sale });
  } catch (err) { next(err); }
};

const voidSale = async (req, res, next) => {
  const session = await mongoose.startSession();
  let sale;
  try {
    try {
      // See the matching comment in createSale — withTransaction retries the
      // whole callback on transient lock-contention instead of failing the
      // request outright.
      await session.withTransaction(async () => {
        const found = await Sale.findById(req.params.id).session(session);
        if (!found) throw new SaleError(404, 'Sale not found.');
        if (found.voided) throw new SaleError(400, 'Sale already voided.');

        // Restore stock
        for (const item of found.items) {
          if (item.part) {
            await Part.findByIdAndUpdate(item.part, { $inc: { quantity: item.quantity } }, { session });
          }
          if (item.product) {
            await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } }, { session });
            await Product.decrementSold(item.product, item.quantity, session);
          }
        }

        found.voided    = true;
        found.voidedBy  = req.user._id;
        found.voidedAt  = new Date();
        found.voidReason = sanitizeText(req.body.reason, 200) || 'No reason given';
        await found.save({ session });

        sale = found;
      });
    } finally {
      session.endSession();
    }

    await logFromRequest(req, {
      action: ACTIONS.SALE_VOIDED,
      resourceType: RESOURCES.SALE,
      resourceId: sale.saleNumber,
      resourceName: sale.saleNumber,
      description: `Voided POS sale ${sale.saleNumber} (${formatGhs(sale.total)}) — ${sale.voidReason}`,
      metadata: { voidReason: sale.voidReason, totalPesewas: sale.total },
    });
    res.json({ success: true, data: sale });
  } catch (err) {
    if (err instanceof SaleError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    next(err);
  }
};

// ─── PAYSTACK MOMO CHARGE (repair jobs) ──────────────────────────────────────

module.exports = {
  createSale,
  getSales,
  getSalesSummary,
  getSale,
  voidSale,
};
