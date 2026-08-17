const namecheap = require('../services/namecheap');
const User = require('../models/User');
const logger = require('./logger');

/**
 * Register a paid domain order with Namecheap and link it to the buyer's account.
 * Used by the admin "retry registration" action for orders that were paid but
 * whose registration failed (status 'completed' with a registrationError). Mirrors
 * the registration + account-linking the payment webhook performs on first payment.
 *
 * Mutates and saves `order` (registrationError set on failure, cleared on success).
 * Returns { success: boolean, error?: string, skipped?: boolean }.
 */
async function registerDomainOrder(order) {
  if (!namecheap.hasConfig()) {
    return { success: false, skipped: true, error: 'Namecheap is not configured on the server.' };
  }
  if (!order.registrantInfo) {
    return { success: false, error: 'This order has no registrant information to register with.' };
  }

  const reg = order.registrantInfo;
  const nameParts = (order.customerName || '').split(' ');

  const regResult = await namecheap.registerDomain(order.domain, order.years || 1, {
    firstName:  reg.firstName || nameParts[0] || '',
    lastName:   reg.lastName || nameParts.slice(1).join(' ') || '',
    email:      order.email,
    phone:      order.phone || '',
    address:    reg.address || '',
    city:       reg.city || '',
    country:    reg.country || 'GH',
    postalCode: reg.postalCode || '00233',
  });

  if (!regResult.success) {
    order.registrationError = regResult.error;
    await order.save({ validateBeforeSave: false }).catch(() => {});
    logger.error(`[domain] Registration failed for order ${order._id}: ${regResult.error}`);
    return { success: false, error: regResult.error };
  }

  // Success — clear any prior error, then link the domain to the buyer's account.
  order.registrationError = null;
  await order.save({ validateBeforeSave: false }).catch(() => {});
  await linkDomainToUser(order);
  logger.info(`[domain] Registered ${order.domain} for order ${order._id}`);
  return { success: true };
}

// Push the domain onto the user's account (idempotent — skips if already linked).
async function linkDomainToUser(order) {
  if (!order.user) return;
  try {
    const years = order.years || 1;
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    const alreadyLinked = await User.exists({
      _id: order.user,
      'domains.orderId': order._id,
    });
    if (!alreadyLinked) {
      await User.findByIdAndUpdate(order.user, {
        $push: {
          domains: {
            domain: order.domain,
            orderId: order._id,
            years,
            registeredAt: new Date(),
            expiresAt,
            status: 'active',
          },
        },
      });
    }
  } catch (err) {
    logger.error(`[domain] Failed to link domain to user for order ${order._id}: ${err.message}`);
  }
}

module.exports = { registerDomainOrder };
