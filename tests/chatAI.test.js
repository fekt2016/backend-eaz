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
      max_tokens: 500,
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
