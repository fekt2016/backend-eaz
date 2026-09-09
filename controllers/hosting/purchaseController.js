/**
 * Buying hosting: a new order, a renewal, and the bank-transfer proof
 * that settles one.
 *
 * Split out of controllers/hostingOrderController.js, which re-exports these
 * so the route file is unchanged. Moved verbatim.
 */
const {
  crypto, Paystack, streamifier, HostingOrder, sanitizeName, sanitizeEmail,
  sanitizePhone, sanitizeText, sanitizeDomain, getPlanPrice,
  PLAN_AVAILABILITY, isSellable, namecheap, cloudinary,
  sendOrderConfirmation, extractTLD, paystack, FRONTEND_URL,
  computeAddonsTotal,
} = require("./common");


/**
 * POST /api/v1/hosting/orders
 * Create a hosting order and optionally initialize Paystack payment.
 */
const createOrder = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const {
      planType, tier, billingCycle, addons = [], customer,
      paymentMethod, mobileNumber, network,
      domainMode = 'skip', domainRegistrationFee = 0, domainRegistrationYears = 1
    } = req.body;

    // Sanitize customer fields
    const customerName    = sanitizeName(customer?.name);
    const customerEmail   = sanitizeEmail(customer?.email);
    const customerPhone   = sanitizePhone(customer?.phone);
    const customerAddress = sanitizeText(customer?.address, 200);
    const customerCity    = sanitizeText(customer?.city, 100);
    const mobileNumber_s  = sanitizePhone(mobileNumber);
    const domain_s        = sanitizeDomain(req.body.domain);

    if (!planType || !tier || !billingCycle || !customerName || !customerEmail) {
      return res.status(400).json({
        success: false,
        error: 'planType, tier, billingCycle, and customer (name, email) are required'
      });
    }

    // Only take money for what we can actually deliver. A reseller plan creates
    // cPanel accounts and nothing else: `vps` has no supplier and no API, and
    // `cloud`/`email` cannot be delivered at all. Both used to be accepted here —
    // the storefront never linked to them, but the endpoint did, so a stale
    // client or a crafted request could pay GH₵950/month for a server nobody
    // could build. Staff keep their own path (`staffCreateHostingAccount`) for
    // an order they have genuinely sourced.
    if (!isSellable(planType)) {
      return res.status(400).json({
        success: false,
        error:
          PLAN_AVAILABILITY[planType] === 'enquiry'
            ? 'This plan is quoted individually — please request a quote instead of ordering online.'
            : 'This plan is not available for online purchase.',
      });
    }

    const { basePrice, discountAmount, total: planTotal } = getPlanPrice(planType, tier, billingCycle);
    if (planTotal == null) {
      return res.status(400).json({ success: false, error: 'Invalid plan or tier' });
    }

    const addonsTotal = computeAddonsTotal(addons);

    // Re-compute domain fee server-side — never trust client-supplied price.
    // getPricing() keys are dot-prefixed (e.g. ".com") and already in GHS
    // (rate + markup applied) — see services/namecheap.js's usdToGhs.
    let domainFee = 0;
    if (domainMode === 'new' && domain_s) {
      try {
        const tld = extractTLD(domain_s);
        const prices = await namecheap.getPricing();
        const priceGHS = prices[tld] ?? null;
        if (priceGHS != null) {
          const years = Math.min(10, Math.max(1, Number(domainRegistrationYears) || 1));
          domainFee = Math.round(priceGHS * years * 100) / 100;
        } else {
          // Unknown TLD — use client value with sanity cap (≤ GHS 500)
          domainFee = Math.min(Number(domainRegistrationFee) || 0, 500);
        }
      } catch {
        // Namecheap unavailable — fall back to client value with sanity cap
        domainFee = Math.min(Number(domainRegistrationFee) || 0, 500);
      }
    }

    const totalAmount = planTotal + addonsTotal + domainFee;
    // T44 follow-up: computed once here, reused for both the stored
    // pesewas field and the Paystack init call below — avoids re-deriving
    // it via a second Math.round(totalAmount * 100) that could (in theory)
    // diverge from this one.
    const totalAmountPesewas = Math.round(totalAmount * 100);

    const cleanDomain = domain_s || null;

    const orderPayload = {
      user: userId,
      planType,
      tier,
      billingCycle,
      addons: addons.map(a => ({ id: a.id, name: a.name, price: a.price || 0 })),
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone || '',
        address: customerAddress || '',
        city: customerCity || '',
        country: (customer?.country || 'Ghana').trim()
      },
      amount: totalAmount,
      amountPesewas: totalAmountPesewas,
      currency: 'GHS',
      status: 'pending',
      provisioningStatus: 'not_started',
      provisioningStartedAt: null,
      paymentMethod: paymentMethod || 'bank_transfer',
      ...(cleanDomain && { domain: cleanDomain }),
      domainMode: ['new', 'own', 'skip'].includes(domainMode) ? domainMode : 'skip',
      ...(domainMode === 'new' && cleanDomain && {
        domainRegistrationFee: domainFee,
        domainRegistrationYears: Math.min(10, Math.max(1, Number(domainRegistrationYears) || 1)),
        domainRegistered: false,
      }),
    };

    const isPaystack = paymentMethod === 'paystack_card' || paymentMethod === 'mobile_money';

    if (isPaystack && paystack) {
      const reference = `HOST_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      const transaction = await paystack.transaction.initialize({
        email: orderPayload.customer.email,
        amount: totalAmountPesewas,
        currency: 'GHS',
        reference,
        channels: paymentMethod === 'mobile_money' ? ['mobile_money'] : ['card', 'mobile_money'],
        metadata: {
          type: 'hosting_order',
          planType,
          tier,
          billingCycle: billingCycle
        },
        callback_url: `${FRONTEND_URL}/hosting/order-confirmation`,
        ...(paymentMethod === 'mobile_money' && mobileNumber_s && { mobile_money: { phone: mobileNumber_s, provider: network || 'mtn' } })
      });

      if (!transaction.status) {
        return res.status(500).json({
          success: false,
          error: 'Failed to initialize payment'
        });
      }

      orderPayload.paystackReference = reference;
      const order = await HostingOrder.create(orderPayload);
      sendOrderConfirmation(order).catch(() => {});

      return res.status(200).json({
        success: true,
        data: {
          authorizationUrl: transaction.data.authorization_url,
          accessCode: transaction.data.access_code,
          reference: transaction.data.reference,
          orderId: order._id
        }
      });
    }

    // Bank transfer: create order only, no Paystack
    const order = await HostingOrder.create(orderPayload);
    sendOrderConfirmation(order).catch(() => {});
    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id
      }
    });
  } catch (err) {
    next(err);
  }
};


/**
 * POST /api/v1/hosting/orders/:id/proof
 * Upload bank transfer proof (order owner only, bank_transfer + pending).
 */
const uploadOrderProof = async (req, res, next) => {
  try {
    const order = await HostingOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not allowed to update this order' });
    }
    if (order.paymentMethod !== 'bank_transfer' || order.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending bank transfer orders can have proof uploaded' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No file provided. Upload an image or PDF (max 5MB).' });
    }
    const uploadPromise = new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'eazworld/hosting-proofs', resource_type: 'auto' },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });
    const result = await uploadPromise;
    order.proofUploadUrl = result.secure_url;
    order.proofUploadedAt = new Date();
    await order.save();
    return res.status(200).json({ success: true, data: { proofUploadUrl: order.proofUploadUrl } });
  } catch (err) {
    next(err);
  }
};


/**
 * POST /api/v1/hosting/orders/:id/renew
 * Create a renewal payment for an existing hosting order (owner only).
 * On payment success the webhook extends expiresAt on the parent order.
 */
const renewOrder = async (req, res, next) => {
  try {
    const original = await HostingOrder.findById(req.params.id);
    if (!original) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (original.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    if (!['active', 'cancelled'].includes(original.status)) {
      return res.status(400).json({ success: false, error: 'Only active or expired orders can be renewed' });
    }

    const { paymentMethod, mobileNumber, network } = req.body;
    if (!paymentMethod) {
      return res.status(400).json({ success: false, error: 'paymentMethod is required' });
    }

    // Price is the same plan — no domain fee on renewal
    const { total: planTotal } = getPlanPrice(original.planType, original.tier, original.billingCycle);
    if (planTotal == null) {
      return res.status(400).json({ success: false, error: 'Could not determine renewal price' });
    }

    const planTotalPesewas = Math.round(planTotal * 100);

    const renewalPayload = {
      user: original.user,
      planType: original.planType,
      tier: original.tier,
      billingCycle: original.billingCycle,
      addons: original.addons || [],
      customer: original.customer,
      amount: planTotal,
      amountPesewas: planTotalPesewas,
      currency: 'GHS',
      status: 'pending',
      provisioningStatus: 'not_started',
      paymentMethod,
      domain: original.domain || null,
      domainMode: 'skip', // domain already set up, no re-registration
      parentOrderId: original._id,
    };

    const isPaystack = paymentMethod === 'paystack_card' || paymentMethod === 'mobile_money';

    if (isPaystack && paystack) {
      const reference = `RENEW_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      const transaction = await paystack.transaction.initialize({
        email: original.customer.email,
        amount: planTotalPesewas,
        currency: 'GHS',
        reference,
        channels: paymentMethod === 'mobile_money' ? ['mobile_money'] : ['card', 'mobile_money'],
        metadata: {
          type: 'hosting_renewal',
          planType: original.planType,
          tier: original.tier,
          billingCycle: original.billingCycle,
          parentOrderId: String(original._id),
        },
        callback_url: `${FRONTEND_URL}/hosting/order-confirmation`,
        ...(paymentMethod === 'mobile_money' && mobileNumber && { mobile_money: { phone: mobileNumber, provider: network || 'mtn' } })
      });

      if (!transaction.status) {
        return res.status(500).json({ success: false, error: 'Failed to initialize renewal payment' });
      }

      renewalPayload.paystackReference = reference;
      const renewalOrder = await HostingOrder.create(renewalPayload);

      return res.status(200).json({
        success: true,
        data: {
          authorizationUrl: transaction.data.authorization_url,
          accessCode: transaction.data.access_code,
          reference: transaction.data.reference,
          orderId: renewalOrder._id,
          renewalAmount: planTotal,
        }
      });
    }

    // Bank transfer renewal
    const renewalOrder = await HostingOrder.create(renewalPayload);
    return res.status(200).json({
      success: true,
      data: {
        orderId: renewalOrder._id,
        renewalAmount: planTotal,
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrder,
  uploadOrderProof,
  renewOrder,
};
