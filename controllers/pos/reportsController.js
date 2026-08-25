const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange
} = require('./common');

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

// ─── REPORTS & ANALYTICS (shop-wide business intelligence) ────────────────────
// Consolidated analytics for the Reports dashboard. Aggregates repair revenue
// (PosPayment), over-the-counter sales (Sale), online shop orders (Order),
// repairs, inventory, expenses and shipping statuses server-side for the
// requested range. Money stays in integer pesewas end-to-end; the only display
// conversion (÷100) happens on the client.

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

const getReportsAnalytics = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const rangeStart = from ? new Date(from) : null;
    const rangeEnd   = to   ? new Date(new Date(to).setHours(23, 59, 59, 999)) : null;
    const rangeMatch = rangeStart && rangeEnd ? { createdAt: { $gte: rangeStart, $lte: rangeEnd } } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── Staff scope ──────────────────────────────────────────────────────────
    // `staff` role: always forced to their own id — a client-supplied staffId
    // is never trusted for that role. admin/superadmin: optional, selects a
    // single staff member's activity; omitted = shop-wide (unchanged
    // behaviour). Invalid ids are silently ignored (shop-wide), matching the
    // existing pattern for optional id filters elsewhere in this controller.
    let staffIdParam = req.query.staffId;
    if (req.user.role === 'staff') {
      staffIdParam = String(req.user._id);
    } else if (staffIdParam && !mongoose.Types.ObjectId.isValid(staffIdParam)) {
      staffIdParam = undefined;
    }
    const staffObjectId = staffIdParam ? new mongoose.Types.ObjectId(staffIdParam) : null;

    // Each collection is scoped by the field that actually attributes it to a
    // person — never combined with $or, so a person can't be matched twice
    // for the same document. Sale/PosPayment/RepairJob are disjoint
    // collections (no shared references), so summing revenue across them
    // never double-counts one underlying transaction.
    const saleMatch    = { ...rangeMatch, voided: { $ne: true }, ...(staffObjectId && { cashier: staffObjectId }) };
    const paymentMatch = { ...rangeMatch, ...(staffObjectId && { receivedBy: staffObjectId }) };
    const jobMatch      = { ...rangeMatch, ...(staffObjectId && { createdBy: staffObjectId }) };
    // Shop orders are placed online by customers — never attributable to a
    // staff member — so a staff-scoped report excludes them entirely rather
    // than showing shop-wide numbers under a personal report.
    const ordersInScope = !staffObjectId;

    // ── Revenue sources (all integer pesewas) ──────────────────────────────────
    const [repairPay, posSales, orderRevenueAgg] = await Promise.all([
      PosPayment.aggregate([
        { $match: paymentMatch },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Sale.aggregate([
        { $match: saleMatch },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      ordersInScope
        ? Order.aggregate([
            { $match: { ...rangeMatch, status: { $in: REVENUE_ORDER_STATUSES } } },
            { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
    ]);

    const repairRevenue  = repairPay[0]?.total     || 0;
    const posSalesRevenue = posSales[0]?.total     || 0;
    const shopOrderRevenue = orderRevenueAgg[0]?.total || 0;
    const totalRevenue   = repairRevenue + posSalesRevenue + shopOrderRevenue;

    // ── Shop order counts + status distribution ────────────────────────────────
    const [ordersByStatus, ordersRecent] = await Promise.all([
      ordersInScope
        ? Order.aggregate([
            { $match: rangeMatch },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
        : Promise.resolve([]),
      ordersInScope
        ? Order.find(rangeMatch)
            .sort({ createdAt: -1 })
            .limit(8)
            .select('orderNumber customer total status createdAt trackingNumber')
        : Promise.resolve([]),
    ]);

    const orderTotal    = ordersByStatus.reduce((s, x) => s + x.count, 0);
    const orderPaid     = ordersByStatus.filter(x => REVENUE_ORDER_STATUSES.includes(x._id)).reduce((s, x) => s + x.count, 0);
    const orderPending  = ordersByStatus.find(x => x._id === 'pending')?.count    || 0;
    const orderCancelled = ordersByStatus.find(x => x._id === 'cancelled')?.count || 0;
    const aov = orderPaid > 0 ? Math.round(shopOrderRevenue / orderPaid) : 0;

    // ── Daily revenue series (repair / POS / shop stacked) ─────────────────────
    const chartStart = rangeStart || new Date(new Date(today).setDate(today.getDate() - 29));
    const chartEnd   = rangeEnd   || new Date();
    const seriesMatch = { createdAt: { $gte: chartStart, $lte: chartEnd } };

    const [dailyRepair, dailySales, dailyOrders] = await Promise.all([
      PosPayment.aggregate([
        { $match: { ...seriesMatch, ...(staffObjectId && { receivedBy: staffObjectId }) } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$amount' } } },
      ]),
      Sale.aggregate([
        { $match: { ...seriesMatch, voided: { $ne: true }, ...(staffObjectId && { cashier: staffObjectId }) } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$total' } } },
      ]),
      ordersInScope
        ? Order.aggregate([
            { $match: { ...seriesMatch, status: { $in: REVENUE_ORDER_STATUSES } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$total' } } },
          ])
        : Promise.resolve([]),
    ]);

    const seriesMap = new Map();
    for (const d of dailyRepair) seriesMap.set(d._id, { repair: d.total, posSales: 0, shopOrders: 0 });
    for (const d of dailySales) {
      const e = seriesMap.get(d._id) || { repair: 0, posSales: 0, shopOrders: 0 };
      e.posSales = d.total; seriesMap.set(d._id, e);
    }
    for (const d of dailyOrders) {
      const e = seriesMap.get(d._id) || { repair: 0, posSales: 0, shopOrders: 0 };
      e.shopOrders = d.total; seriesMap.set(d._id, e);
    }

    const revenueSeries = [];
    const cursor = new Date(chartStart);
    while (cursor <= chartEnd) {
      const key = formatDateOnly(cursor);
      const e   = seriesMap.get(key) || { repair: 0, posSales: 0, shopOrders: 0 };
      revenueSeries.push({ date: key, repair: e.repair, posSales: e.posSales, shopOrders: e.shopOrders, total: e.repair + e.posSales + e.shopOrders });
      cursor.setDate(cursor.getDate() + 1);
    }

    // ── Previous-period comparison (only when a bounded range is supplied) ──────
    let previous = null;
    if (rangeStart && rangeEnd) {
      const len      = rangeEnd.getTime() - rangeStart.getTime();
      const prevEnd  = new Date(rangeStart.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - len);
      const prevMatch = { createdAt: { $gte: prevStart, $lte: prevEnd } };

      const [prevRepair, prevSales, prevOrders] = await Promise.all([
        PosPayment.aggregate([
          { $match: { ...prevMatch, ...(staffObjectId && { receivedBy: staffObjectId }) } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Sale.aggregate([
          { $match: { ...prevMatch, voided: { $ne: true }, ...(staffObjectId && { cashier: staffObjectId }) } },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        ordersInScope
          ? Order.aggregate([
              { $match: { ...prevMatch, status: { $in: REVENUE_ORDER_STATUSES } } },
              { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
            ])
          : Promise.resolve([]),
      ]);

      const prevRevenue = (prevRepair[0]?.total || 0) + (prevSales[0]?.total || 0) + (prevOrders[0]?.total || 0);
      const prevPaid    = prevOrders[0]?.count || 0;
      previous = {
        revenue: prevRevenue,
        ordersPaid: prevPaid,
        aov: prevPaid > 0 ? Math.round(prevRevenue / prevPaid) : 0,
        revenueChangePct: pctChange(totalRevenue, prevRevenue),
        ordersChangePct:  orderPaid > 0 || prevPaid > 0 ? pctChange(orderPaid, prevPaid) : null,
      };
    }

    // ── Payment methods (repair payments + POS sales) ───────────────────────────
    const [payMethods, saleMethods] = await Promise.all([
      PosPayment.aggregate([
        { $match: paymentMatch },
        { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Sale.aggregate([
        { $match: saleMatch },
        { $group: { _id: '$paymentMethod', total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
    ]);
    const methodMap = new Map();
    for (const m of [...payMethods, ...saleMethods]) {
      const e = methodMap.get(m._id) || { total: 0, count: 0 };
      e.total += m.total; e.count += m.count; methodMap.set(m._id, e);
    }
    const paymentMethods = [...methodMap.entries()].map(([k, v]) => ({ _id: k, ...v })).sort((a, b) => b.total - a.total);

    // ── Repair jobs ─────────────────────────────────────────────────────────────
    // Staff ownership = createdBy (matches getMyOverview's convention for
    // non-technician roles — technicians can't reach this endpoint at all, so
    // assignedTo never needs to be considered here).
    const [jobsByStatus, topParts] = await Promise.all([
      RepairJob.aggregate([
        { $match: jobMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      RepairJob.aggregate([
        { $match: jobMatch },
        { $unwind: '$parts' },
        { $group: {
          _id:      '$parts.name',
          timesUsed: { $sum: '$parts.quantity' },
          revenue:  { $sum: { $multiply: ['$parts.priceAtTime', '$parts.quantity'] } },
          cost:     { $sum: { $multiply: ['$parts.costAtTime',  '$parts.quantity'] } },
        }},
        { $sort: { revenue: -1 } },
        { $limit: 8 },
      ]),
    ]);

    const ACTIVE_JOB = ['received', 'diagnosing', 'waiting_for_parts', 'repairing', 'ready'];
    const jobsTotal   = jobsByStatus.reduce((s, x) => s + x.count, 0);
    const jobsOpen    = jobsByStatus.filter(x => ACTIVE_JOB.includes(x._id)).reduce((s, x) => s + x.count, 0);
    const jobsDone    = jobsByStatus.find(x => x._id === 'collected')?.count || 0;
    const jobsCancelled = jobsByStatus.find(x => x._id === 'cancelled')?.count || 0;
    const partsUsed = topParts.reduce((s, p) => s + p.timesUsed, 0);

    // ── Top products (online orders + POS sales, revenue-bearing only) ──────────
    const [orderTop, saleTop] = await Promise.all([
      ordersInScope
        ? Order.aggregate([
            { $match: { ...rangeMatch, status: { $in: REVENUE_ORDER_STATUSES } } },
            { $unwind: '$items' },
            { $group: { _id: '$items.name', unitsSold: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } } } },
          ])
        : Promise.resolve([]),
      Sale.aggregate([
        { $match: saleMatch },
        { $unwind: '$items' },
        { $group: { _id: '$items.name', unitsSold: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } },
      ]),
    ]);
    const productMap = new Map();
    for (const p of [...orderTop, ...saleTop]) {
      const e = productMap.get(p._id) || { unitsSold: 0, revenue: 0 };
      e.unitsSold += p.unitsSold; e.revenue += p.revenue; productMap.set(p._id, e);
    }
    const topProducts = [...productMap.entries()]
      .map(([k, v]) => ({ _id: k, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // ── Inventory (parts + active shop products) ────────────────────────────────
    const [partAgg, partLow, partOut, prodAgg, prodOut, lowStockParts] = await Promise.all([
      Part.aggregate([
        { $group: { _id: null, count: { $sum: 1 }, units: { $sum: '$quantity' },
          valueSell: { $sum: { $multiply: ['$quantity', '$sellingPrice'] } },
          valueCost: { $sum: { $multiply: ['$quantity', '$costPrice'] } } } },
      ]),
      Part.countDocuments({ $expr: { $lte: ['$quantity', '$lowStockThreshold'] } }),
      Part.countDocuments({ quantity: { $lte: 0 } }),
      Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, count: { $sum: 1 }, units: { $sum: '$stock' }, valueSell: { $sum: { $multiply: ['$stock', '$price'] } } } },
      ]),
      Product.countDocuments({ isActive: true, stock: { $lte: 0 } }),
      Part.find({ $expr: { $lte: ['$quantity', '$lowStockThreshold'] } })
        .sort({ quantity: 1 })
        .limit(12)
        .select('name sku category quantity lowStockThreshold sellingPrice'),
    ]);

    // ── Expenses + net profit (admin/superadmin only — internal costs) ──────────
    const canSeeExpenses = ['superadmin', 'admin'].includes(req.user.role);
    let expenseTotal = 0;
    let expenseByCategory = [];
    let netProfit = null;
    if (canSeeExpenses) {
      const expenseMatch = rangeStart && rangeEnd ? { date: { $gte: rangeStart, $lte: rangeEnd } } : {};
      const [expTotal, expCat] = await Promise.all([
        Expense.aggregate([{ $match: expenseMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
        Expense.aggregate([
          { $match: expenseMatch },
          { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
        ]),
      ]);
      expenseTotal = expTotal[0]?.total || 0;
      expenseByCategory = expCat;
      netProfit = totalRevenue - expenseTotal;
    }

    // ── Staff scope metadata (name for the active filter; picker list for
    // admin/superadmin — the same roles allowed on this route in the first
    // place, since only they can appear as cashier/receivedBy/createdBy) ────
    const isAdminRole = ['superadmin', 'admin'].includes(req.user.role);
    const [staffUser, staffList] = await Promise.all([
      staffObjectId ? User.findById(staffObjectId).select('name role') : Promise.resolve(null),
      isAdminRole
        ? User.find({ role: { $in: ['staff', 'admin', 'superadmin'] } }).select('name role').sort({ name: 1 })
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        range: { from: rangeStart ? formatDateOnly(rangeStart) : null, to: rangeEnd ? formatDateOnly(rangeEnd) : null },
        scope: {
          staffId: staffObjectId ? String(staffObjectId) : null,
          staffName: staffUser?.name || null,
          isOwnReport: req.user.role === 'staff',
          staffList,
        },
        previous,
        kpi: {
          revenue:     { total: totalRevenue, repair: repairRevenue, posSales: posSalesRevenue, shopOrders: shopOrderRevenue },
          orders:      { total: orderTotal, paid: orderPaid, pending: orderPending, cancelled: orderCancelled, aov },
          repairs:     { total: jobsTotal, open: jobsOpen, completed: jobsDone, cancelled: jobsCancelled, partsUsed, revenue: repairRevenue },
          inventory:   {
            partCount:  partAgg[0]?.count   || 0,
            productCount: prodAgg[0]?.count || 0,
            units:      (partAgg[0]?.units || 0) + (prodAgg[0]?.units || 0),
            lowStock:   partLow,
            outOfStock: partOut + prodOut,
            valueSell:  (partAgg[0]?.valueSell || 0) + (prodAgg[0]?.valueSell || 0),
            valueCost:  partAgg[0]?.valueCost || 0,
          },
          payments: { count: (repairPay[0]?.count || 0) + (posSales[0]?.count || 0) },
          expenses: { total: expenseTotal, netProfit, canSeeExpenses },
        },
        revenueSeries,
        paymentMethods,
        orders: { byStatus: ordersByStatus, recent: ordersRecent },
        repairs: { byStatus: jobsByStatus, topParts },
        shipping: { byStatus: ordersByStatus },
        topProducts,
        lowStockParts,
        expenseByCategory,
      },
    });
  } catch (err) { next(err); }
};

// ─── MY DASHBOARD (staff & technician — scoped to the logged-in user) ─────────
// Technician: analytics for the jobs assigned to them, plus recent jobs to update.
// Staff:      the jobs they created, plus the sales (products) they rang up and
//             low-stock parts. Staff may see money; technicians never do.

module.exports = {
  getOverview,
  getMyOverview,
  getReportsAnalytics,
};
