/*
 * Closing conversations nobody is coming back to (2026-09-10).
 *
 * `lastActivity` was written on every message and read by nothing, so an
 * abandoned chat stayed open forever — cluttering the staff queue and, worse,
 * sitting in the unresolved population that T69 measures first-response time
 * across, dragging that number toward infinity for a conversation nobody ever
 * needed to answer.
 */
const ChatSession = require('../models/ChatSession');
const {
  runChatIdleJob, CLOSING_NOTE,
  BOT_IDLE_MINUTES, LIVE_IDLE_MINUTES, WAITING_ALERT_MINUTES,
} = require('../services/chatIdleJob');

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);
let seq = 0;
const makeSession = (over = {}) => ChatSession.create({
  sessionId: `idle-${Date.now()}-${seq++}`,
  messages: [{ role: 'user', content: 'hello' }],
  ...over,
});

beforeEach(() => ChatSession.deleteMany({}));

describe('chat idle job — closing what is over', () => {
  it('closes a bot-only conversation that went quiet', async () => {
    const s = await makeSession({ lastActivity: minutesAgo(BOT_IDLE_MINUTES + 5) });
    const result = await runChatIdleJob();

    expect(result.botClosed).toBe(1);
    const after = await ChatSession.findById(s._id).lean();
    expect(after.resolved).toBe(true);
    expect(after.resolvedAt).toBeTruthy();
  });

  it('leaves a closing note, so a returning customer sees why it stopped', async () => {
    const s = await makeSession({ lastActivity: minutesAgo(BOT_IDLE_MINUTES + 5) });
    await runChatIdleJob();

    const after = await ChatSession.findById(s._id).lean();
    expect(after.messages.at(-1).content).toBe(CLOSING_NOTE);
    expect(after.messages.at(-1).role).toBe('bot');
  });

  it('does not touch a conversation that is still warm', async () => {
    const s = await makeSession({ lastActivity: minutesAgo(BOT_IDLE_MINUTES - 10) });
    const result = await runChatIdleJob();

    expect(result.botClosed).toBe(0);
    expect((await ChatSession.findById(s._id).lean()).resolved).toBe(false);
  });

  it('gives a conversation a person picked up a longer leash', async () => {
    // Idle past the bot window but inside the live one: an agent may simply be
    // away from the desk mid-task, and resolving it loses their place.
    const s = await makeSession({
      humanRequested: true, humanAccepted: true,
      lastActivity: minutesAgo(BOT_IDLE_MINUTES + 5),
    });
    const result = await runChatIdleJob();

    expect(result.liveClosed).toBe(0);
    expect((await ChatSession.findById(s._id).lean()).resolved).toBe(false);
  });

  it('eventually closes a handled conversation too', async () => {
    await makeSession({
      humanRequested: true, humanAccepted: true,
      lastActivity: minutesAgo(LIVE_IDLE_MINUTES + 5),
    });
    expect((await runChatIdleJob()).liveClosed).toBe(1);
  });

  it('never closes an already-resolved session, so resolvedAt cannot move', async () => {
    const resolvedAt = minutesAgo(500);
    const s = await makeSession({ resolved: true, resolvedAt, lastActivity: minutesAgo(500) });
    await runChatIdleJob();

    const after = await ChatSession.findById(s._id).lean();
    expect(after.resolvedAt.getTime()).toBe(resolvedAt.getTime());
  });
});

describe('chat idle job — the customer still waiting for a human', () => {
  /*
   * The important case. Auto-resolving these would tidy the queue by destroying
   * the evidence: the metric built to catch an unanswered customer would go
   * quiet exactly when it should be loudest, and the person still never got
   * their answer.
   */
  it('does NOT close a customer who asked for a human and never got one', async () => {
    const s = await makeSession({
      humanRequested: true, humanAccepted: false,
      lastActivity: minutesAgo(BOT_IDLE_MINUTES * 10),
    });
    const result = await runChatIdleJob();

    expect(result.botClosed).toBe(0);
    expect(result.liveClosed).toBe(0);
    expect((await ChatSession.findById(s._id).lean()).resolved).toBe(false);
  });

  it('reports them so cron carries it to a person', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await makeSession({
      humanRequested: true, humanAccepted: false,
      lastActivity: minutesAgo(WAITING_ALERT_MINUTES + 5),
    });

    expect((await runChatIdleJob()).waitingUnanswered).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('waiting more than'), 1, WAITING_ALERT_MINUTES
    );
    warn.mockRestore();
  });

  it('does not report one who has only just asked', async () => {
    await makeSession({
      humanRequested: true, humanAccepted: false,
      lastActivity: minutesAgo(WAITING_ALERT_MINUTES - 10),
    });
    expect((await runChatIdleJob()).waitingUnanswered).toBe(0);
  });
});

describe('chat idle job — registration', () => {
  it('is runnable from cron like every other job', () => {
    const { JOBS } = require('../scripts/runJob');
    expect(JOBS['chat-idle']).toBeDefined();
    expect(typeof JOBS['chat-idle'].run).toBe('function');
  });
});
