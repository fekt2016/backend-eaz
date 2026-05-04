const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || 'EazWorld <onboarding@resend.dev>';

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
  try {
    await resend.emails.send({
      from: FROM,
      to: [order.customer.email],
      subject: `Hosting order received – ${order.planType} ${order.tier}`,
      html: buildOrderConfirmationHtml(order)
    });
  } catch (err) {
    console.error('[hostingEmail] Order confirmation send failed:', err.message);
  }
}

async function sendPaymentReceived(order) {
  if (!resend || !order?.customer?.email) return;
  try {
    await resend.emails.send({
      from: FROM,
      to: [order.customer.email],
      subject: `Payment received – your hosting order`,
      html: buildPaymentReceivedHtml(order)
    });
  } catch (err) {
    console.error('[hostingEmail] Payment received send failed:', err.message);
  }
}

async function sendHostingCredentials(order, { username, password, domain }) {
  if (!resend || !order?.customer?.email) return;
  const cpanelUrl = `https://${domain}:2083`;
  const planLabel = `${order.planType} ${order.tier}`;
  try {
    await resend.emails.send({
      from: FROM,
      to: [order.customer.email],
      subject: 'Your EazWorld hosting account is ready',
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
  } catch (err) {
    console.error('[hostingEmail] Credentials send failed:', err.message);
  }
}

module.exports = {
  sendOrderConfirmation,
  sendPaymentReceived,
  sendHostingCredentials
};
