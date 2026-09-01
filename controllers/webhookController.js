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
const { fulfilShopOrder, PAYMENT_GUARD_CODES } = require('../utils/fulfilShopOrder');
const { sendDomainConfirmationEmail, sendServiceConfirmationEmail } = require('../utils/email');
const { notifyCustomer } = require('../services/notify');
const { deductPartStock } = require('../utils/deductPartStock');
const namecheap = require('../services/namecheap');
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
    const partDoc = await Product.findById(item.part).select('costPrice');
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
/**
 * Constant-time comparison of the computed HMAC against the header (T94).
 * Returns false for a missing, non-string or wrong-length signature rather than
 * letting timingSafeEqual throw.
 */
function signatureMatches(computedHex, headerValue) {
  if (typeof headerValue !== 'string' || headerValue.length !== computedHex.length) return false;
  const a = Buffer.from(computedHex, 'utf8');
  const b = Buffer.from(headerValue, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function amountMismatch(eventData, expectedPesewas) {
  // T90 — this used to return false ("no mismatch") when the expected amount
  // was missing or zero, so any such order fulfilled for ANY charged amount,
  // including 1 pesewa. It was an escape hatch for orders written before the
  // `*Pesewas` fields existed. Verified against the live database 2026-08-29:
  // hostingorders, domainorders, serviceorders, partorders and repairorders are
  // all empty, so the hatch protected nothing and the default is now to refuse.
  //
  // Returns a reason string, or null when the charge checks out — the caller
  // logs it, so an operator can tell "we were charged the wrong amount" from
  // "we could not tell what the right amount was".
  if (!Number.isFinite(expectedPesewas) || expectedPesewas <= 0) return 'amount_unverifiable';
  if (Number(eventData.amount) !== expectedPesewas) return 'amount_mismatch';
  if (eventData.currency && eventData.currency !== 'GHS') return 'currency_mismatch';
  return null;
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

    // T94 — constant-time. `!==` short-circuits on the first differing byte,
    // which is a timing side channel; impractical to exploit remotely against a
    // SHA-512 HMAC, but there is no reason to leave it. timingSafeEqual throws
    // on unequal lengths, so the length check has to come first — and it is not
    // a leak, because the length of a hex SHA-512 digest is public anyway.
    if (!signatureMatches(hash, req.headers['x-paystack-signature'])) {
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
    let hostingOrder = await HostingOrder.findOne({ paystackReference: reference });
    if (hostingOrder) {
      // amount is major GHS (T44, intentional); amountPesewas is the
      // precomputed pesewas value — fall back to deriving it for orders
      // created before this field existed.
      const failure = amountMismatch(event.data, hostingOrder.amountPesewas ?? Math.round((hostingOrder.amount || 0) * 100));
      if (failure) {
        console.error(`[webhook] ${failure} for hosting order ${hostingOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Hosting order ${hostingOrder._id}`,
          description: `Payment held — ${failure} — for hosting order ${hostingOrder._id}`,
          metadata: { reason: failure },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch', reason: failure });
      }

      // Read BEFORE the claim below — it decides whether to send the
      // payment-received email, which must not fire on a retry.
      const wasPaidOrActive =
        hostingOrder.status === 'paid' || hostingOrder.status === 'active';

      // T121 — claim the order ATOMICALLY rather than read-then-check-then-write.
      //
      // This used to read the document, test `paid/active && provisioningStatus
      // !== 'not_started'`, and only then write. Two webhooks arriving together
      // could both pass that test before either wrote, and both would go on to
      // provision. Paystack does retry, and retries can overlap. The shop path
      // has always been safe (utils/fulfilShopOrder.js does a single guarded
      // findOneAndUpdate); this branch was the exception.
      //
      // The filter is the negation of the duplicate test, so exactly one
      // concurrent caller gets a document back and every other gets null.
      const claimed = await HostingOrder.findOneAndUpdate(
        {
          _id: hostingOrder._id,
          $nor: [{
            status: { $in: ['paid', 'active'] },
            provisioningStatus: { $ne: 'not_started' },
          }],
        },
        { $set: { status: 'paid', paidAt: hostingOrder.paidAt || new Date() } },
        { new: true },
      );

      if (!claimed) {
        console.log(
          `[webhook] Duplicate webhook for already-processed order ${hostingOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }

      // Everything below mutates and saves this document, so it must be the one
      // the claim returned — saving the pre-claim copy would write stale state
      // straight over the claim we just won.
      hostingOrder = claimed;

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
    let domainOrder = await DomainOrder.findOne({ paystackReference: reference });
    if (domainOrder) {
      // price is major GHS (T44, intentional); amountPesewas is the
      // precomputed pesewas value — fall back to deriving it for orders
      // created before this field existed.
      const failure = amountMismatch(event.data, domainOrder.amountPesewas ?? Math.round((domainOrder.price || 0) * 100));
      if (failure) {
        console.error(`[webhook] ${failure} for domain order ${domainOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Domain order ${domainOrder._id}`,
          description: `Payment held — ${failure} — for domain order ${domainOrder._id}`,
          metadata: { reason: failure },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch', reason: failure });
      }

      // T121 — the same atomic claim as the hosting branch above. This had the
      // identical read-then-check-then-write shape: two overlapping Paystack
      // retries could both see status !== 'completed' before either wrote, and
      // both would go on to register the domain. Registering twice spends real
      // money at the registrar, so this one is worth more than the hosting case.
      const claimedDomain = await DomainOrder.findOneAndUpdate(
        { _id: domainOrder._id, status: { $ne: 'completed' } },
        { $set: { status: 'completed', paidAt: new Date() } },
        { new: true },
      );

      if (!claimedDomain) {
        console.log(
          `[webhook] Duplicate webhook for already-completed domain order ${domainOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }

      // Continue on the claimed document — the pre-claim copy is stale.
      domainOrder = claimedDomain;
      await log({
        action: ACTIONS.PAYMENT_VERIFIED,
        resourceType: RESOURCES.PAYMENT,
        resourceId: reference,
        resourceName: domainOrder.domain,
        description: `Payment verified for domain order ${domainOrder.domain}`,
        metadata: { reference, type: 'domain' },
      });

      let registrationSucceeded = false;

      if (namecheap.hasConfig() && domainOrder.registrantInfo) {
        const regResult = await namecheap.registerDomain(
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
      // The amount/currency guard lives inside fulfilShopOrder now, so the
      // charge is checked in the same atomic write that flips the order paid.
      let paid;
      try {
        paid = await fulfilShopOrder(reference, {
          amountPesewas: event.data.amount,
          currency:      event.data.currency,
        });
      } catch (err) {
        if (!PAYMENT_GUARD_CODES.includes(err.code)) throw err;
        console.error(`[webhook] ${err.message}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: shopOrder.orderNumber,
          description: `Payment failed — ${err.message}`,
          metadata: { reason: err.code.toLowerCase() },
          status: 'failure',
        });
        return res.status(400).json({
          error: err.code === 'CURRENCY_MISMATCH' ? 'Currency mismatch' : 'Amount mismatch',
        });
      }

      if (!paid) {
        return res.status(200).json({ received: true, idempotent: true });
      }

      return res.status(200).json({ received: true });
    }

    // ── Repair part order ────────────────────────────────────────────
    const partOrder = await PartOrder.findOne({ paystackReference: reference });
    if (partOrder) {
      // subtotalPesewas is Paystack-native (amount × 100 from the GHS unit price).
      const failure = amountMismatch(event.data, partOrder.subtotalPesewas);
      if (failure) {
        console.error(`[webhook] ${failure} for part order ${partOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Part order ${partOrder._id}`,
          description: `Payment held — ${failure} — for part order ${partOrder._id}`,
          metadata: { reason: failure },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch', reason: failure });
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
      const failure = amountMismatch(event.data, repairOrder.totalPesewas);
      if (failure) {
        console.error(`[webhook] ${failure} for repair order ${repairOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Repair order ${repairOrder._id}`,
          description: `Payment held — ${failure} — for repair order ${repairOrder._id}`,
          metadata: { reason: failure },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch', reason: failure });
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
      const failure = amountMismatch(event.data, charge.amountPesewas);
      if (failure) {
        console.error(`[webhook] ${failure} for balance payment ${reference}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Repair job ${balanceJob.jobNumber}`,
          description: `Payment held — ${failure} — for balance payment on job ${balanceJob.jobNumber}`,
          metadata: { reason: failure },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch', reason: failure });
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
    let serviceOrder = await ServiceOrder.findOne({ paystackReference: reference });
    if (serviceOrder) {
      // depositAmount is major GHS (T44, intentional); depositAmountPesewas
      // is the precomputed pesewas value — fall back to deriving it for
      // orders created before this field existed.
      const failure = amountMismatch(event.data, serviceOrder.depositAmountPesewas ?? Math.round((serviceOrder.depositAmount || 0) * 100));
      if (failure) {
        console.error(`[webhook] ${failure} for service order ${serviceOrder._id}`);
        await log({
          action: ACTIONS.PAYMENT_FAILED,
          resourceType: RESOURCES.PAYMENT,
          resourceId: reference,
          resourceName: `Service order ${serviceOrder._id}`,
          description: `Payment held — ${failure} — for service order ${serviceOrder._id}`,
          metadata: { reason: failure },
          status: 'failure',
        });
        return res.status(400).json({ error: 'Amount mismatch', reason: failure });
      }

      // T121 — atomic pending→paid claim, matching the hosting, domain, part
      // and repair branches. This used a read-then-check-then-write: read the
      // order, test `status === 'paid'`, only then write. Two overlapping
      // Paystack retries could both pass the check before either wrote, and
      // both would go on to trigger the deposit's follow-up work. The filter
      // keeps the field binding in the claim so exactly one caller wins.
      const claimedService = await ServiceOrder.findOneAndUpdate(
        { _id: serviceOrder._id, status: { $ne: 'paid' } },
        { $set: { status: 'paid', paidAt: new Date() } },
        { new: true },
      );

      if (!claimedService) {
        console.log(
          `[webhook] Duplicate webhook for already-paid service order ${serviceOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }
      // Continue on the claimed document — the pre-claim copy is stale.
      serviceOrder = claimedService;
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
