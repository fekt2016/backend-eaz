/**
 * EazWorld Repair Shop — Customer Notification Service
 *
 * Sends SMS to customers when their repair job status changes.
 * Uses Hubtel SMS API. Falls back silently if Hubtel is not configured
 * — never crashes the main flow.
 *
 * Required env vars:
 *   HUBTEL_CLIENT_ID     — from Hubtel developer dashboard
 *   HUBTEL_CLIENT_SECRET — from Hubtel developer dashboard
 *   HUBTEL_SENDER_ID     — your registered sender name/number (e.g. EazWorld)
 *
 * Optional:
 *   NOTIFY_CHANNEL       — currently only 'sms' supported via Hubtel (default: sms)
 */

const SHOP_NAME    = process.env.SHOP_NAME    || 'EazWorld Repair';
const SHOP_PHONE   = process.env.SHOP_PHONE   || '0244388190';
const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://www.eazworld.co').replace(/\/$/, '');

// ── Status messages — keep under 160 chars for a single SMS segment ──────────
const STATUS_MESSAGES = {
  received: (job) =>
    `Hi! We've received your ${_device(job)} for repair. Job #${job.jobNumber}. Track your repair: ${FRONTEND_URL}/track/${job.trackingToken} – ${SHOP_NAME}`,

  diagnosing: (job) =>
    `Update on Job #${job.jobNumber}: We're now diagnosing your ${_device(job)}. We'll be in touch soon. – ${SHOP_NAME}`,

  waiting_for_parts: (job) =>
    `Update on Job #${job.jobNumber}: We're waiting for parts for your ${_device(job)}. We'll notify you when repair begins. – ${SHOP_NAME}`,

  repairing: (job) =>
    `Great news! We've started repairing your ${_device(job)} (Job #${job.jobNumber}). – ${SHOP_NAME}`,

  ready: (job) =>
    `Your ${_device(job)} is READY for collection! Job #${job.jobNumber}. Please visit us or call ${SHOP_PHONE}. – ${SHOP_NAME}`,

  collected: (job) =>
    `Thank you for choosing ${SHOP_NAME}! Your ${_device(job)} has been collected. We hope to see you again.`,

  cancelled: (job) =>
    `Job #${job.jobNumber} for your ${_device(job)} has been cancelled. Contact us at ${SHOP_PHONE} if you have questions. – ${SHOP_NAME}`,
};

// Statuses that trigger a notification
const NOTIFY_ON = ['received', 'diagnosing', 'waiting_for_parts', 'repairing', 'ready', 'collected', 'cancelled'];

// ── Email content (Resend) — mirrors the SMS messages, with the track link ───
const EMAIL_MESSAGES = {
  received: (job, url) => ({
    subject:  `We've received your ${_device(job)} for repair — ${SHOP_NAME}`,
    headline: 'Device received',
    body: `Your ${_device(job)} is safely with us. Job #${job.jobNumber}. We'll diagnose it and keep you posted — track the progress anytime with the button below.`,
  }),
  diagnosing: (job, url) => ({
    subject:  `Update: diagnosing your ${_device(job)} — ${SHOP_NAME}`,
    headline: 'Diagnosing your device',
    body: `We're now diagnosing your ${_device(job)} (Job #${job.jobNumber}). We'll be in touch soon with our findings.`,
  }),
  waiting_for_parts: (job, url) => ({
    subject:  `Waiting for parts — ${_device(job)} (Job #${job.jobNumber})`,
    headline: 'Waiting for parts',
    body: `We're waiting for parts for your ${_device(job)}. You can order the parts for this repair online now — tap the button below and pay securely with card or mobile money.`,
  }),
  repairing: (job, url) => ({
    subject:  `Repair started — your ${_device(job)}`,
    headline: 'Repair in progress',
    body: `Great news! We've started repairing your ${_device(job)} (Job #${job.jobNumber}).`,
  }),
  ready: (job, url) => ({
    subject:  `Your ${_device(job)} is READY — ${SHOP_NAME}`,
    headline: 'Ready for collection',
    body: `Your ${_device(job)} is READY for collection! Job #${job.jobNumber}. Please visit us or call ${SHOP_PHONE}.`,
  }),
  collected: (job, url) => ({
    subject:  `Device collected — thank you, ${SHOP_NAME}`,
    headline: 'Device collected',
    body: `Thank you for choosing ${SHOP_NAME}! Your ${_device(job)} has been collected. We hope to see you again.`,
  }),
  cancelled: (job, url) => ({
    subject:  `Job #${job.jobNumber} cancelled — ${SHOP_NAME}`,
    headline: 'Job cancelled',
    body: `Job #${job.jobNumber} for your ${_device(job)} has been cancelled. Contact us at ${SHOP_PHONE} if you have questions.`,
  }),
};

function _wa(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
}

function _renderRepairEmail({ headline, body, trackUrl, job }) {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:580px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:28px 40px;text-align:center;">
        <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#f59e0b;">EazWorld Repair</p>
        <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">${headline}</h1>
      </div>
      <div style="padding:32px 40px;">
        <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Job <strong style="color:#111827;">#${job.jobNumber}</strong> · ${_device(job)}</p>
        <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">${body}</p>
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${trackUrl}" style="display:inline-block;padding:14px 32px;background:#111827;color:#ffffff;border-radius:50px;text-decoration:none;font-size:14px;font-weight:700;">
            Track Your Repair →
          </a>
        </div>
      </div>
      <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">
          Questions? Call <a href="tel:${SHOP_PHONE}" style="color:#9ca3af;">${SHOP_PHONE}</a> or
          WhatsApp <a href="https://wa.me/${_wa(SHOP_PHONE)}" style="color:#9ca3af;">+233 ${SHOP_PHONE}</a>
        </p>
        <p style="margin:0;font-size:12px;color:#9ca3af;">EazWorld · Nima, Accra, Ghana</p>
      </div>
    </div>
  `;
}

async function notifyByEmail(job, newStatus, email) {
  const config = EMAIL_MESSAGES[newStatus];
  if (!config) return false;

  const { send } = require('../utils/email');
  const trackUrl = `${FRONTEND_URL}/track/${job.trackingToken}`;
  const { subject, headline, body } = config(job, trackUrl);

  return send({
    to: email,
    type: `repair_${newStatus}`,
    subject,
    html: _renderRepairEmail({ headline, body, trackUrl, job }),
    meta: { jobId: String(job._id), jobNumber: job.jobNumber },
  });
}

/**
 * Uncollected-device reminder — email first (Resend), falls back to SMS.
 * Returns true when an email was sent, false otherwise (caller falls back to SMS).
 * @param {Object} job   — RepairJob document (.customer must include name/phone/email)
 * @param {number} count — which reminder this is (1st, 2nd, …)
 */
async function notifyReminder(job, count) {
  const email = job.customer?.email;
  if (!email) return false;

  const trackUrl = `${FRONTEND_URL}/track/${job.trackingToken}`;
  const headline = count === 1 ? 'Ready for collection' : 'Still waiting for you';
  const body = count === 1
    ? `Your ${_device(job)} is ready for collection! Job #${job.jobNumber}. Please visit us or call ${SHOP_PHONE}.`
    : `Your ${_device(job)} (Job #${job.jobNumber}) is still waiting for collection. Please contact us at ${SHOP_PHONE}.`;

  try {
    const { send } = require('../utils/email');
    return await send({
      to: email,
      type: 'repair_reminder',
      subject: `${headline} — ${_device(job)} (Job #${job.jobNumber})`,
      html: _renderRepairEmail({ headline, body, trackUrl, job }),
      meta: { jobId: String(job._id), jobNumber: job.jobNumber, reminderCount: count },
    });
  } catch (err) {
    console.error(`[notify] Reminder email failed for job ${job.jobNumber}:`, err.message);
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _device(job) {
  return [job.deviceBrand, job.deviceModel].filter(Boolean).join(' ') || 'device';
}

/**
 * Convert a Ghanaian phone number to Hubtel's expected format: 233XXXXXXXXX
 */
function _toHubtelNumber(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return digits;
  if (digits.startsWith('0')   && digits.length === 10)  return `233${digits.slice(1)}`;
  if (digits.length === 9)                               return `233${digits}`;
  // strip leading + if present
  if (digits.startsWith('233')) return digits;
  return null;
}

// ── Hubtel SMS sender ─────────────────────────────────────────────────────────

/**
 * Send a single SMS via Hubtel's v1 API.
 * @param {string} to      — recipient in 233XXXXXXXXX format
 * @param {string} content — message body
 */
async function _sendHubtelSms(to, content) {
  const clientId     = process.env.HUBTEL_CLIENT_ID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET;
  const from         = process.env.HUBTEL_SENDER_ID || SHOP_NAME;

  if (!clientId || !clientSecret) return false;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const url = 'https://smsc.hubtel.com/v1/messages/send';

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from, to, content }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hubtel ${res.status}: ${text}`);
  }

  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a status-change notification to the customer.
 * Email goes via Resend when the customer has an email on file; otherwise
 * SMS via Hubtel to the phone number. One channel, not both.
 * @param {Object} job       — RepairJob document (.customer must be populated with name/phone/email)
 * @param {string} newStatus — the new status value
 */
async function notifyCustomer(job, newStatus) {
  if (!NOTIFY_ON.includes(newStatus)) return;

  // Email (Resend) is the primary channel — used whenever we have an address.
  // If it fails to send, fall through to SMS so the customer is never missed.
  const email = job.customer?.email;
  if (email) {
    try {
      const sent = await notifyByEmail(job, newStatus, email);
      if (sent) return;
    } catch (err) {
      console.error(`[notify] Email failed for job ${job.jobNumber}:`, err.message);
    }
  }

  // SMS (Hubtel) — fallback for phone-only customers.
  const msgFn = STATUS_MESSAGES[newStatus];
  if (!msgFn) return;

  const phone = job.customer?.phone;
  if (!phone) return;

  const to = _toHubtelNumber(phone);
  if (!to) {
    console.warn(`[notify] Could not normalise phone number: ${phone}`);
    return;
  }

  const content = msgFn(job);

  // If Hubtel not configured — log in dev, silent in prod
  if (!process.env.HUBTEL_CLIENT_ID || !process.env.HUBTEL_CLIENT_SECRET) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[notify] (Hubtel not configured) Would SMS ${to}: ${content}`);
    }
    return;
  }

  try {
    await _sendHubtelSms(to, content);
    console.log(`[notify] SMS sent to ${to} — status: ${newStatus}`);
  } catch (err) {
    // Never crash the main flow — just log
    console.error(`[notify] Failed to send SMS to ${to}:`, err.message);
  }
}

module.exports = { notifyCustomer, notifyReminder };
