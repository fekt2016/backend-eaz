const { Resend } = require('resend');
const EmailLog = require('../models/EmailLog');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM = process.env.EMAIL_FROM || 'EazWorld <noreply@eazworld.com>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@eazworld.com';

async function send({ to, subject, html, type = 'other', orderId = null, meta = {} }) {
  const recipient = Array.isArray(to) ? to[0] : to;
  if (!resend) {
    console.warn('[email] Resend not configured — skipping email to', recipient);
    EmailLog.create({ to: recipient, subject, type, status: 'failed', error: 'Resend not configured', orderId, meta }).catch(() => {});
    return;
  }
  try {
    await resend.emails.send({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html });
    EmailLog.create({ to: recipient, subject, type, status: 'sent', orderId, meta }).catch(() => {});
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    EmailLog.create({ to: recipient, subject, type, status: 'failed', error: err.message, orderId, meta }).catch(() => {});
  }
}

// ─── Auth emails ────────────────────────────────────────

async function sendWelcomeEmail(user) {
  await send({
    to: user.email,
    type: 'welcome',
    subject: 'Welcome to EazWorld 👋',
    html: `
      <h2>Welcome to EazWorld, ${user.name}!</h2>
      <p>Thanks for creating an account. You can now order hosting plans, register domains, and track your orders from your dashboard.</p>
      <p>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard"
           style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;border-radius:50px;text-decoration:none;font-weight:600;">
          Go to Dashboard →
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If you didn't create this account, you can ignore this email.</p>
      <p>— The EazWorld Team</p>
    `,
  });
}

async function sendPasswordResetEmail(user, resetUrl) {
  await send({
    to: user.email,
    type: 'password_reset',
    subject: 'EazWorld — Reset your password',
    html: `
      <h2>Password reset request</h2>
      <p>Hi ${user.name},</p>
      <p>We received a request to reset your EazWorld password. Click the button below to choose a new one.</p>
      <p>
        <a href="${resetUrl}"
           style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;border-radius:50px;text-decoration:none;font-weight:600;">
          Reset Password →
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">This link expires in <strong>10 minutes</strong>. If you didn't request a password reset, ignore this email — your password won't change.</p>
      <p>— The EazWorld Team</p>
    `,
  });
}

// ─── Contact form emails ─────────────────────────────────

async function sendContactAdminNotification(contact) {
  await send({
    to: ADMIN_EMAIL,
    type: 'contact_admin',
    subject: `New contact form submission — ${contact.name}`,
    html: `
      <h2>New Contact Form Submission</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:8px;color:#6b7280;width:120px;">Name</td><td style="padding:8px;">${contact.name}</td></tr>
        <tr><td style="padding:8px;color:#6b7280;">Email</td><td style="padding:8px;"><a href="mailto:${contact.email}">${contact.email}</a></td></tr>
        ${contact.phone ? `<tr><td style="padding:8px;color:#6b7280;">Phone</td><td style="padding:8px;">${contact.phone}</td></tr>` : ''}
        ${contact.subject ? `<tr><td style="padding:8px;color:#6b7280;">Subject</td><td style="padding:8px;">${contact.subject}</td></tr>` : ''}
        <tr><td style="padding:8px;color:#6b7280;vertical-align:top;">Message</td><td style="padding:8px;">${contact.message}</td></tr>
      </table>
      <p style="color:#6b7280;font-size:12px;">Submitted at ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Accra' })} (Accra time)</p>
    `,
  });
}

async function sendContactAutoReply(contact) {
  await send({
    to: contact.email,
    type: 'contact_autoreply',
    subject: 'We received your message — EazWorld',
    html: `
      <h2>Thanks for reaching out, ${contact.name}!</h2>
      <p>We've received your message and will get back to you within <strong>1 business day</strong>.</p>
      ${contact.message ? `<blockquote style="border-left:3px solid #e5e7eb;padding-left:12px;color:#6b7280;margin:16px 0;">${contact.message}</blockquote>` : ''}
      <p>In the meantime, feel free to browse our services or book a free consultation.</p>
      <p>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/book-consultation"
           style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;border-radius:50px;text-decoration:none;font-weight:600;">
          Book a Free Consultation →
        </a>
      </p>
      <p>— The EazWorld Team</p>
    `,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendContactAdminNotification,
  sendContactAutoReply,
};
