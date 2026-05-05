const cyberpanel = require('../services/cyberpanel');
const { sendHostingCredentials } = require('./hostingEmail');

async function provisionHostingAccount(order) {
  const autoProvisionTypes = ['shared', 'wordpress', 'email'];

  if (!autoProvisionTypes.includes(order.planType)) {
    order.provisioningStatus = 'skipped';
    await order.save({ validateBeforeSave: false }).catch(() => {});
    return;
  }

  if (!cyberpanel.hasConfig()) {
    order.provisioningStatus = 'failed';
    order.provisioningError = 'CyberPanel not configured on server';
    await order.save({ validateBeforeSave: false }).catch(() => {});
    return;
  }

  const result = await cyberpanel.createAccount({
    email: order.customer.email,
    domain: order.domain || null,
    planType: order.planType,
    tier: order.tier,
  });

  if (result.success) {
    order.cpanelUsername = result.username;
    order.provisioningStatus = 'provisioned';
    order.provisionedAt = new Date();
    order.status = 'active';
    await order.save({ validateBeforeSave: false }).catch(() => {});
    sendHostingCredentials(order, {
      username: result.username,
      password: result.password,
      domain: result.domain,
    }).catch(() => {});
  } else {
    order.provisioningStatus = 'failed';
    order.provisioningError = result.error;
    await order.save({ validateBeforeSave: false }).catch(() => {});
  }
}

module.exports = { provisionHostingAccount };
