const { Resend } = require('resend');
const EmailLog = require('../models/EmailLog');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// From-address precedence: RESEND_FROM_EMAIL (.env, what Resend actually accepts)
// → legacy EMAIL_FROM → default.
const FROM = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || 'EazWorld <onboarding@resend.dev>';

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
  if (!resend || !order?.customer?.email) return;
  const subject = `Hosting order received – ${order.planType} ${order.tier}`;
  try {
    await resend.emails.send({ from: FROM, to: [order.customer.email], subject, html: buildOrderConfirmationHtml(order) });
    EmailLog.create({ to: order.customer.email, subject, type: 'order_confirmation', status: 'sent', orderId: order._id }).catch(() => {});
  } catch (err) {
    console.error('[hostingEmail] Order confirmation send failed:', err.message);
    EmailLog.create({ to: order.customer.email, subject, type: 'order_confirmation', status: 'failed', error: err.message, orderId: order._id }).catch(() => {});
  }
}

async function sendPaymentReceived(order) {
  if (!resend || !order?.customer?.email) return;
  const subject = `Payment received – your hosting order`;
  try {
    await resend.emails.send({ from: FROM, to: [order.customer.email], subject, html: buildPaymentReceivedHtml(order) });
    EmailLog.create({ to: order.customer.email, subject, type: 'payment_received', status: 'sent', orderId: order._id }).catch(() => {});
  } catch (err) {
    console.error('[hostingEmail] Payment received send failed:', err.message);
    EmailLog.create({ to: order.customer.email, subject, type: 'payment_received', status: 'failed', error: err.message, orderId: order._id }).catch(() => {});
  }
}

async function sendHostingCredentials(order, { username, password, domain }) {
  if (!resend || !order?.customer?.email) return;
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

  const subject = 'Your EazWorld hosting account is ready';
  try {
    await resend.emails.send({
      from: FROM,
      to: [order.customer.email],
      subject,
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
      `
    });
    EmailLog.create({ to: order.customer.email, subject, type: 'hosting_credentials', status: 'sent', orderId: order._id, meta: { username, domain } }).catch(() => {});
  } catch (err) {
    console.error('[hostingEmail] Credentials send failed:', err.message);
    EmailLog.create({ to: order.customer.email, subject, type: 'hosting_credentials', status: 'failed', error: err.message, orderId: order._id }).catch(() => {});
  }
}

module.exports = {
  sendOrderConfirmation,
  sendPaymentReceived,
  sendHostingCredentials
};
