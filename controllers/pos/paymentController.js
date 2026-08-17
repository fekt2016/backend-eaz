const {
  mongoose, crypto, Paystack, PosCustomer, RepairJob, Part, Product, PosPayment, PartOrder, RepairOrder, Order, DeliveryZone, Sale, User, Expense, Supplier, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, deductPartStock, cloudinary, streamifier, notifyCustomer, sendCredentialsSms, sendAccountCreatedEmail, log, logFromRequest, buildChanges, ACTIONS, RESOURCES, escapeRegex, normalizePhone, paystack, FRONTEND_URL, ACTIVE_JOB_STATUSES, REVENUE_ORDER_STATUSES, EXPENSE_CATEGORIES, MOMO_PROVIDERS, computeJobBalancePesewas, deductJobPartsOnce, generatePassword, findTechnicianToAssign, normalizeProduct, formatDateOnly, pctChange, formatGhs
} = require('./common');

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
    await logFromRequest(req, {
      action: ACTIONS.REPAIR_PAYMENT_ADDED,
      resourceType: RESOURCES.REPAIR,
      resourceId: job.jobNumber,
      resourceName: job.jobNumber,
      description: `Payment of ${formatGhs(amount)} (${method}) recorded on repair job ${job.jobNumber}`,
      metadata: { method, amountPesewas: Number(amount), reference: payment.reference || '' },
    });
    res.status(201).json({ success: true, data: payment });
  } catch (err) { next(err); }
};

// ─── INVENTORY ───────────────────────────────────────────────────────────────

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
  addPayment,
  createBalancePayment,
  initiateMomoCharge,
  initiateCardCharge,
  checkMomoCharge,
};
