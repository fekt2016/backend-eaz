// The rule-based engine is not a legacy leftover — it answers EVERY chat when
// ANTHROPIC_API_KEY is unset, invalid, rate-limited, or the API is down. It ran
// unnoticed for a long time behind a key that 401'd, so its gaps were customer-
// facing the whole time.
//
// The key is deleted per-test so these exercise the engine directly, never the
// live API.
const request = require('supertest');
const app = require('../app');

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

async function ask(message) {
  const res = await request(app)
    .post('/api/v1/chat')
    .send({ sessionId: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, message });
  expect(res.status).toBe(200);
  return res.body.data.response;
}

const FALLBACK = /not quite sure/i;

describe('Chat rule engine — plural forms (2026-09-10)', () => {
  /*
   * Every one of these fell through to "I'm not quite sure about that".
   *
   * The cause was the same in each: an optional group before \b. `web(site)?\b`
   * cannot match "websites" — it consumes "website" and then needs a word
   * boundary before the "s", and backtracking to bare "web" leaves "sites".
   * So the single likeliest question a web agency is asked got the shrug.
   */
  it.each([
    ['Do you build websites?',              /web design/i],
    ['Do you build websites for restaurants?', /web design/i],
    ['What are your packages?',             /pricing/i],
    ['Can you help with google rankings?',  /seo/i],
    ['Do you design logos?',                /branding/i],
    ['Do you register domains?',            /hosting|domain/i],
    ['Show me your portfolios',             /saiisai|project/i],
  ])('%s is answered, not shrugged at', async (question, expected) => {
    const reply = await ask(question);
    expect(reply).not.toMatch(FALLBACK);
    expect(reply).toMatch(expected);
  });
});

describe('Chat rule engine — the shop', () => {
  // There was no shop rule at all, so half the business answered "I'm not quite
  // sure" — on a site with a live product catalogue and order tracking.
  it.each([
    'Do you sell laptops?',
    'Do you have chargers in stock?',
    'Can I buy earbuds?',
  ])('%s reaches the shop', async (question) => {
    const reply = await ask(question);
    expect(reply).not.toMatch(FALLBACK);
    expect(reply).toMatch(/shop/i);
  });
});

describe('Chat rule engine — intent ordering', () => {
  // The rules are evaluated in order and the first match wins, so adding one can
  // silently steal traffic from another. These are the two collisions that
  // matter: both new-shop words and old service words appear in these questions.
  it('sends "online stores" to web design, not the shop', async () => {
    expect(await ask('Do you build online stores?')).toMatch(/web design/i);
  });

  it.each([
    'I need my phone screen fixed',
    'Can you fix phones?',
    'My screen is broken',
  ])('%s reaches repair, and is not sold an accessory', async (question) => {
    const reply = await ask(question);
    expect(reply).toMatch(/repair/i);
    expect(reply).not.toMatch(/online shop/i);
  });
});

describe('Chat rule engine — the fallback still exists', () => {
  // The catch-all is correct behaviour for a genuinely unknown question; the bug
  // was how much reached it. It must keep handing off to a human.
  it('offers a human for something genuinely off-topic', async () => {
    const reply = await ask('What is the capital of Mongolia?');
    expect(reply).toMatch(FALLBACK);
    expect(reply).toMatch(/whatsapp|consultation|email/i);
  });
});

describe('Chat — a volunteered credential never reaches the transcript', () => {
  // The assistant is told not to ask for a password, and it obeys. But a
  // customer who types one anyway would otherwise have it stored in plaintext
  // in ChatSession and read by every admin and staff member at
  // /dashboard/chats, where transcripts are retained for the quality metrics.
  // The model refusing to ASK is not the same as a customer refusing to TELL.
  const ChatSession = require('../models/ChatSession');

  it('stores [redacted] instead of the password the customer typed', async () => {
    const sessionId = `redact-${Date.now()}`;
    await request(app).post('/api/v1/chat')
      .send({ sessionId, message: 'my password will be Hunter2Pass!' });

    const saved = await ChatSession.findOne({ sessionId }).lean();
    const text = saved.messages.map((m) => m.content).join(' ');
    expect(text).not.toContain('Hunter2Pass');
    expect(text).toMatch(/\[redacted\]/);
  });

  it.each([
    ['my pin is 4821', '4821'],
    ['pwd=letmein123', 'letmein123'],
    ['the otp is 993211', '993211'],
  ])('redacts %s', async (message, secret) => {
    const sessionId = `redact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await request(app).post('/api/v1/chat').send({ sessionId, message });

    const saved = await ChatSession.findOne({ sessionId }).lean();
    expect(saved.messages.map((m) => m.content).join(' ')).not.toContain(secret);
  });

  // Over-redaction would quietly gut the transcripts the metrics read from, and
  // "I forgot my password" is a thing people genuinely need help with.
  it.each([
    'I forgot my password',
    'what is the wifi password',
    'can you reset my password for me',
  ])('leaves %s alone', async (message) => {
    const sessionId = `keep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await request(app).post('/api/v1/chat').send({ sessionId, message });

    const saved = await ChatSession.findOne({ sessionId }).lean();
    expect(saved.messages.some((m) => m.content === message)).toBe(true);
  });
});
