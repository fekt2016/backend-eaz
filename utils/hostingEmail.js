// Sends through the shared sender in utils/email.js rather than holding its own
// Resend client. Three copies of that client existed (here, email.js and
// renewalJob.js), each repeating the same mistake of treating a resolved promise
// as a delivered message, and each carrying its own default from-address — this
// file's disagreed with email.js's. One sender, one from-address, one place where
// the { data, error } result is actually checked.
const { send } = require('./email');

function buildOrderConfirmationHtml(order) {
  const planLabel = `${order.planType} ${order.tier}`;
  const billingLabel = order.billingCycle === 'annual' ? 'Annual' : 'Monthly';
  const paymentLabel = order.paymentMethod === 'paystack_card' ? 'Card' : order.paymentMethod === 'mobile_money' ? 'Mobile Money' : 'Bank transfer';
  return `
    <h2>Hosting order received</h2>
    <p>Hi ${order.customer?.name || 'there'},</p>
    <p>We've received your hosting order.</p>
    <ul>
      <li><strong>Plan:</strong> ${planLabel} (${billingLabel})</li>
      <li><strong>Amount:</strong> GH₵ ${order.amount}</li>
      <li><strong>Payment method:</strong> ${paymentLabel}</li>
    </ul>
    ${order.paymentMethod === 'bank_transfer' ? '<p>Please complete your bank transfer and upload proof of payment from your order page to speed up verification.</p>' : ''}
    <p>You can view your order anytime from your dashboard.</p>
    <p>— EazWorld</p>
  `;
}

function buildPaymentReceivedHtml(order) {
  const planLabel = `${order.planType} ${order.tier}`;
  return `
    <h2>Payment received – hosting order</h2>
    <p>Hi ${order.customer?.name || 'there'},</p>
    <p>We've confirmed your payment for your hosting order (${planLabel}).</p>
    <p>Your hosting account will be activated shortly. We'll send you login and setup details in a follow-up email.</p>
    <p>— EazWorld</p>
  `;
}

async function sendOrderConfirmation(order) {
  if (!order?.customer?.email) return;
  return send({
    to: order.customer.email,
    subject: `Hosting order received – ${order.planType} ${order.tier}`,
    html: buildOrderConfirmationHtml(order),
    type: 'order_confirmation',
    orderId: order._id,
  });
}

async function sendPaymentReceived(order) {
  if (!order?.customer?.email) return;
  return send({
    to: order.customer.email,
    subject: 'Payment received – your hosting order',
    html: buildPaymentReceivedHtml(order),
    type: 'payment_received',
    orderId: order._id,
  });
}

async function sendHostingCredentials(order, { username, password, domain }) {
  if (!order?.customer?.email) return;
  const cpanelUrl = process.env.CPANEL_URL || `https://${domain}:2083`;
  const planLabel = `${order.planType} ${order.tier}`;
  const ns1 = process.env.NAMESERVER_1 || 'ns1.eazworld.co';
  const ns2 = process.env.NAMESERVER_2 || 'ns2.eazworld.co';

  // A temp domain looks like "username.eazworld.com" — if the customer provided
  // their own domain, show nameserver setup instructions.
  const isTempDomain = domain.endsWith('.eazworld.com') && domain.split('.').length === 3;
  const nameserverSection = isTempDomain ? '' : `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;margin:24px 0;">
      <p style="margin:0 0 8px;font-weight:600;color:#92400e;">📡 Point your domain to EazWorld</p>
      <p style="margin:0 0 12px;font-size:13px;color:#78350f;">
        Log in to your domain registrar and update your nameservers to the following:
      </p>
      <table style="border-collapse:collapse;font-size:14px;width:100%;">
        <tr>
          <td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;">Nameserver 1</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#111827;">${ns1}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;">Nameserver 2</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#111827;">${ns2}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0;font-size:12px;color:#92400e;">
        DNS changes can take up to 24–48 hours to propagate worldwide. Your cPanel is already active — you can log in now using the server URL above.
      </p>
    </div>
  `;

  return send({
    to: order.customer.email,
    subject: 'Your EazWorld hosting account is ready',
    type: 'hosting_credentials',
    orderId: order._id,
    meta: { username, domain },
    html: `
        <h2>Your hosting account is active!</h2>
        <p>Hi ${order.customer?.name || 'there'},</p>
        <p>Your <strong>${planLabel}</strong> hosting account has been set up. Here are your login details:</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;">
          <tr><td style="padding:8px;color:#6b7280;width:140px;">cPanel URL</td><td style="padding:8px;"><a href="${cpanelUrl}">${cpanelUrl}</a></td></tr>
          <tr><td style="padding:8px;color:#6b7280;">Username</td><td style="padding:8px;"><strong>${username}</strong></td></tr>
          <tr><td style="padding:8px;color:#6b7280;">Password</td><td style="padding:8px;"><strong>${password}</strong></td></tr>
          <tr><td style="padding:8px;color:#6b7280;">Primary domain</td><td style="padding:8px;">${domain}</td></tr>
        </table>
        <p style="color:#dc2626;font-size:13px;"><strong>Important:</strong> Please log in and change your password immediately.</p>
        ${nameserverSection}
        <p>
          <a href="${cpanelUrl}"
             style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;border-radius:50px;text-decoration:none;font-weight:600;">
            Log in to cPanel →
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px;">Need help? Reply to this email and our support team will assist you.</p>
        <p>— The EazWorld Team</p>
      `,
  });
}

module.exports = {
  sendOrderConfirmation,
  sendPaymentReceived,
  sendHostingCredentials
};
