// T13: AI chat responses via Claude, with a graceful fallback to the existing
// rule-based engine whenever ANTHROPIC_API_KEY is unset or the API call fails.
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const request = require('supertest');
const app = require('../app');
const ChatSession = require('../models/ChatSession');

function aiTextResponse(text) {
  return { content: [{ type: 'text', text }] };
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe('POST /api/v1/chat — AI response (T13)', () => {
  it('falls back to the rule-based engine when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await request(app)
      .post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body.data.response).toMatch(/Eazy/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('uses the AI response when configured and the call succeeds', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate.mockResolvedValueOnce(aiTextResponse('Our logo packages start at GHS 500.'));

    const res = await request(app)
      .post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'how much is a logo?' });

    expect(res.status).toBe(200);
    expect(res.body.data.response).toBe('Our logo packages start at GHS 500.');
    expect(res.body.data.suggestions).toEqual([]);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
    }));
  });

  it('falls back to the rule-based engine when the AI call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate.mockRejectedValueOnce(new Error('rate limited'));

    const res = await request(app)
      .post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body.data.response).toMatch(/Eazy/);
  });

  it('grounds the system prompt in business-profile services (no hallucinated pricing)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate.mockResolvedValueOnce(aiTextResponse('We offer web design starting from GHS 1,500.'));

    await request(app)
      .post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'what do you charge for a website?' });

    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toMatch(/Web Design & Development/);
    expect(call.system).toMatch(/never invent a price/i);
  });

  it('maps stored bot/admin history to the assistant role and keeps the last message as user', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const sessionId = `s-${Date.now()}`;
    await ChatSession.create({
      sessionId,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'bot', content: 'Hi there!' },
        { role: 'admin', content: 'An agent joined the chat.' },
      ],
    });
    mockCreate.mockResolvedValueOnce(aiTextResponse('Sure, happy to help.'));

    await request(app)
      .post('/api/v1/chat')
      .send({ sessionId, message: 'can you help me?' });

    const sentMessages = mockCreate.mock.calls[0][0].messages;
    expect(sentMessages.at(-1)).toEqual({ role: 'user', content: 'can you help me?' });
    expect(sentMessages.some((m) => m.role === 'assistant')).toBe(true);
    expect(sentMessages.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
  });

  it('truncates history to the last 12 messages sent to the API', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const sessionId = `s-${Date.now()}`;
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'bot', content: `msg ${i}` });
    }
    await ChatSession.create({ sessionId, messages });
    mockCreate.mockResolvedValueOnce(aiTextResponse('ok'));

    await request(app)
      .post('/api/v1/chat')
      .send({ sessionId, message: 'the newest message' });

    const sentMessages = mockCreate.mock.calls[0][0].messages;
    expect(sentMessages.length).toBeLessThanOrEqual(12);
    expect(sentMessages.at(-1)).toEqual({ role: 'user', content: 'the newest message' });
  });

  it('never calls the AI once a human agent has taken over the session', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const sessionId = `s-${Date.now()}`;
    await ChatSession.create({ sessionId, messages: [], humanRequested: true });

    const res = await request(app)
      .post('/api/v1/chat')
      .send({ sessionId, message: 'still there?' });

    expect(res.status).toBe(200);
    expect(res.body.data.humanRequested).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/chat — AI budget and effort (2026-09-10)', () => {
  // Sonnet 5 thinks adaptively when `thinking` is omitted, and thinking tokens
  // count against max_tokens. At 500 a reply could reason itself past the ceiling
  // and return no text — silently demoting every answer to the rule-based engine.
  it('leaves room for adaptive thinking plus a reply', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate.mockResolvedValueOnce(aiTextResponse('Logos start at GHS 500.'));

    await request(app)
      .post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'logo price?' });

    expect(mockCreate.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(2000);
  });

  // A 2-4 sentence chat bubble is the workload that repays high effort least,
  // and high is what you get by omitting this.
  it('asks for low effort — a chat bubble is not a reasoning task', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate.mockResolvedValueOnce(aiTextResponse('Sure.'));

    await request(app)
      .post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'hi' });

    expect(mockCreate.mock.calls[0][0].output_config).toEqual({ effort: 'low' });
  });

  it('falls back, and says why, when the model returns no text at all', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // What a max_tokens truncation actually looks like: a 200, no text block.
    mockCreate.mockResolvedValueOnce({ content: [], stop_reason: 'max_tokens' });

    const res = await request(app)
      .post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body.data.response).toMatch(/Eazy/); // rule-based engine answered
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AI returned no text'),
      'max_tokens'
    );
    warn.mockRestore();
  });
});

describe('POST /api/v1/chat — tool use (2026-09-10)', () => {
  const toolUse = (name, input) => ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'tu_1', name, input }],
  });

  it('sends the tool definitions with every request', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate.mockResolvedValueOnce(aiTextResponse('Hello!'));

    await request(app).post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'hi' });

    const names = mockCreate.mock.calls[0][0].tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_products', 'build_cart', 'track_order']));
  });

  it('runs the tool and feeds the result back for a second turn', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate
      .mockResolvedValueOnce(toolUse('search_products', { query: 'tecno' }))
      .mockResolvedValueOnce(aiTextResponse('We have the Tecno Spark at GH₵1,650.00.'));

    const res = await request(app).post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'any tecno phones?' });

    expect(res.body.data.response).toMatch(/Tecno Spark/);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // The second request must replay the assistant turn verbatim and answer it
    // with tool_result blocks — the API pairs them by tool_use_id, so a
    // reconstructed or text-only copy breaks the exchange.
    const second = mockCreate.mock.calls[1][0].messages;
    const results = second[second.length - 1];
    expect(results.role).toBe('user');
    expect(results.content[0].type).toBe('tool_result');
    expect(results.content[0].tool_use_id).toBe('tu_1');
  });

  it('stops after the tool-round ceiling instead of looping on the account', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A model that only ever asks for another tool call.
    mockCreate.mockResolvedValue(toolUse('search_products', { query: 'x' }));

    const res = await request(app).post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'loop please' });

    expect(res.status).toBe(200);
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(6);
    // The model never produced text, so the rule-based engine answered — the
    // same graceful degradation as an API failure. Its hallmark is the
    // suggestion chips, which the model never returns.
    expect(res.body.data.suggestions.length).toBeGreaterThan(0);
    expect(res.body.data.response).toBeTruthy();
    warn.mockRestore();
    mockCreate.mockReset();
  });

  it('puts the admin knowledge base into the system prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const Settings = require('../models/Settings');
    await Settings.findOneAndUpdate(
      { key: 'global' },
      { $set: { 'business.knowledge': 'Warranty on every repair is 30 days.' } },
      { upsert: true }
    );
    require('../utils/businessProfile').clearBusinessProfileCache();
    mockCreate.mockResolvedValueOnce(aiTextResponse('30 days.'));

    await request(app).post('/api/v1/chat')
      .send({ sessionId: `s-${Date.now()}`, message: 'warranty?' });

    expect(mockCreate.mock.calls[0][0].system).toMatch(/Warranty on every repair is 30 days/);
  });
});
