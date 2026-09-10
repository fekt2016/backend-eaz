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
