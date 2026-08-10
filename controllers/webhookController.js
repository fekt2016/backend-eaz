const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const DomainOrder = require('../models/DomainOrder');
const HostingOrder = require('../models/HostingOrder');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ServiceOrder = require('../models/ServiceOrder');
const User = require('../models/User');
const { sendPaymentReceived } = require('../utils/hostingEmail');
const { provisionHostingAccount } = require('../utils/provisionHosting');
const namecheap = require('../services/namecheap');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
});

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

    if (event.event !== 'charge.success') {
      return res.status(200).json({ received: true });
    }

    const { reference } = event.data;

    // ── Hosting order (new or renewal) ───────────────────────────────
    const hostingOrder = await HostingOrder.findOne({ paystackReference: reference });
    if (hostingOrder) {
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
        if (parent) {
          if (parent.user?.toString() !== hostingOrder.user?.toString()) {
            console.error(
              `[webhook] User mismatch on renewal — parent: ${parent.user}, renewal: ${hostingOrder.user}. Skipping.`
            );
            return res.status(200).json({ received: true });
          }
          const base =
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
          if (parent.status === 'cancelled' && parent.cpanelUsername) {
            parent.status = 'active';
            await unsuspendCpanelAccount(parent.cpanelUsername).catch(() => {});
          }
          await parent.save({ validateBeforeSave: false }).catch(() => {});
          console.log(
            `[webhook] Renewal processed for order ${parent._id} — new expiry: ${base}`
          );
        }

        hostingOrder.status = 'active';
        hostingOrder.provisioningStatus = 'skipped';
        await hostingOrder.save({ validateBeforeSave: false });
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
      return res.status(200).json({ received: true });
    }

    // ── Domain order ─────────────────────────────────────────────────
    const domainOrder = await DomainOrder.findOne({ paystackReference: reference });
    if (domainOrder) {
      if (domainOrder.status === 'completed') {
        console.log(
          `[webhook] Duplicate webhook for already-completed domain order ${domainOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }

      domainOrder.status = 'completed';
      domainOrder.paidAt = new Date();
      await domainOrder.save();

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

      // Atomic pending→paid transition. If it returns null the order was
      // already paid — idempotent, so do not re-decrement stock.
      const paid = await Order.findOneAndUpdate(
        { paystackReference: reference, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date() } },
        { new: true }
      );

      if (!paid) {
        return res.status(200).json({ received: true, idempotent: true });
      }

      // Decrement stock atomically per item. Never oversell: if the guard
      // fails for an item, log it and continue.
      for (const item of paid.items) {
        const result = await Product.findOneAndUpdate(
          { _id: item.product, stock: { $gte: item.qty } },
          { $inc: { stock: -item.qty } }
        );
        if (!result) {
          console.error(
            `[webhook] Stock decrement failed for order ${paid.orderNumber} item ${item.name} (qty ${item.qty})`
          );
        }
      }

      return res.status(200).json({ received: true });
    }

    // ── Service order (web design deposit) ──────────────────────────
    const serviceOrder = await ServiceOrder.findOne({ paystackReference: reference });
    if (serviceOrder) {
      if (serviceOrder.status === 'paid') {
        console.log(
          `[webhook] Duplicate webhook for already-paid service order ${serviceOrder._id} — skipping`
        );
        return res.status(200).json({ received: true });
      }
      serviceOrder.status = 'paid';
      serviceOrder.paidAt = new Date();
      await serviceOrder.save({ validateBeforeSave: false });
      console.log(
        `[webhook] Service order paid: ${serviceOrder._id} — ${serviceOrder.package} for ${serviceOrder.email}`
      );
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[webhook] Paystack error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = { handlePaystackWebhook };
