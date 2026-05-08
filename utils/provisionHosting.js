const whm = require('../services/whm');
const HostingOrder = require('../models/HostingOrder');
const DomainOrder = require('../models/DomainOrder');
const { sendHostingCredentials } = require('./hostingEmail');
const { registerDomain, setEazWorldNameservers } = require('../services/namecheap');

async function provisionHostingAccount(orderRef) {
  const doc = await HostingOrder.findById(orderRef?._id || orderRef);
  if (!doc) return;

  const autoProvisionTypes = ['shared', 'wordpress'];

  // Idempotency: if already provisioned/active with a cPanel username, do nothing.
  if (doc.status === 'active' && doc.cpanelUsername) return;
  if (doc.provisioningStatus === 'provisioned' && doc.cpanelUsername) return;

  // Prevent rapid duplicate provisioning attempts (e.g., double admin click / repeated webhook).
  // If a provisioning attempt started recently, assume it's still running.
  const now = Date.now();
  const startedAtMs = doc.provisioningStartedAt ? new Date(doc.provisioningStartedAt).getTime() : 0;
  if (doc.provisioningStatus === 'pending' && startedAtMs && now - startedAtMs < 10 * 60 * 1000) {
    return;
  }

  if (!autoProvisionTypes.includes(doc.planType)) {
    doc.provisioningStatus = 'skipped';
    await doc.save({ validateBeforeSave: false }).catch(() => {});
    return;
  }

  if (!whm.hasConfig()) {
    doc.provisioningStatus = 'failed';
    doc.provisioningError = 'WHM not configured on server';
    await doc.save({ validateBeforeSave: false }).catch(() => {});
    return;
  }

  doc.provisioningStatus = 'pending';
  doc.provisioningStartedAt = new Date();
  doc.provisioningError = null;
  await doc.save({ validateBeforeSave: false }).catch(() => {});

  const username = whm.generateUsername(doc.customer.email);
  const password = whm.generatePassword();
  const domain = doc.domain || `${username}.eazworld.com`;

  const result = await whm.createAccount({
    username,
    domain,
    password,
    email: doc.customer.email,
    planType: doc.planType,
    tier: doc.tier,
  });

  if (result.success) {
    doc.cpanelUsername = username;
    doc.provisioningStatus = 'provisioned';
    doc.provisionedAt = new Date();
    doc.status = 'active';

    // Set expiry: 1 month or 1 year from now based on billing cycle
    const expiresAt = new Date();
    if (doc.billingCycle === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }
    doc.expiresAt = expiresAt;
    await doc.save({ validateBeforeSave: false }).catch(() => {});
    sendHostingCredentials(doc, { username, password, domain }).catch(() => {});

    // Trigger AutoSSL immediately so the customer's domain gets HTTPS
    // right away rather than waiting for WHM's nightly cron.
    // Non-fatal if it fails — WHM AutoSSL will pick it up within 24hrs.
    whm.runAutoSSL(username)
      .then((r) => {
        if (r.success) console.log(`[provision] AutoSSL triggered for ${username}`);
        else console.warn(`[provision] AutoSSL will run on next WHM cron for ${username}: ${r.error}`);
      })
      .catch(() => {});

    const isTempDomain = !doc.domain || (doc.domain.endsWith('.eazworld.com') && doc.domain.split('.').length === 3);

    // Case 1: Customer chose "Register new domain" in hosting checkout
    // → Register the domain via Namecheap AND automatically set EazWorld nameservers
    if (doc.domainMode === 'new' && doc.domain && !doc.domainRegistered && !isTempDomain) {
      console.log(`[provision] Registering domain ${doc.domain} bundled with hosting order`);
      const regResult = await registerDomain(
        doc.domain,
        doc.domainRegistrationYears || 1,
        {
          firstName: doc.customer.name?.split(' ')[0] || '',
          lastName: doc.customer.name?.split(' ').slice(1).join(' ') || '',
          email: doc.customer.email,
          phone: doc.customer.phone || '',
        },
        { useEazWorldNameservers: true } // ← auto-sets ns1/ns2.eazworld.com
      );

      if (regResult.success) {
        doc.domainRegistered = true;
        console.log(`[provision] Domain ${doc.domain} registered + nameservers set ✅`);
      } else {
        doc.domainRegistrationError = regResult.error;
        console.warn(`[provision] Domain registration failed for ${doc.domain}: ${regResult.error}`);
      }
      await doc.save({ validateBeforeSave: false }).catch(() => {});
    }

    // Case 2: Customer brought their own domain and it was previously registered
    // through EazWorld (exists in DomainOrder as completed) → auto-update nameservers
    else if (!isTempDomain && doc.domain && doc.domainMode !== 'new') {
      const existingDomainOrder = await DomainOrder.findOne({
        domain: doc.domain.toLowerCase().trim(),
        status: 'completed',
      }).catch(() => null);

      if (existingDomainOrder) {
        setEazWorldNameservers(doc.domain)
          .then((r) => {
            if (r.success) console.log(`[provision] Nameservers auto-updated for ${doc.domain} ✅`);
            else console.warn(`[provision] Nameserver update skipped for ${doc.domain}: ${r.error}`);
          })
          .catch(() => {});
      }
    }
  } else {
    doc.provisioningStatus = 'failed';
    doc.provisioningError = result.error;
    await doc.save({ validateBeforeSave: false }).catch(() => {});
  }
}

module.exports = { provisionHostingAccount };
