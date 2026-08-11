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
    return false;
  }
  try {
    await resend.emails.send({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html });
    EmailLog.create({ to: recipient, subject, type, status: 'sent', orderId, meta }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    EmailLog.create({ to: recipient, subject, type, status: 'failed', error: err.message, orderId, meta }).catch(() => {});
    return false;
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

// ─── Consultation booking emails ─────────────────────────

async function sendConsultationConfirmation(contact) {
  const BASE = process.env.FRONTEND_URL || 'http://localhost:3000';
  const service = contact.service || contact.subject?.replace('Consultation: ', '') || 'your project';

  await send({
    to: contact.email,
    type: 'contact_autoreply',
    subject: `Consultation Request Received — EazWorld`,
    html: `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:580px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">

      <!-- Header -->
      <div style="background:#111827;padding:32px 40px;text-align:center;">
        <p style="margin:0 0 8px 0;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#f59e0b;">EazWorld</p>
        <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;line-height:1.3;">
          You're Booked In! 🎉
        </h1>
      </div>

      <!-- Body -->
      <div style="padding:36px 40px;">
        <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi <strong>${contact.name.split(' ')[0]}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7;">
          We've received your consultation request for <strong style="color:#111827;">${service}</strong>.
          We'll get back to you within <strong>24 hours</strong> with 2–3 available time slots.
        </p>

        <!-- Service tag -->
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:28px;display:inline-block;">
          <p style="margin:0;font-size:13px;color:#92400e;font-weight:600;">🎯 Service requested: ${service}</p>
        </div>

        <!-- What happens next -->
        <p style="margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">What happens next</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
          ${[
            ['01', 'Check your email', 'We\'ll reply within 24 hours with available time slots.'],
            ['02', 'Pick a time', 'Choose a slot that works best for you.'],
            ['03', '30-minute call', 'We talk about your goals — honest advice, no sales pitch.'],
            ['04', 'Leave with a plan', 'Clear next steps, timeline and honest cost estimate.'],
          ].map(([n, title, desc]) => `
            <tr>
              <td style="width:36px;vertical-align:top;padding:8px 12px 8px 0;">
                <div style="width:28px;height:28px;border-radius:50%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#9ca3af;text-align:center;line-height:28px;">${n}</div>
              </td>
              <td style="padding:8px 0;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#111827;">${title}</p>
                <p style="margin:0;font-size:13px;color:#6b7280;">${desc}</p>
              </td>
            </tr>
          `).join('')}
        </table>

        <!-- CTA button -->
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${BASE}/book-consultation"
             style="display:inline-block;padding:14px 32px;background:#111827;color:#ffffff;border-radius:50px;text-decoration:none;font-size:14px;font-weight:700;">
            View Your Booking →
          </a>
        </div>

        <!-- WhatsApp note -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin-bottom:8px;">
          <p style="margin:0;font-size:13px;color:#166534;">
            💬 <strong>Prefer WhatsApp?</strong> Message us directly at
            <a href="https://wa.me/233244388190" style="color:#15803d;font-weight:600;">+233 24 438 8190</a>
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">EazWorld · Nima, Accra, Ghana</p>
        <p style="margin:0;font-size:12px;color:#9ca3af;">
          <a href="mailto:info@eazworld.co" style="color:#9ca3af;">info@eazworld.co</a> ·
          <a href="tel:+233244388190" style="color:#9ca3af;">+233 24 438 8190</a>
        </p>
      </div>

    </div>
    `,
    meta: { contactId: contact._id },
  });
}

async function sendConsultationAdminAlert(contact) {
  const BASE = process.env.FRONTEND_URL || 'http://localhost:3000';
  const service = contact.service || contact.subject?.replace('Consultation: ', '') || 'N/A';

  await send({
    to: ADMIN_EMAIL,
    type: 'contact_admin',
    subject: `🗓 New Consultation Booking — ${contact.name} (${service})`,
    html: `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:580px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">

      <!-- Header -->
      <div style="background:#111827;padding:24px 32px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#f59e0b;">EazWorld Admin</p>
        <h2 style="margin:0;font-size:20px;font-weight:800;color:#ffffff;">New Consultation Booking</h2>
      </div>

      <!-- Details table -->
      <div style="padding:28px 32px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 12px 10px 0;color:#6b7280;width:110px;font-weight:500;">Name</td>
            <td style="padding:10px 0;color:#111827;font-weight:600;">${contact.name}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 12px 10px 0;color:#6b7280;font-weight:500;">Email</td>
            <td style="padding:10px 0;"><a href="mailto:${contact.email}" style="color:#f59e0b;font-weight:600;">${contact.email}</a></td>
          </tr>
          ${contact.phone ? `
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 12px 10px 0;color:#6b7280;font-weight:500;">Phone</td>
            <td style="padding:10px 0;color:#111827;">
              <a href="tel:${contact.phone}" style="color:#111827;">${contact.phone}</a> &nbsp;
              <a href="https://wa.me/${contact.phone.replace(/\D/g,'')}" style="color:#16a34a;font-size:12px;font-weight:600;">WhatsApp →</a>
            </td>
          </tr>` : ''}
          ${contact.businessName ? `
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 12px 10px 0;color:#6b7280;font-weight:500;">Business</td>
            <td style="padding:10px 0;color:#111827;">${contact.businessName}</td>
          </tr>` : ''}
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 12px 10px 0;color:#6b7280;font-weight:500;">Service</td>
            <td style="padding:10px 0;">
              <span style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:3px 10px;font-size:13px;font-weight:600;color:#92400e;">${service}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 12px 10px 0;color:#6b7280;font-weight:500;vertical-align:top;">Message</td>
            <td style="padding:10px 0;color:#374151;line-height:1.6;">${contact.message || '—'}</td>
          </tr>
        </table>

        <!-- Action buttons -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="mailto:${contact.email}?subject=Re: Consultation Request - ${encodeURIComponent(service)}"
             style="display:inline-block;padding:11px 22px;background:#f59e0b;color:#111827;border-radius:50px;text-decoration:none;font-size:13px;font-weight:700;">
            ✉️ Reply by Email
          </a>
          ${contact.phone ? `
          <a href="https://wa.me/${contact.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi ${contact.name.split(' ')[0]}, thanks for booking a consultation with EazWorld! I'll send you 2–3 available time slots shortly.`)}"
             style="display:inline-block;padding:11px 22px;background:#16a34a;color:#ffffff;border-radius:50px;text-decoration:none;font-size:13px;font-weight:700;">
            💬 WhatsApp Client
          </a>` : ''}
          <a href="${BASE}/dashboard/admin/consultations"
             style="display:inline-block;padding:11px 22px;background:#111827;color:#ffffff;border-radius:50px;text-decoration:none;font-size:13px;font-weight:700;">
            View in Dashboard →
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Submitted ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · EazWorld Admin</p>
      </div>

    </div>
    `,
    meta: { contactId: contact._id },
  });
}

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

async function sendTwoFactorPin(user, pin) {
  await send({
    to: user.email,
    type: 'other',
    subject: 'EazWorld — Your login verification code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#111827;">Two-factor authentication code</h2>
        <p>Hi ${user.name},</p>
        <p>Use this code to complete your login:</p>
        <div style="margin:32px 0;text-align:center;">
          <div style="display:inline-block;background:#f9fafb;border:2px solid #e5e7eb;border-radius:16px;padding:20px 40px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#111827;font-family:monospace;">${pin}</span>
          </div>
        </div>
        <p style="color:#6b7280;font-size:13px;">This code expires in <strong>10 minutes</strong>. If you did not try to log in, please change your password immediately.</p>
        <p>— The EazWorld Team</p>
      </div>
    `,
  });
}

async function sendVerificationPin(user, pin) {
  await send({
    to: user.email,
    type: 'welcome',
    subject: 'EazWorld — Your verification code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#111827;">Verify your email address</h2>
        <p>Hi ${user.name},</p>
        <p>Thanks for creating an EazWorld account. Enter the 6-digit code below to verify your email:</p>
        <div style="margin:32px 0;text-align:center;">
          <div style="display:inline-block;background:#f9fafb;border:2px solid #e5e7eb;border-radius:16px;padding:20px 40px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#111827;font-family:monospace;">${pin}</span>
          </div>
        </div>
        <p style="color:#6b7280;font-size:13px;">This code expires in <strong>15 minutes</strong>. If you didn't create an account, you can safely ignore this email.</p>
        <p>— The EazWorld Team</p>
      </div>
    `,
    meta: { pin: '***' },
  });
}

async function sendAccountCreatedEmail(user, password) {
  await send({
    to: user.email,
    type: 'account_created',
    subject: 'Your EazWorld account has been created 🎉',
    html: `
      <h2>Welcome to EazWorld, ${user.name}!</h2>
      <p>An account has been automatically created for you so you can track your order and manage future purchases.</p>
      <table style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;width:100%">
        <tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Email</td><td style="font-weight:600;">${user.email}</td></tr>
        <tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Password</td><td style="font-weight:600;font-family:monospace;">${password}</td></tr>
      </table>
      <p>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/login"
           style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#111827;border-radius:50px;text-decoration:none;font-weight:700;">
          Log In to Your Dashboard →
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">We recommend changing your password after logging in.</p>
      <p>— The EazWorld Team</p>
    `,
  });
}

module.exports = {
  send,
  sendWelcomeEmail,
  sendAccountCreatedEmail,
  sendPasswordResetEmail,
  sendContactAdminNotification,
  sendContactAutoReply,
  sendConsultationConfirmation,
  sendConsultationAdminAlert,
  sendVerificationPin,
  sendTwoFactorPin,
};
