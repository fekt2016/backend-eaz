const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const DomainOrder = require('../models/DomainOrder');
const HostingOrder = require('../models/HostingOrder');
const ServiceOrder = require('../models/ServiceOrder');
const { sendPaymentReceived } = require('../utils/hostingEmail');
const { provisionHostingAccount } = require('../utils/provisionHosting');
const namecheap = require('../services/namecheap');

const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === 'production' });

async function unsuspendCpanelAccount(username) {
  if (!process.env.WHM_HOST || !process.env.WHM_TOKEN) return;
  const user = process.env.WHM_USER || 'root';
  try {
    await axios.get(`${process.env.WHM_HOST}/json-api/unsuspendacct`, {
      params: { 'api.version': 1, user: username },
      headers: { Authorization: `whm ${user}:${process.env.WHM_TOKEN}` },
      httpsAgent,
      timeout: 15000,
    });
    console.log(`[webhook] cPanel account unsuspended: ${username}`);
  } catch (err) {
    console.error(`[webhook] Failed to unsuspend ${username}:`, err.message);
  }
}

/**
 * POST /api/webhooks/paystack
 * Handles charge.success for both domain and hosting orders.
 * Must receive the raw request body so the HMAC signature can be verified.
 */
const handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET;
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

    if (event.event !== 'charge.success') {
      return res.status(200).json({ received: true });
    }

    const { reference } = event.data;

    // ── Hosting order (new or renewal) ───────────────────────
    const hostingOrder = await HostingOrder.findOne({ paystackReference: reference });
    if (hostingOrder) {
      const wasPaidOrActive = hostingOrder.status === 'paid' || hostingOrder.status === 'active';

      // Idempotency: if already fully processed, acknowledge and stop
      if (wasPaidOrActive && hostingOrder.provisioningStatus !== 'not_started') {
        console.log(`[webhook] Duplicate webhook for already-processed order ${hostingOrder._id} — skipping`);
        return res.status(200).json({ received: true });
      }

      hostingOrder.status = 'paid';
      if (!hostingOrder.paidAt) hostingOrder.paidAt = new Date();

      // ── Renewal: extend expiresAt on parent order ─────────
      if (hostingOrder.parentOrderId) {
        const parent = await HostingOrder.findById(hostingOrder.parentOrderId);
        if (parent) {
          // Safety: ensure the renewal belongs to the same customer as the parent
          if (parent.user?.toString() !== hostingOrder.user?.toString()) {
            console.error(`[webhook] User mismatch on renewal — parent: ${parent.user}, renewal: ${hostingOrder.user}. Skipping.`);
            return res.status(200).json({ received: true });
          }
          // Extend from current expiry (or now if already expired)
          const base = parent.expiresAt && parent.expiresAt > new Date() ? new Date(parent.expiresAt) : new Date();
          if (parent.billingCycle === 'annual') {
            base.setFullYear(base.getFullYear() + 1);
          } else {
            base.setMonth(base.getMonth() + 1);
          }
          parent.expiresAt = base;
          parent.renewedAt = new Date();
          parent.renewalOrderId = hostingOrder._id;
          parent.renewalReminderSent = 'none'; // reset so reminders fire again next cycle
          // Reactivate if it was suspended due to expiry
          if (parent.status === 'cancelled' && parent.cpanelUsername) {
            parent.status = 'active';
            await unsuspendCpanelAccount(parent.cpanelUsername).catch(() => {});
          }
          await parent.save({ validateBeforeSave: false }).catch(() => {});
          console.log(`[webhook] Renewal processed for order ${parent._id} — new expiry: ${base}`);
        }

        // Mark renewal order as active (no re-provisioning needed)
        hostingOrder.status = 'active';
        hostingOrder.provisioningStatus = 'skipped';
        await hostingOrder.save({ validateBeforeSave: false });
        return res.status(200).json({ received: true });
      }

      // ── New order: normal flow ────────────────────────────
      if (hostingOrder.provisioningStatus === 'not_started') {
        hostingOrder.provisioningStatus = 'pending';
      }
      await hostingOrder.save({ validateBeforeSave: false });

      if (!wasPaidOrActive) {
        sendPaymentReceived(hostingOrder).catch(() => {});
      }
      provisionHostingAccount(hostingOrder).catch(() => {});
      return res.status(200).json({ received: true });
    }

    // ── Domain order ─────────────────────────────────────────
    const domainOrder = await DomainOrder.findOne({ paystackReference: reference });
    if (domainOrder) {
      // Idempotency: skip if already processed
      if (domainOrder.status === 'completed') {
        console.log(`[webhook] Duplicate webhook for already-completed domain order ${domainOrder._id} — skipping`);
        return res.status(200).json({ received: true });
      }
      domainOrder.status = 'completed';
      domainOrder.paidAt = new Date();
      await domainOrder.save();

      if (namecheap.hasConfig() && domainOrder.registrantInfo) {
        const regResult = await namecheap.registerDomain(
          domainOrder.domain,
          domainOrder.years || 1,
          {
            firstName: domainOrder.registrantInfo.firstName || domainOrder.customerName?.split(' ')[0] || '',
            lastName: domainOrder.registrantInfo.lastName || domainOrder.customerName?.split(' ').slice(1).join(' ') || '',
            email: domainOrder.email,
            phone: domainOrder.phone || '',
            address: domainOrder.registrantInfo.address || '',
            city: domainOrder.registrantInfo.city || '',
            country: domainOrder.registrantInfo.country || 'GH',
            postalCode: domainOrder.registrantInfo.postalCode || '00233'
          }
        );
        if (!regResult.success) {
          domainOrder.registrationError = regResult.error;
          await domainOrder.save({ validateBeforeSave: false }).catch(() => {});
        }
      }
    }

    // ── Service order (web design deposit) ──────────────────
    const serviceOrder = await ServiceOrder.findOne({ paystackReference: reference });
    if (serviceOrder) {
      if (serviceOrder.status === 'paid') {
        console.log(`[webhook] Duplicate webhook for already-paid service order ${serviceOrder._id} — skipping`);
        return res.status(200).json({ received: true });
      }
      serviceOrder.status = 'paid';
      serviceOrder.paidAt = new Date();
      await serviceOrder.save({ validateBeforeSave: false });
      console.log(`[webhook] Service order paid: ${serviceOrder._id} — ${serviceOrder.package} for ${serviceOrder.email}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[webhook] Paystack error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = { handlePaystackWebhook };
