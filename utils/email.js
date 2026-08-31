const { Resend } = require('resend');
const EmailLog = require('../models/EmailLog');
const { formatGhs } = require('./money');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// From-address precedence: RESEND_FROM_EMAIL (.env, what Resend actually accepts)
// → legacy EMAIL_FROM → default.
const FROM = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || 'EazWorld <noreply@eazworld.com>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@eazworld.com';

async function send({ to, subject, html, type = 'other', orderId = null, meta = {} }) {
  const recipient = Array.isArray(to) ? to[0] : to;
  // Every EmailLog write below is AWAITED. It used to be fire-and-forget, which
  // raced the shutdown in scripts/runJob.js: cron sets process.exitCode and then
  // disconnects mongoose, so an in-flight log write from a renewal reminder could
  // be cut off and the send would leave no record at all. The insert is one round
  // trip and .catch() keeps it unable to throw.
  if (!resend) {
    console.warn('[email] Resend not configured — skipping email to', recipient);
    await EmailLog.create({ to: recipient, subject, type, status: 'failed', error: 'Resend not configured', orderId, meta }).catch(() => {});
    return false;
  }
  try {
    // The Resend SDK RESOLVES with { data: null, error } for every API-level
    // rejection — unverified from-domain, bad API key, rate limit, suppressed
    // recipient — and throws only on a transport failure. Awaiting it without
    // reading `error` therefore logged those as status:'sent', which is how
    // EmailLog filled with successes for mail nobody ever received. Check the
    // result, not just the absence of a throw.
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    });

    if (error) {
      const message = error.message || error.name || 'Resend rejected the message';
      console.error('[email] Rejected by Resend:', message);
      await EmailLog.create({ to: recipient, subject, type, status: 'failed', error: message, orderId, meta }).catch(() => {});
      return false;
    }

    // Keep Resend's id: it is the only handle for looking a message up in their
    // dashboard when a customer says it never arrived.
    await EmailLog.create({
      to: recipient, subject, type, status: 'sent', orderId,
      meta: data?.id ? { ...meta, resendId: data.id } : meta,
    }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    await EmailLog.create({ to: recipient, subject, type, status: 'failed', error: err.message, orderId, meta }).catch(() => {});
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
    type: 'two_factor',
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

/**
 * T45 — tell a customer their pre-ordered item has landed and their order is
 * moving. Sent when staff release the pre-order, not when stock changes, so the
 * customer only ever hears from us once the order is genuinely being filled.
 */
async function sendPreorderReadyEmail(order, items) {
  const BASE = process.env.FRONTEND_URL || 'http://localhost:3000';
  const to = order?.customer?.email;
  // Shop checkout is phone-first in Ghana, so an order may carry no email at all.
  // That is not a failure — there is simply nobody to write to.
  if (!to) return false;

  const lines = (items || [])
    .map((i) => `<li>${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}</li>`)
    .join('');

  return send({
    to,
    type: 'preorder_ready',
    orderId: order._id,
    subject: `Your pre-order has arrived — ${order.orderNumber}`,
    html: `
      <h2>Good news, ${order.customer?.name || 'there'} 👋</h2>
      <p>The item you pre-ordered is now in stock and your order is being prepared.</p>
      <ul>${lines}</ul>
      <p>Order <strong>${order.orderNumber}</strong></p>
      ${order.trackingNumber
        ? `<p>Track it here: <a href="${BASE}/track/order/${order.trackingNumber}">${order.trackingNumber}</a></p>`
        : ''}
      <p>Thank you for waiting.</p>
    `,
    meta: { orderNumber: order.orderNumber, itemCount: (items || []).length },
  });
}

// ─── Shop order emails (T62) ─────────────────────────────────────────────────
// The shop emailed customers nothing at all: pay, close the tab, and the order
// number existed only on the confirmation page. These close that gap. Every send
// rides Resend via `send()` so it lands in EmailLog under its own type, a missing
// customer email returns quietly (shop checkout here is phone-first), and no
// caller ever waits on or fails because of a mail problem.

const SHOP_BASE = () => process.env.FRONTEND_URL || 'http://localhost:3000';

function shopTrackingSection(order) {
  if (!order.trackingNumber) return '';
  const url = `${SHOP_BASE()}/track/order/${order.trackingNumber}`;
  return `
    <p>
      <a href="${url}"
         style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;border-radius:50px;text-decoration:none;font-weight:600;">
        Track your order →
      </a>
    </p>
    <p style="color:#6b7280;font-size:13px;">Tracking number: <strong>${order.trackingNumber}</strong></p>
  `;
}

/**
 * T62 gap #1 — the shop receipt. Sent once, at payment (fulfilShopOrder), with
 * the tracking number and link so the T45 journey is reachable from the inbox.
 * A pre-order line gets its own expectation-setting section instead of silence:
 * the customer now knows why part of the order hasn't shipped and what happens
 * next — and per the T62 decision there are NO further emails until the goods
 * physically reach the shop (that one is sendPreorderReadyEmail).
 */
async function sendShopOrderConfirmationEmail(order, { deliveryZoneName = '', preorderNotes = [] } = {}) {
  const to = order?.customer?.email;
  if (!to) return false; // phone-first checkout — an order may carry no email

  const rows = (order.items || [])
    .map((i) => `
      <tr>
        <td style="padding:6px 0;color:#374151;">${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}${i.isPreorder ? ' <span style="color:#92400e;font-size:12px;">(pre-order)</span>' : ''}</td>
        <td style="padding:6px 0;text-align:right;color:#111827;font-weight:600;">${formatGhs((i.price || 0) * (i.qty || 1))}</td>
      </tr>`)
    .join('');

  const preorderSection = (preorderNotes || []).length
    ? `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px;font-weight:600;color:#1e40af;">📦 About your pre-order</p>
        ${preorderNotes.map((n) => `<p style="margin:4px 0;font-size:14px;color:#1e3a8a;">${n}</p>`).join('')}
        <p style="margin:8px 0 0;font-size:13px;color:#1e40af;">You'll be emailed as soon as it reaches our shop — follow the tracking number to see where things stand anytime.</p>
      </div>`
    : '';

  return send({
    to,
    type: 'order_confirmation',
    orderId: order._id,
    subject: `Order confirmed — ${order.orderNumber}`,
    html: `
      <h2>Thank you for your order, ${order.customer?.name?.split(' ')[0] || 'there'}!</h2>
      <p>Your payment has been confirmed and your order is in.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;">
        <tr><td style="padding:4px 8px 4px 0;color:#6b7280;width:130px;">Order number</td><td style="font-weight:700;">${order.orderNumber}</td></tr>
        ${order.trackingNumber ? `<tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Tracking number</td><td style="font-family:monospace;">${order.trackingNumber}</td></tr>` : ''}
      </table>
      <table style="border-collapse:collapse;width:100%;font-size:14px;border-top:1px solid #e5e7eb;padding-top:8px;">
        ${rows}
        <tr><td style="padding:8px 0 2px;color:#6b7280;">Subtotal</td><td style="text-align:right;">${formatGhs(order.subtotal)}</td></tr>
        <tr><td style="padding:2px 0;color:#6b7280;">Delivery${deliveryZoneName ? ` (${deliveryZoneName})` : ''}</td><td style="text-align:right;">${formatGhs(order.deliveryFee)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700;">Total</td><td style="text-align:right;font-weight:700;">${formatGhs(order.total)}</td></tr>
      </table>
      ${preorderSection}
      ${shopTrackingSection(order)}
      <p style="color:#6b7280;font-size:13px;">Questions? Reply to this email or message us on WhatsApp.</p>
      <p>— The EazWorld Team</p>
    `,
    meta: { orderNumber: order.orderNumber, hasPreorder: (order.items || []).some((i) => i.isPreorder) },
  });
}

/**
 * T62 gap #3 — status moves. Repair jobs already tell the customer every
 * meaningful step (services/notify.js); shop orders never did. Same shape here:
 * a per-status subject/body map, rendered into one email. `paid` and `pending`
 * are deliberately absent — paid IS the confirmation email above, and pending
 * means nothing has happened yet.
 */
const SHOP_STATUS_MESSAGES = {
  processing: {
    subject: (o) => `We're preparing your order — ${o.orderNumber}`,
    headline: 'Order in progress',
    body: 'Your order is being picked and packed.',
  },
  shipped: {
    subject: (o) => `Your order is on its way — ${o.orderNumber}`,
    headline: 'Order shipped',
    body: 'Your order has left our shop and is on its way to you.',
  },
  delivered: {
    subject: (o) => `Your order has been delivered — ${o.orderNumber}`,
    headline: 'Order delivered',
    body: 'Your order has been delivered. Thank you for shopping with us!',
  },
  cancelled: {
    subject: (o) => `Your order has been cancelled — ${o.orderNumber}`,
    headline: 'Order cancelled',
    body: 'Your order has been cancelled. If you paid, any refund will be processed to your original payment method.',
  },
};

async function sendShopStatusEmail(order) {
  const to = order?.customer?.email;
  if (!to) return false;
  const msg = SHOP_STATUS_MESSAGES[order.status];
  if (!msg) return false;

  return send({
    to,
    type: 'shop_status_update',
    orderId: order._id,
    subject: msg.subject(order),
    html: `
      <h2>${msg.headline}</h2>
      <p>Hi ${order.customer?.name?.split(' ')[0] || 'there'},</p>
      <p>${msg.body}</p>
      <p>Order <strong>${order.orderNumber}</strong></p>
      ${shopTrackingSection(order)}
      <p>— The EazWorld Team</p>
    `,
    meta: { orderNumber: order.orderNumber, status: order.status },
  });
}

/**
 * T62 gap #4 — refund word. Hooked inside applyRefundOutcome, so the customer
 * hears the outcome no matter which path learned it first (webhook, manual sync,
 * or the reconcile job). Money-side failures are not hidden from the person they
 * happened to.
 */
async function sendRefundOutcomeEmail(order) {
  const to = order?.customer?.email;
  if (!to) return false;
  const outcome = order.refund?.status;
  if (!['completed', 'failed'].includes(outcome)) return false;

  const completed = outcome === 'completed';
  return send({
    to,
    type: completed ? 'refund_completed' : 'refund_failed',
    orderId: order._id,
    subject: completed
      ? `Your refund is on its way — ${order.orderNumber}`
      : `Issue with your refund — ${order.orderNumber}`,
    html: `
      <h2>${completed ? 'Refund processed' : 'Refund could not be processed'}</h2>
      <p>Hi ${order.customer?.name?.split(' ')[0] || 'there'},</p>
      ${completed
        ? `<p>We've refunded <strong>${formatGhs(order.refund.amount)}</strong> for order <strong>${order.orderNumber}</strong> to your original payment method. Depending on your bank or mobile-money provider, it can take a few days to appear.</p>`
        : `<p>We tried to refund <strong>${formatGhs(order.refund.amount)}</strong> for order <strong>${order.orderNumber}</strong>, but the payment provider declined it. Our team is looking into it and will contact you shortly.</p>`}
      ${order.refund.reason ? `<blockquote style="border-left:3px solid #e5e7eb;padding-left:12px;color:#6b7280;margin:16px 0;">Reason: ${order.refund.reason}</blockquote>` : ''}
      <p>— The EazWorld Team</p>
    `,
    meta: { orderNumber: order.orderNumber, outcome, amountPesewas: order.refund.amount },
  });
}

/**
 * T62 gap #5 — domains used to email nothing: pay for a domain and the only
 * record was a database row. One email at payment covering both outcomes of the
 * registration attempt that follows it: registered (with the years + renewal
 * framing) or handed to the team (registrar hiccups must not leave a paying
 * customer in silence). Expiry warnings are already covered by renewalJob.
 */
async function sendDomainConfirmationEmail(order, { registered }) {
  const to = order?.email;
  if (!to) return false;

  const expiresYear = new Date().getFullYear() + (order.years || 1);
  return send({
    to,
    type: 'domain_confirmation',
    orderId: order._id,
    subject: registered
      ? `${order.domain} is yours 🎉`
      : `We received your domain order — ${order.domain}`,
    html: `
      <h2>${registered ? 'Domain registered!' : 'Domain order received'}</h2>
      <p>Hi ${order.customerName?.split(' ')[0] || 'there'},</p>
      ${registered
        ? `<p><strong>${order.domain}</strong> has been registered for <strong>${order.years || 1} year${(order.years || 1) > 1 ? 's' : ''}</strong>. It's yours until <strong>${expiresYear}</strong> — we'll remind you before it needs renewing.</p>`
        : `<p>We've received your payment for <strong>${order.domain}</strong>. Our team is finishing the registration and will confirm by email shortly — you don't need to do anything.</p>`}
      <p>Paid: <strong>GH₵${order.price}</strong></p>
      <p>— The EazWorld Team</p>
    `,
    meta: { domain: order.domain, registered },
  });
}

/**
 * T62 gap #6 — service orders (web design etc.) only ever triggered the account
 * email; the project itself never said hello. One email at the deposit payment:
 * what was ordered, what was paid, what's left, what happens next.
 */
async function sendServiceConfirmationEmail(order) {
  const to = order?.email;
  if (!to) return false;

  const balance = Math.max(0, (order.totalAmount || 0) - (order.depositAmount || 0));
  // ServiceOrder money is the T44 Group-C exception: major GHS floats, not
  // pesewas — so raw GH₵ interpolation here, never formatGhs.
  const ghs = (v) => `GH₵${Number(v || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return send({
    to,
    type: 'service_confirmation',
    orderId: order._id,
    subject: `We're getting started on your ${order.package} — EazWorld`,
    html: `
      <h2>Thank you — your deposit is confirmed!</h2>
      <p>Hi ${order.name?.split(' ')[0] || 'there'},</p>
      <p>We've received your <strong>${ghs(order.depositAmount)}</strong> deposit for your <strong>${order.package}</strong> project.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;">
        <tr><td style="padding:4px 8px 4px 0;color:#6b7280;width:130px;">Project total</td><td>${ghs(order.totalAmount)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Paid now</td><td>${ghs(order.depositAmount)}</td></tr>
        ${balance > 0 ? `<tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Balance later</td><td>${ghs(balance)}</td></tr>` : ''}
      </table>
      <p>Our team will reach out within <strong>24 hours</strong> to kick things off.</p>
      <p>— The EazWorld Team</p>
    `,
    meta: { package: order.package, depositAmount: order.depositAmount },
  });
}

module.exports = {
  send,
  sendPreorderReadyEmail,
  sendShopOrderConfirmationEmail,
  sendShopStatusEmail,
  sendRefundOutcomeEmail,
  sendDomainConfirmationEmail,
  sendServiceConfirmationEmail,
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
