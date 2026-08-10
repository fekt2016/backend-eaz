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
 * @param {Object} job       — RepairJob document (.customer must be populated with phone)
 * @param {string} newStatus — the new status value
 */
async function notifyCustomer(job, newStatus) {
  if (!NOTIFY_ON.includes(newStatus)) return;

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

module.exports = { notifyCustomer };
