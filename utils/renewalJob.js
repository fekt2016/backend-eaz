/**
 * renewalJob.js
 *
 * Handles two things:
 *  1. Sends renewal reminder emails at 30d / 7d / 1d before expiry
 *  2. Suspends cPanel accounts that have expired (status = active, expiresAt < now)
 *
 * Call runRenewalJob() on a schedule — e.g. once per day via a cron/setInterval.
 */

const HostingOrder = require('../models/HostingOrder');
const EmailLog = require('../models/EmailLog');
const { Resend } = require('resend');
const whm = require('../services/whm');
const { LIFECYCLE } = require('../config/hostingPlans');

const DAY_MS = 24 * 60 * 60 * 1000;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || 'EazWorld <onboarding@resend.dev>';
const FRONTEND_URL = require('../utils/frontendUrl')();

// ── Helpers ────────────────────────────────────────────────────────────────────

function daysFromNow(date) {
  return Math.ceil((new Date(date) - Date.now()) / (1000 * 60 * 60 * 24));
}

async function sendRenewalReminder(order, daysLeft) {
  if (!resend || !order?.customer?.email) return;
  const planLabel = `${order.planType} ${order.tier}`;
  const renewUrl = `${FRONTEND_URL}/dashboard/hosting/${order._id}`;
  const urgency = daysLeft <= 1 ? '🚨' : daysLeft <= 7 ? '⚠️' : '📅';
  const subject = `${urgency} Your EazWorld hosting expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

  try {
    await resend.emails.send({
      from: FROM,
      to: [order.customer.email],
      subject,
      html: `
        <h2>${urgency} Hosting renewal reminder</h2>
        <p>Hi ${order.customer?.name || 'there'},</p>
        <p>Your <strong>${planLabel}</strong> hosting plan${order.domain ? ` for <strong>${order.domain}</strong>` : ''} expires in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.</p>
        <p>Renew now to keep your website and hosting active without any interruption.</p>
        <p style="margin:24px 0;">
          <a href="${renewUrl}"
             style="display:inline-block;padding:12px 28px;background:#f59e0b;color:#fff;border-radius:50px;text-decoration:none;font-weight:700;font-size:15px;">
            Renew Hosting →
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px;">If you have already renewed, you can ignore this email.</p>
        <p>— The EazWorld Team</p>
      `
    });
    EmailLog.create({ to: order.customer.email, subject, type: 'renewal_reminder', status: 'sent', orderId: order._id, meta: { daysLeft } }).catch(() => {});
  } catch (err) {
    console.error(`[renewalJob] Reminder email failed for ${order.customer.email}:`, err.message);
    EmailLog.create({ to: order.customer.email, subject, type: 'renewal_reminder', status: 'failed', error: err.message, orderId: order._id }).catch(() => {});
  }
}

async function sendExpiredNotice(order) {
  if (!resend || !order?.customer?.email) return;
  const planLabel = `${order.planType} ${order.tier}`;
  const renewUrl = `${FRONTEND_URL}/dashboard/hosting/${order._id}`;
  const subject = '❌ Your EazWorld hosting has expired';

  try {
    await resend.emails.send({
      from: FROM,
      to: [order.customer.email],
      subject,
      html: `
        <h2>Your hosting has expired</h2>
        <p>Hi ${order.customer?.name || 'there'},</p>
        <p>Your <strong>${planLabel}</strong> hosting plan${order.domain ? ` for <strong>${order.domain}</strong>` : ''} has expired and your account has been suspended.</p>
        <p>Your data is safe — renew within <strong>30 days</strong> to restore your account immediately.</p>
        <p style="margin:24px 0;">
          <a href="${renewUrl}"
             style="display:inline-block;padding:12px 28px;background:#111827;color:#fff;border-radius:50px;text-decoration:none;font-weight:700;font-size:15px;">
            Renew Now →
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px;">Need help? Reply to this email and we will assist you.</p>
        <p>— The EazWorld Team</p>
      `
    });
    EmailLog.create({ to: order.customer.email, subject, type: 'expired_notice', status: 'sent', orderId: order._id }).catch(() => {});
  } catch (err) {
    console.error(`[renewalJob] Expired notice email failed for ${order.customer.email}:`, err.message);
    EmailLog.create({ to: order.customer.email, subject, type: 'expired_notice', status: 'failed', error: err.message, orderId: order._id }).catch(() => {});
  }
}

// ── Main job ───────────────────────────────────────────────────────────────────

async function runRenewalJob() {
  console.log('[renewalJob] Running...');
  const now = new Date();

  try {
    // ── 1. Send renewal reminders for active accounts approaching expiry ────────
    const upcoming = await HostingOrder.find({
      status: 'active',
      expiresAt: { $gt: now, $lt: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000) },
    });

    for (const order of upcoming) {
      const days = daysFromNow(order.expiresAt);

      // 30-day reminder
      if (days <= 30 && days > 7 && order.renewalReminderSent === 'none') {
        await sendRenewalReminder(order, days);
        order.renewalReminderSent = 'sent_30d';
        await order.save({ validateBeforeSave: false }).catch(() => {});
        console.log(`[renewalJob] 30d reminder sent → ${order.customer.email}`);
      }
      // 7-day reminder
      else if (days <= 7 && days > 1 && !['sent_7d', 'sent_1d'].includes(order.renewalReminderSent)) {
        await sendRenewalReminder(order, days);
        order.renewalReminderSent = 'sent_7d';
        await order.save({ validateBeforeSave: false }).catch(() => {});
        console.log(`[renewalJob] 7d reminder sent → ${order.customer.email}`);
      }
      // 1-day reminder
      else if (days <= 1 && order.renewalReminderSent !== 'sent_1d') {
        await sendRenewalReminder(order, days <= 0 ? 1 : days);
        order.renewalReminderSent = 'sent_1d';
        await order.save({ validateBeforeSave: false }).catch(() => {});
        console.log(`[renewalJob] 1d reminder sent → ${order.customer.email}`);
      }
    }

    // ── 2. Suspend accounts past their grace period ─────────────────────────────
    // Accounts stay active during the grace window (still serving the site), then
    // are suspended — never terminated immediately after a missed renewal.
    const suspendCutoff = new Date(now.getTime() - LIFECYCLE.graceDays * DAY_MS);
    const toSuspend = await HostingOrder.find({
      status: 'active',
      expiresAt: { $lt: suspendCutoff },
    });

    let suspended = 0;
    for (const order of toSuspend) {
      console.log(`[renewalJob] Suspending expired account past grace: ${order.cpanelUsername} (${order.customer.email})`);
      if (order.cpanelUsername && whm.hasConfig()) {
        const r = await whm.suspendAccount(order.cpanelUsername, 'Subscription expired');
        if (!r.success) {
          console.error(`[renewalJob] Suspend failed for ${order.cpanelUsername}: ${r.error}`);
          continue; // leave active; retry next run
        }
      }
      order.status = 'suspended';
      order.suspendedAt = now;
      await order.save({ validateBeforeSave: false }).catch(() => {});
      await sendExpiredNotice(order).catch(() => {});
      suspended += 1;
    }

    // ── 3. Terminate accounts suspended beyond the retention window ──────────────
    const terminateCutoff = new Date(now.getTime() - LIFECYCLE.suspendToTerminateDays * DAY_MS);
    const toTerminate = await HostingOrder.find({
      status: 'suspended',
      suspendedAt: { $lt: terminateCutoff },
    });

    let terminated = 0;
    for (const order of toTerminate) {
      console.log(`[renewalJob] Terminating long-suspended account: ${order.cpanelUsername} (${order.customer.email})`);
      if (order.cpanelUsername && whm.hasConfig()) {
        const r = await whm.terminateAccount(order.cpanelUsername);
        if (!r.success) {
          console.error(`[renewalJob] Terminate failed for ${order.cpanelUsername}: ${r.error}`);
          continue; // retry next run
        }
      }
      order.status = 'terminated';
      order.terminatedAt = now;
      await order.save({ validateBeforeSave: false }).catch(() => {});
      await sendTerminatedNotice(order).catch(() => {});
      terminated += 1;
    }

    console.log(`[renewalJob] Done — ${upcoming.length} reminders checked, ${suspended} suspended, ${terminated} terminated`);
  } catch (err) {
    console.error('[renewalJob] Error:', err.message);
  }
}

async function sendTerminatedNotice(order) {
  if (!resend || !order?.customer?.email) return;
  const planLabel = `${order.planType} ${order.tier}`;
  const subject = '⛔ Your EazWorld hosting account has been terminated';

  try {
    await resend.emails.send({
      from: FROM,
      to: [order.customer.email],
      subject,
      html: `
        <h2>Your hosting account has been terminated</h2>
        <p>Hi ${order.customer?.name || 'there'},</p>
        <p>Your <strong>${planLabel}</strong> hosting plan${order.domain ? ` for <strong>${order.domain}</strong>` : ''} was suspended for more than ${LIFECYCLE.suspendToTerminateDays} days and has now been terminated. Associated data has been removed.</p>
        <p>If you would like to host with us again, you are welcome to place a new order at any time.</p>
        <p>— The EazWorld Team</p>
      `
    });
    EmailLog.create({ to: order.customer.email, subject, type: 'terminated_notice', status: 'sent', orderId: order._id }).catch(() => {});
  } catch (err) {
    console.error(`[renewalJob] Terminated notice email failed for ${order.customer.email}:`, err.message);
    EmailLog.create({ to: order.customer.email, subject, type: 'terminated_notice', status: 'failed', error: err.message, orderId: order._id }).catch(() => {});
  }
}

module.exports = { runRenewalJob };
