/**
 * Close chat conversations nobody is coming back to.
 *
 * `lastActivity` was written on every message and read by nothing, so a
 * customer who closed the tab left a session open permanently. Two consequences,
 * and the second is the one that mattered:
 *
 *  - The staff queue at /dashboard/chats filled with conversations that were
 *    over, so the real ones got harder to see.
 *  - T69 measures first-response time across unresolved sessions. Every
 *    abandoned chat sat in that population forever, dragging the number staff
 *    are judged on toward infinity for a conversation nobody ever needed to
 *    answer.
 *
 * IDLE IS NOT ONE THING. The three states below get different treatment, because
 * closing them all on the same clock would hide the one failure worth seeing.
 */
const ChatSession = require('../models/ChatSession');

const MINUTES = 60 * 1000;

/*
 * Windows, overridable by env for a shop that finds these wrong in practice.
 *
 * BOT_IDLE is deliberately generous: somebody comparing phone prices may well
 * come back twenty minutes later, and closing under a live customer is worse
 * than leaving a dead chat open a little longer.
 *
 * LIVE_IDLE is longer still — an agent may be away from the desk mid-task, and
 * resolving a conversation out from under them loses their place.
 *
 * WAITING sessions are never closed on a timer at all. See below.
 */
const BOT_IDLE_MINUTES     = Number(process.env.CHAT_BOT_IDLE_MINUTES)     || 60;
const LIVE_IDLE_MINUTES    = Number(process.env.CHAT_LIVE_IDLE_MINUTES)    || 240;
const WAITING_ALERT_MINUTES = Number(process.env.CHAT_WAITING_ALERT_MINUTES) || 30;

const CLOSING_NOTE = 'This conversation was closed automatically after a period of inactivity. Send a message any time to start a new one.';

/**
 * @returns {Promise<{ botClosed: number, liveClosed: number, waitingUnanswered: number }>}
 */
async function runChatIdleJob() {
  const now = Date.now();
  const cutoff = (mins) => new Date(now - mins * MINUTES);

  // ── 1. Bot-only conversations ────────────────────────────────────────────
  // Nobody is waiting on these and no one is measured by them, so they close
  // quietly. `humanRequested: false` keeps anything the customer escalated out
  // of this branch even if it has gone quiet since.
  const botIdle = await ChatSession.find({
    resolved: false,
    humanRequested: false,
    lastActivity: { $lt: cutoff(BOT_IDLE_MINUTES) },
  }).select('_id sessionId').lean();

  // ── 2. Conversations a person picked up, then went quiet ─────────────────
  const liveIdle = await ChatSession.find({
    resolved: false,
    humanRequested: true,
    humanAccepted: true,
    lastActivity: { $lt: cutoff(LIVE_IDLE_MINUTES) },
  }).select('_id sessionId').lean();

  const toClose = [...botIdle, ...liveIdle];
  if (toClose.length) {
    await ChatSession.updateMany(
      { _id: { $in: toClose.map((s) => s._id) } },
      {
        $set: { resolved: true, resolvedAt: new Date() },
        // A visible line, so a customer returning to an old widget sees why the
        // thread stopped rather than a conversation that mysteriously ends.
        $push: { messages: { role: 'bot', content: CLOSING_NOTE, createdAt: new Date() } },
      }
    );
  }

  /*
   * ── 3. Customers who asked for a human and never got one ─────────────────
   *
   * Deliberately NOT closed. Auto-resolving these would tidy the queue by
   * deleting the evidence — the metric that exists to catch an unanswered
   * customer would go quiet precisely when it should be loudest, and the person
   * still never got their answer.
   *
   * Reported instead, so cron's MAILTO carries it to a human.
   */
  const waitingUnanswered = await ChatSession.countDocuments({
    resolved: false,
    humanRequested: true,
    humanAccepted: false,
    lastActivity: { $lt: cutoff(WAITING_ALERT_MINUTES) },
  });

  const result = {
    botClosed: botIdle.length,
    liveClosed: liveIdle.length,
    waitingUnanswered,
  };

  console.log(
    '[chat-idle] closed %d bot-only and %d handled conversations; %d customers still waiting for a human',
    result.botClosed, result.liveClosed, result.waitingUnanswered
  );
  if (waitingUnanswered > 0) {
    console.warn(
      '[chat-idle] ⚠️  %d customer(s) have been waiting more than %d minutes for a human reply — see /dashboard/chats',
      waitingUnanswered, WAITING_ALERT_MINUTES
    );
  }

  return result;
}

module.exports = { runChatIdleJob, CLOSING_NOTE, BOT_IDLE_MINUTES, LIVE_IDLE_MINUTES, WAITING_ALERT_MINUTES };
