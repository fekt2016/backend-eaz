const crypto = require('crypto');
const DomainOrder = require('../models/DomainOrder');
const HostingOrder = require('../models/HostingOrder');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { sendPaymentReceived } = require('../utils/hostingEmail');
const { provisionHostingAccount } = require('../utils/provisionHosting');
const namecheap = require('../services/namecheap');

/**
 * POST /api/webhooks/paystack
 * Handles charge.success for hosting, domain, and e-commerce orders.
 * Must receive the raw request body so the HMAC signature can be verified.
 */
const handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY || '';
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

    // ── Hosting order ────────────────────────────────────────
    const hostingOrder = await HostingOrder.findOne({ paystackReference: reference });
    if (hostingOrder) {
      hostingOrder.status = 'paid';
      hostingOrder.paidAt = new Date();
      await hostingOrder.save();
      sendPaymentReceived(hostingOrder).catch(() => {});
      provisionHostingAccount(hostingOrder).catch(() => {});
      return res.status(200).json({ received: true });
    }

    // ── Domain order ─────────────────────────────────────────
    const domainOrder = await DomainOrder.findOne({ paystackReference: reference });
    if (domainOrder) {
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

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[webhook] Paystack error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = { handlePaystackWebhook };
