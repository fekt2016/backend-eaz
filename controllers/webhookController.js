const crypto = require('crypto');
const DomainOrder = require('../models/DomainOrder');
const HostingOrder = require('../models/HostingOrder');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ServiceOrder = require('../models/ServiceOrder');
const User = require('../models/User');
const PartOrder = require('../models/PartOrder');
const RepairOrder = require('../models/RepairOrder');
const PosPayment = require('../models/PosPayment');
const RepairJob = require('../models/RepairJob');
const { sendPaymentReceived } = require('../utils/hostingEmail');
const { provisionHostingAccount } = require('../utils/provisionHosting');
const { fulfilShopOrder } = require('../utils/fulfilShopOrder');
const { sendDomainConfirmationEmail, sendServiceConfirmationEmail } = require('../utils/email');
const { notifyCustomer } = require('../services/notify');
const { deductPartStock } = require('../utils/deductPartStock');
const Part = require('../models/Part');
const spaceship = require('../services/spaceship');
const whm = require('../services/whm');
const { log, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { applyRefundOutcome } = require('../utils/refunds');

/**
 * Ensure a paid part is on the job, snapshot its real cost, and reserve stock
 * exactly once. `item` = { part, partName, quantity, unitPricePesewas }.
 *
 * - New line: priceAtTime = the paid unit price; costAtTime = the live
 *   Part.costPrice (not the sale price — fixes profit reporting).
 * - Stock is decremented once (guarded, never negative) and the line is flagged
 *   `stockDeducted` so the staff job-level deduction won't double-count it.
 */
async function applyPaidPartToJob(job, item) {
  // Match an inventory item only to the same inventory-linked line (by part id),
  // and a custom item only to a custom line (by name). This avoids attaching an
  // inventory part's stock/flag to an unrelated same-named custom line.
  let line = job.parts.find((p) =>
    item.part
      ? (p.part && p.part.toString() === item.part.toString())
      : (!p.part && p.name === item.partName)
  );

  let costAtTime = 0;
  if (item.part) {
    const partDoc = await Part.findById(item.part).select('costPrice');
    if (partDoc) costAtTime = Math.round(Number(partDoc.costPrice) || 0);
  }

  if (!line) {
    job.parts.push({
      part:        item.part || undefined,
      name:        item.partName,
      quantity:    item.quantity,
      priceAtTime: item.unitPricePesewas,
      costAtTime,
      stockDeducted: false,
    });
    line = job.parts[job.parts.length - 1];
  }

  if (!line.stockDeducted) {
    if (item.part) {
      const res = await deductPartStock(item.part, item.quantity || 1);
      if (!res.ok) {
        console.error(`[webhook] Stock reserve skipped for paid part ${item.part} on job ${job.jobNumber} — insufficient stock.`);
      }
    }
    line.stockDeducted = true;
  }
}

/**
 * Reject a webhook whose charged amount/currency doesn't match the order.
 * `expectedPesewas` must be in the smallest currency unit (pesewas), the same
 * unit Paystack reports in `event.data.amount`. Hosting/domain/service store
 * their major-GHS-float fields (`amount`/`price`/`depositAmount`) as an
 * intentional exception to the pesewas rule (T44, see the comment on
 * `models/HostingOrder.js`'s `amount` field for the full reasoning) — but as
 * of T44's follow-up, callers pass the order's own `amountPesewas`/
 * `depositAmountPesewas` field (computed once at creation) instead of
 * re-deriving it via `Math.round(field * 100)` here. The shop Order stores
 * `total` already in pesewas. When no reliable expected amount is available
 * (missing/zero — e.g. a pre-T44-followup order with no `*Pesewas` field
 * yet), we do NOT block — legacy orders must still be able to fulfil.
 */
function amountMismatch(eventData, expectedPesewas) {
  if (!Number.isFinite(expectedPesewas) || expectedPesewas <= 0) return false;
  if (Number(eventData.amount) !== expectedPesewas) return true;
  if (eventData.currency && eventData.currency !== 'GHS') return true;
  return false;
}

/**
 * POST /api/webhooks/paystack
 * Handles charge.success for hosting, domain, e-commerce, and service orders.
 * Must receive the raw request body so the HMAC signature can be verified.
 */
const handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY || '';
    if (!secret) {
      console.error('[webhook] PAYSTACK_SECRET not configured — rejecting request');
      return res.status(400).json({ error: 'Webhook not configured' });
    }

    const hash = crypto
      .createHmac('sha512', secret)
      .update(req.rawBody)
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    // T15 — refund completion. Matched by the refund id we stored on
    // creation, not the underlying transaction reference (a refund event's
    // own `id` is what we captured as order.refund.reference).
    if (event.event === 'refund.processed' || event.event === 'refund.failed') {
      const refundId = event.data?.id != null ? String(event.data.id) : null;
      const order = refundId ? await Order.findOne({ 'refund.reference': refundId }) : null;
      if (!order) {
        console.error(`[webhook] Refund event for unrecognised reference: ${refundId}`);
        return res.status(200).json({ received: true }); // nothing to reconcile — ack anyway
      }
      const outcome = event.event === 'refund.processed' ? 'completed' : 'failed';
      await applyRefundOutcome(order, outcome, null); // idempotent — no-op if already settled
      return res.status(200).json({ received: true });
    }

    if (event.event !== 'charge.success') {
      return res.status(200).json({ received: true });
    }

    const { reference } = event.data;

    // ── Hosting order (new or renewal) ───────────────────────────────
    const hostingOrder = await HostingOrder.findOne({ paystackReference: reference });
    if (hostingOrder) {
      // amount is major GHS (T44, intentional); amountPesewas is the
      // precomputed pesewas value — fall back to deriving it for orders
      // created before this field existed.
      if (amountMismatch(event.data, hostingOrder.amountPesewas ?? Math.round((hostingOrder.amount || 0) * 100))) {
        console.error(`[webhook] Amount mismatch for hosting order ${hostingOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Hosting order ${hostingOrder._id}`,
          description: `Payment failed — amount mismatch for hosting order ${hostingOrder._id}`,
          metadata: { reason: 'amount_mismatch' },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch' });
      }

      const wasPaidOrActive =
        hostingOrder.status === 'paid' || hostingOrder.status === 'active';

      if (wasPaidOrActive && hostingOrder.provisioningStatus !== 'not_started') {
        console.log(
          `[webhook] Duplicate webhook for already-processed order ${hostingOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }

      hostingOrder.status = 'paid';
      if (!hostingOrder.paidAt) hostingOrder.paidAt = new Date();

      if (hostingOrder.parentOrderId) {
        const parent = await HostingOrder.findById(hostingOrder.parentOrderId);
        // Set only when `parent` was found and actually renewed — used below to
        // report the new expiry (was previously read out of the `if (parent)`
        // block's scope, so this line always threw `base is not defined`).
        let base = null;
        if (parent) {
          if (parent.user?.toString() !== hostingOrder.user?.toString()) {
            console.error(
              `[webhook] User mismatch on renewal — parent: ${parent.user}, renewal: ${hostingOrder.user}. Skipping.`
            );
            return res.status(200).json({ received: true });
          }
          base =
            parent.expiresAt && parent.expiresAt > new Date()
              ? new Date(parent.expiresAt)
              : new Date();
          if (parent.billingCycle === 'annual') {
            base.setFullYear(base.getFullYear() + 1);
          } else {
            base.setMonth(base.getMonth() + 1);
          }
          parent.expiresAt = base;
          parent.renewedAt = new Date();
          parent.renewalOrderId = hostingOrder._id;
          parent.renewalReminderSent = 'none';
          if (['cancelled', 'suspended'].includes(parent.status) && parent.cpanelUsername) {
            parent.status = 'active';
            await whm.unsuspendAccount(parent.cpanelUsername).catch(() => {});
          }
          await parent.save({ validateBeforeSave: false }).catch(() => {});
          console.log(
            `[webhook] Renewal processed for order ${parent._id} — new expiry: ${base}`
          );
        } else {
          console.error(
            `[webhook] Renewal parent order ${hostingOrder.parentOrderId} not found for hosting order ${hostingOrder._id}`
          );
        }

        hostingOrder.status = 'active';
        hostingOrder.provisioningStatus = 'skipped';
        await hostingOrder.save({ validateBeforeSave: false });
        await log({
          action: ACTIONS.PAYMENT_VERIFIED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Hosting renewal ${hostingOrder.parentOrderId}`,
          description: base
            ? `Renewal payment verified for hosting order ${hostingOrder.parentOrderId} — new expiry ${base.toISOString().slice(0, 10)}`
            : `Renewal payment verified for hosting order ${hostingOrder.parentOrderId} — parent order not found, expiry not updated`,
          metadata: { reference, type: 'hosting_renewal' },
        });
        return res.status(200).json({ received: true });
      }

      if (hostingOrder.provisioningStatus === 'not_started') {
        hostingOrder.provisioningStatus = 'pending';
      }
      await hostingOrder.save({ validateBeforeSave: false });

      if (!wasPaidOrActive) {
        sendPaymentReceived(hostingOrder).catch(() => {});
      }
      provisionHostingAccount(hostingOrder).catch(() => {});
      await log({
        action: ACTIONS.PAYMENT_VERIFIED,
        resourceType: RESOURCES.PAYMENT,
        resourceId: reference,
        resourceName: `Hosting order ${hostingOrder._id}`,
        description: `Payment verified for hosting order ${hostingOrder._id}`,
        metadata: { reference, type: 'hosting' },
      });
      return res.status(200).json({ received: true });
    }

    // ── Domain order ─────────────────────────────────────────────────
    const domainOrder = await DomainOrder.findOne({ paystackReference: reference });
    if (domainOrder) {
      // price is major GHS (T44, intentional); amountPesewas is the
      // precomputed pesewas value — fall back to deriving it for orders
      // created before this field existed.
      if (amountMismatch(event.data, domainOrder.amountPesewas ?? Math.round((domainOrder.price || 0) * 100))) {
        console.error(`[webhook] Amount mismatch for domain order ${domainOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Domain order ${domainOrder._id}`,
          description: `Payment failed — amount mismatch for domain order ${domainOrder._id}`,
          metadata: { reason: 'amount_mismatch' },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch' });
      }

      if (domainOrder.status === 'completed') {
        console.log(
          `[webhook] Duplicate webhook for already-completed domain order ${domainOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }

      domainOrder.status = 'completed';
      domainOrder.paidAt = new Date();
      await domainOrder.save();
      await log({
        action: ACTIONS.PAYMENT_VERIFIED,
        resourceType: RESOURCES.PAYMENT,
        resourceId: reference,
        resourceName: domainOrder.domain,
        description: `Payment verified for domain order ${domainOrder.domain}`,
        metadata: { reference, type: 'domain' },
      });

      let registrationSucceeded = false;

      if (spaceship.hasConfig() && domainOrder.registrantInfo) {
        const regResult = await spaceship.registerDomain(
          domainOrder.domain,
          domainOrder.years || 1,
          {
            firstName:
              domainOrder.registrantInfo.firstName ||
              domainOrder.customerName?.split(' ')[0] ||
              '',
            lastName:
              domainOrder.registrantInfo.lastName ||
              domainOrder.customerName?.split(' ').slice(1).join(' ') ||
              '',
            email: domainOrder.email,
            phone: domainOrder.phone || '',
            address: domainOrder.registrantInfo.address || '',
            city: domainOrder.registrantInfo.city || '',
            country: domainOrder.registrantInfo.country || 'GH',
            postalCode: domainOrder.registrantInfo.postalCode || '00233',
          }
        );
        if (!regResult.success) {
          domainOrder.registrationError = regResult.error;
          await domainOrder.save({ validateBeforeSave: false }).catch(() => {});
          console.error(
            `[webhook] Domain registration failed for order ${domainOrder._id}: ${regResult.error}`
          );
        } else {
          registrationSucceeded = true;
        }
      }

      // ── Add domain to the user's account ─────────────────────────
      if (registrationSucceeded && domainOrder.user) {
        try {
          const years = domainOrder.years || 1;
          const expiresAt = new Date();
          expiresAt.setFullYear(expiresAt.getFullYear() + years);

          const alreadyLinked = await User.exists({
            _id: domainOrder.user,
            'domains.orderId': domainOrder._id,
          });

          if (!alreadyLinked) {
            await User.findByIdAndUpdate(
              domainOrder.user,
              {
                $push: {
                  domains: {
                    domain: domainOrder.domain,
                    orderId: domainOrder._id,
                    years,
                    registeredAt: new Date(),
                    expiresAt,
                    status: 'active',
                  },
                },
              },
              { new: true }
            );
            console.log(
              `[webhook] Domain ${domainOrder.domain} linked to user ${domainOrder.user}`
            );
          }
        } catch (err) {
          // Non-fatal — order is already marked completed, domain is registered
          console.error('[webhook] Failed to link domain to user account:', err.message);
        }
      }

      // T62 — the customer's only record of a domain purchase used to be a
      // database row. One email covering both registration outcomes; best-effort.
      sendDomainConfirmationEmail(domainOrder, { registered: registrationSucceeded }).catch(() => {});
    }

    // ── E-commerce order ────────────────────────────────────────
    const shopOrder = await Order.findOne({ paystackReference: reference });
    if (shopOrder) {
      const { amount, currency } = event.data;

      if (amount !== shopOrder.total) {
        return res.status(400).json({ error: 'Amount mismatch' });
      }
      if (currency && currency !== 'GHS') {
        return res.status(400).json({ error: 'Currency mismatch' });
      }

      const paid = await fulfilShopOrder(reference);
      if (!paid) {
        return res.status(200).json({ received: true, idempotent: true });
      }

      return res.status(200).json({ received: true });
    }

    // ── Repair part order ────────────────────────────────────────────
    const partOrder = await PartOrder.findOne({ paystackReference: reference });
    if (partOrder) {
      // subtotalPesewas is Paystack-native (amount × 100 from the GHS unit price).
      if (amountMismatch(event.data, partOrder.subtotalPesewas)) {
        console.error(`[webhook] Amount mismatch for part order ${partOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Part order ${partOrder._id}`,
          description: `Payment failed — amount mismatch for part order ${partOrder._id}`,
          metadata: { reason: 'amount_mismatch' },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch' });
      }

      // Atomic pending→paid transition. Null means already paid — idempotent.
      const paid = await PartOrder.findOneAndUpdate(
        { paystackReference: reference, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date() } },
        { new: true }
      );

      if (!paid) {
        return res.status(200).json({ received: true, idempotent: true });
      }

      await log({
        action: ACTIONS.PAYMENT_VERIFIED,
        resourceType: RESOURCES.PAYMENT,
        resourceId: reference,
        resourceName: `Part order ${paid._id}`,
        description: `Payment verified for part order ${paid._id} — ${paid.partName} ×${paid.quantity}`,
        metadata: { reference, type: 'part_order' },
      });

      fulfilPartOrder(paid).catch((err) =>
        console.error(`[webhook] Failed to fulfil part order ${paid._id}:`, err.message)
      );
      return res.status(200).json({ received: true });
    }

    // ── Repair order (prepaid parts + optional rider shipping) ───────────
    const repairOrder = await RepairOrder.findOne({ paystackReference: reference });
    if (repairOrder) {
      if (amountMismatch(event.data, repairOrder.totalPesewas)) {
        console.error(`[webhook] Amount mismatch for repair order ${repairOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Repair order ${repairOrder._id}`,
          description: `Payment failed — amount mismatch for repair order ${repairOrder._id}`,
          metadata: { reason: 'amount_mismatch' },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch' });
      }

      // Atomic pending→paid transition. Null means already paid — idempotent.
      const paid = await RepairOrder.findOneAndUpdate(
        { paystackReference: reference, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date() } },
        { new: true }
      );

      if (!paid) {
        return res.status(200).json({ received: true, idempotent: true });
      }

      await log({
        action: ACTIONS.PAYMENT_VERIFIED,
        resourceType: RESOURCES.PAYMENT,
        resourceId: reference,
        resourceName: `Repair order ${paid._id}`,
        description: `Payment verified for repair order ${paid._id} (${(paid.items || []).length} item(s))`,
        metadata: { reference, type: 'repair_order' },
      });

      fulfilRepairOrder(paid).catch((err) =>
        console.error(`[webhook] Failed to fulfil repair order ${paid._id}:`, err.message)
      );
      return res.status(200).json({ received: true });
    }

    // ── Job balance payment (customer pays outstanding invoice online) ────
    const balanceJob = await RepairJob.findOne({
      'balancePayments.reference': reference,
    });
    if (balanceJob) {
      const charge = balanceJob.balancePayments.find((c) => c.reference === reference);
      if (!charge || charge.status !== 'pending') {
        return res.status(200).json({ received: true, idempotent: true });
      }
      if (amountMismatch(event.data, charge.amountPesewas)) {
        console.error(`[webhook] Amount mismatch for balance payment ${reference}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Repair job ${balanceJob.jobNumber}`,
          description: `Payment failed — amount mismatch for balance payment on job ${balanceJob.jobNumber}`,
          metadata: { reason: 'amount_mismatch' },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch' });
      }

      const paid = await RepairJob.findOneAndUpdate(
        { _id: balanceJob._id, 'balancePayments.reference': reference, 'balancePayments.status': 'pending' },
        { $set: { 'balancePayments.$.status': 'paid', 'balancePayments.$.paidAt': new Date() } },
        { new: true }
      );

      if (!paid) {
        return res.status(200).json({ received: true, idempotent: true });
      }

      await log({
        action: ACTIONS.PAYMENT_VERIFIED,
        resourceType: RESOURCES.PAYMENT,
        resourceId: reference,
        resourceName: `Repair job ${balanceJob.jobNumber}`,
        description: `Balance payment verified for repair job ${balanceJob.jobNumber}`,
        metadata: { reference, type: 'job_balance' },
      });

      fulfilJobBalancePayment(paid, reference).catch((err) =>
        console.error(`[webhook] Failed to fulfil balance payment ${reference}:`, err.message)
      );
      return res.status(200).json({ received: true });
    }

    // ── Service order (web design deposit) ──────────────────────────
    const serviceOrder = await ServiceOrder.findOne({ paystackReference: reference });
    if (serviceOrder) {
      // depositAmount is major GHS (T44, intentional); depositAmountPesewas
      // is the precomputed pesewas value — fall back to deriving it for
      // orders created before this field existed.
      if (amountMismatch(event.data, serviceOrder.depositAmountPesewas ?? Math.round((serviceOrder.depositAmount || 0) * 100))) {
        console.error(`[webhook] Amount mismatch for service order ${serviceOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Service order ${serviceOrder._id}`,
          description: `Payment failed — amount mismatch for service order ${serviceOrder._id}`,
          metadata: { reason: 'amount_mismatch' },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch' });
      }

      if (serviceOrder.status === 'paid') {
        console.log(
          `[webhook] Duplicate webhook for already-paid service order ${serviceOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }
      serviceOrder.status = 'paid';
      serviceOrder.paidAt = new Date();
      await serviceOrder.save({ validateBeforeSave: false });
      await log({
        action: ACTIONS.PAYMENT_VERIFIED,
        resourceType: RESOURCES.PAYMENT,
        resourceId: reference,
        resourceName: `Service order ${serviceOrder._id}`,
        description: `Payment verified for service order ${serviceOrder._id} — ${serviceOrder.package}`,
        metadata: { reference, type: 'service' },
      });
      console.log(
        `[webhook] Service order paid: ${serviceOrder._id} — ${serviceOrder.package} for ${serviceOrder.email}`
      );

      // T62 — the project itself never said hello (only account creation did).
      // Deposit receipt + what happens next; best-effort.
      sendServiceConfirmationEmail(serviceOrder).catch(() => {});
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[webhook] Paystack error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

/**
 * After a part order is paid: record the revenue as a POS payment against the
 * job, ensure the part line exists on the job, and flag the job as
 * waiting_for_parts so staff know to start the repair once the part is in.
 */
async function fulfilPartOrder(partOrder) {
  const job = await RepairJob.findById(partOrder.job).populate('customer', 'name phone email');
  if (!job) return;

  // Record revenue so POS reports capture online part payments.
  const alreadyRecorded = await PosPayment.exists({ reference: partOrder.paystackReference });
  if (!alreadyRecorded) {
    // Public self-serve jobs have no staff creator — attribute the revenue to
    // the first available staff user instead of storing a job id in a User ref.
    let receivedBy = job.createdBy;
    if (!receivedBy) {
      const fallback = await User.findOne({ role: { $in: ['superadmin', 'admin', 'staff'] } })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();
      receivedBy = fallback ? fallback._id : null;
    }
    // receivedBy only exists when a User can be attributed — skip revenue
    // recording rather than corrupt the User ref with a job id.
    if (receivedBy) {
      await PosPayment.create({
        job:        job._id,
        amount:     partOrder.amountPesewas,
        method:     'card',
        reference:  partOrder.paystackReference,
        receivedBy,
        notes:      `Online part order — ${partOrder.partName} ×${partOrder.quantity}`,
      });
    }
  }

  // Ensure the paid part is on the job (re-add if staff removed it meanwhile),
  // snapshot real cost, and reserve stock once.
  await applyPaidPartToJob(job, {
    part:        partOrder.part,
    partName:    partOrder.partName,
    quantity:    partOrder.quantity,
    unitPricePesewas: partOrder.unitPricePesewas,
  });

  const before = job.status;
  if (['received', 'diagnosing'].includes(job.status)) {
    job.status = 'waiting_for_parts';
  }
  await job.save({ validateBeforeSave: false });

  if (before !== job.status) {
    notifyCustomer(job, 'waiting_for_parts').catch(() => {});
  }

  console.log(
    `[webhook] Part order ${partOrder._id} fulfilled — ${partOrder.partName} ×${partOrder.quantity} on job ${job.jobNumber}`
  );
}

/**
 * After a repair order is paid: record the revenue as a POS payment against the
 * job, add each ordered part as a line on the job, and flag the job as
 * waiting_for_parts. Idempotent via PosPayment.reference.
 */
async function fulfilRepairOrder(repairOrder) {
  const job = await RepairJob.findById(repairOrder.job).populate('customer', 'name phone email');
  if (!job) return;

  // Record revenue so POS reports capture online part payments (incl. shipping).
  const alreadyRecorded = await PosPayment.exists({ reference: repairOrder.paystackReference });
  if (!alreadyRecorded) {
    let receivedBy = job.createdBy;
    if (!receivedBy) {
      const fallback = await User.findOne({ role: { $in: ['superadmin', 'admin', 'staff'] } })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();
      receivedBy = fallback ? fallback._id : null;
    }
    if (receivedBy) {
      const names = (repairOrder.items || []).map(i => `${i.partName} ×${i.quantity}`).join(', ');
      await PosPayment.create({
        job:        job._id,
        amount:     repairOrder.totalPesewas, // PosPayment.amount is pesewas
        method:     'card',
        reference:  repairOrder.paystackReference,
        receivedBy,
        notes:      `Online order — ${names}${repairOrder.shippingFeePesewas ? ' + shipping' : ''}`,
      });
    }
  }

  // Ensure each paid part is on the job, snapshot real cost, and reserve stock once.
  for (const item of repairOrder.items || []) {
    await applyPaidPartToJob(job, {
      part:        item.part,
      partName:    item.partName,
      quantity:    item.quantity,
      unitPricePesewas: item.unitPricePesewas,
    });
  }

  const before = job.status;
  if (['received', 'diagnosing'].includes(job.status)) {
    job.status = 'waiting_for_parts';
  }
  await job.save({ validateBeforeSave: false });

  if (before !== job.status) {
    notifyCustomer(job, 'waiting_for_parts').catch(() => {});
  }

  console.log(
    `[webhook] Repair order ${repairOrder._id} fulfilled — ${(repairOrder.items || []).length} item(s) on job ${job.jobNumber}`
  );
}

/**
 * After a job balance payment succeeds: record the revenue as a POS payment
 * against the job so reports and the invoice reconcile. Idempotent via
 * PosPayment.reference.
 */
async function fulfilJobBalancePayment(job, reference) {
  const charge = (job.balancePayments || []).find((c) => c.reference === reference);
  if (!charge) return;

  const alreadyRecorded = await PosPayment.exists({ reference });
  if (!alreadyRecorded) {
    let receivedBy = job.createdBy;
    if (!receivedBy) {
      const fallback = await User.findOne({ role: { $in: ['superadmin', 'admin', 'staff'] } })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();
      receivedBy = fallback ? fallback._id : null;
    }
    if (receivedBy) {
      await PosPayment.create({
        job:        job._id,
        amount:     charge.amountPesewas, // PosPayment.amount is pesewas
        method:     'card',
        reference,
        receivedBy,
        notes:      'Online balance payment',
      });
    }
  }

  console.log(
    `[webhook] Balance payment ${reference} fulfilled — GH₵${(charge.amountPesewas / 100).toFixed(2)} on job ${job.jobNumber}`
  );
}

module.exports = { handlePaystackWebhook, amountMismatch, applyPaidPartToJob };
