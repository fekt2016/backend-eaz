const whm = require('../services/whm');
const { sendHostingCredentials } = require('./hostingEmail');

/**
 * Provision a cPanel account for a paid hosting order.
 * Updates the order in-place and saves it.
 * Only runs for shared/wordpress/email plan types — VPS/cloud are manual.
 *
 * @param {import('../models/HostingOrder')} order - Mongoose document
 */
async function provisionHostingAccount(order) {
  const autoProvisionTypes = ['shared', 'wordpress', 'email'];
  if (!autoProvisionTypes.includes(order.planType)) {
    order.provisioningStatus = 'skipped';
    await order.save({ validateBeforeSave: false }).catch(() => {});
    return;
  }

  if (!whm.hasConfig()) {
    order.provisioningStatus = 'failed';
    order.provisioningError = 'WHM not configured on server';
    await order.save({ validateBeforeSave: false }).catch(() => {});
    return;
  }

  const username = whm.generateUsername(order.customer.email);
  const password = whm.generatePassword();
  const domain = order.domain || `${username}.eazworld.com`;

  const result = await whm.createAccount({
    username,
    domain,
    password,
    email: order.customer.email,
    planType: order.planType,
    tier: order.tier,
  });

  if (result.success) {
    order.cpanelUsername = username;
    order.provisioningStatus = 'provisioned';
    order.provisionedAt = new Date();
    order.status = 'active';
    await order.save({ validateBeforeSave: false }).catch(() => {});
    sendHostingCredentials(order, { username, password, domain }).catch(() => {});
  } else {
    order.provisioningStatus = 'failed';
    order.provisioningError = result.error;
    await order.save({ validateBeforeSave: false }).catch(() => {});
  }
}

module.exports = { provisionHostingAccount };
