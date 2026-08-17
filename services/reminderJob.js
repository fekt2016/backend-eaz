/**
 * EazWorld Repair Shop — Uncollected Device Reminder Job
 *
 * Runs on a schedule. Finds jobs that are "ready" but haven't been
 * collected after REMIND_AFTER_DAYS, and sends an SMS reminder via Hubtel.
 *
 * Config (via .env):
 *   REMINDER_AFTER_DAYS   — days after "ready" before first reminder (default: 3)
 *   REMINDER_INTERVAL_DAYS— days between subsequent reminders (default: 3)
 *   REMINDER_MAX          — max reminders per job before giving up (default: 3)
 */

const RepairJob = require('../models/RepairJob');
const { notifyReminder } = require('./notify');
const logger = require("../utils/logger");

const REMIND_AFTER_DAYS    = parseInt(process.env.REMINDER_AFTER_DAYS    || '3',  10);
const REMIND_INTERVAL_DAYS = parseInt(process.env.REMINDER_INTERVAL_DAYS || '3',  10);
const REMINDER_MAX         = parseInt(process.env.REMINDER_MAX           || '3',  10);
const SHOP_NAME  = process.env.SHOP_NAME  || 'EazWorld Repair';
const SHOP_PHONE = process.env.SHOP_PHONE || '0244388190';
const FRONTEND_URL = require('../utils/frontendUrl')();

// ── Helpers ───────────────────────────────────────────────────────────────────

function _daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function _toHubtelNumber(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return digits;
  if (digits.startsWith('0')   && digits.length === 10)  return `233${digits.slice(1)}`;
  if (digits.length === 9)                               return `233${digits}`;
  return null;
}

function _message(job, count) {
  const device = [job.deviceBrand, job.deviceModel].filter(Boolean).join(' ') || 'device';
  const trackUrl = job.trackingToken ? ` Track: ${FRONTEND_URL}/track/${job.trackingToken}` : '';
  if (count === 1) {
    return `Reminder: Your ${device} (Job #${job.jobNumber}) is ready for collection! Please visit us or call ${SHOP_PHONE}.${trackUrl} – ${SHOP_NAME}`;
  }
  return `2nd Reminder: Your ${device} (Job #${job.jobNumber}) is still waiting for collection. Please contact us at ${SHOP_PHONE}.${trackUrl} – ${SHOP_NAME}`;
}

async function _sendSms(to, content) {
  const clientId     = process.env.HUBTEL_CLIENT_ID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET;
  const from         = process.env.HUBTEL_SENDER_ID || SHOP_NAME;
  if (!clientId || !clientSecret) return false;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://smsc.hubtel.com/v1/messages/send', {
    method:  'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hubtel ${res.status}: ${text}`);
  }
  return true;
}

// ── Main job ──────────────────────────────────────────────────────────────────

async function runReminderJob() {
  const now = new Date();
  logger.info(`[reminders] Running at ${now.toISOString()}`);

  try {
    // Jobs that are "ready", haven't been collected, and haven't hit the max reminder count
    const cutoff = _daysAgo(REMIND_AFTER_DAYS);

    const jobs = await RepairJob.find({
      status:        'ready',
      remindersSent: { $lt: REMINDER_MAX },
      $or: [
        // Never reminded & been ready long enough
        { lastReminderAt: { $exists: false }, updatedAt: { $lte: cutoff } },
        // Already reminded but interval has passed
        { lastReminderAt: { $lte: _daysAgo(REMIND_INTERVAL_DAYS) } },
      ],
    })
      .populate('customer', 'name phone email')
      .select('jobNumber deviceBrand deviceModel status customer remindersSent lastReminderAt trackingToken');

    if (!jobs.length) {
      logger.info('[reminders] No jobs need reminders right now.');
      return;
    }

    logger.info(`[reminders] Found ${jobs.length} job(s) to remind.`);

    for (const job of jobs) {
      const count   = job.remindersSent + 1;
      const content = _message(job, count);

      // Email first (Resend) — only fall back to SMS when the customer has no email.
      const emailed = await notifyReminder(job, count);
      if (!emailed) {
        const phone = job.customer?.phone;
        if (!phone) {
          logger.warn(`[reminders] Job ${job.jobNumber} — no customer phone, skipping.`);
          continue;
        }

        const to = _toHubtelNumber(phone);
        if (!to) {
          logger.warn(`[reminders] Job ${job.jobNumber} — could not parse phone ${phone}, skipping.`);
          continue;
        }

        // Dev mode: just log
        if (!process.env.HUBTEL_CLIENT_ID || !process.env.HUBTEL_CLIENT_SECRET) {
          if (process.env.NODE_ENV !== 'production') {
            logger.info(`[reminders] (Hubtel not configured) Would SMS ${to}: ${content}`);
          }
        } else {
          try {
            await _sendSms(to, content);
            logger.info(`[reminders] SMS sent to ${to} for job ${job.jobNumber} (reminder #${count})`);
          } catch (err) {
            logger.error(`[reminders] SMS failed for job ${job.jobNumber}:`, err.message);
            continue; // don't update counter if SMS failed
          }
        }
      }

      // Mark reminder sent
      job.remindersSent  = count;
      job.lastReminderAt = new Date();
      await job.save();
    }

    logger.info('[reminders] Done.');
  } catch (err) {
    logger.error('[reminders] Job error:', err.message);
  }
}

module.exports = { runReminderJob };
