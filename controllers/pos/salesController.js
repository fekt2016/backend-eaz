const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange, formatGhs
} = require('./common');

const createSale = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
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

    const saleItems = [];
    let   subtotal  = 0;

    // Validate + lock items within transaction
    for (const { partId, productId, quantity } of items) {
      const qty = Math.max(1, Number(quantity) || 1);

      // Repair-part line (inventory)
      if (partId) {
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

        if (!product) {
          await session.abortTransaction();
          return res.status(404).json({ success: false, error: `Product not found: ${productId}` });
        }
        if (!product.isActive) {
          await session.abortTransaction();
          return res.status(400).json({ success: false, error: `"${product.name}" is not available for sale.` });
        }

        // Stock check — products always respect stock
        if (product.stock < qty) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            error:   `Insufficient stock for "${product.name}". Available: ${product.stock}, Requested: ${qty}`,
          });
        }

        // Deduct stock atomically
        await Product.findByIdAndUpdate(
          product._id,
          { $inc: { stock: -qty } },
          { session }
        );

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

      await session.abortTransaction();
      return res.status(400).json({ success: false, error: 'Each cart item needs a partId or productId.' });
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

    await logFromRequest(req, {
      action: ACTIONS.SALE_CREATED,
      resourceType: RESOURCES.SALE,
      resourceId: sale[0].saleNumber,
      resourceName: sale[0].saleNumber,
      description: `POS sale ${sale[0].saleNumber} — ${formatGhs(sale[0].total)} via ${sale[0].paymentMethod}`,
      metadata: { paymentMethod: sale[0].paymentMethod, totalPesewas: sale[0].total, itemsCount: saleItems.length },
    });

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
      if (item.product) {
        await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } }, { session });
      }
    }

    sale.voided    = true;
    sale.voidedBy  = req.user._id;
    sale.voidedAt  = new Date();
    sale.voidReason = sanitizeText(req.body.reason, 200) || 'No reason given';
    await sale.save({ session });

    await session.commitTransaction();
    session.endSession();
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
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// ─── PAYSTACK MOMO CHARGE (repair jobs) ──────────────────────────────────────

module.exports = {
  createSale,
  getSales,
  getSale,
  voidSale,
};
