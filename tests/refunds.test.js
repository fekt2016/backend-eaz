// T15 — shop-order refunds via Paystack. paystack.refund.create/fetch are
// mocked (webhook delivery and refund settlement were never live-verified —
// see tasks.md T3b/T15); the refund.create()/fetch() request shapes
// themselves were separately live-verified against the real sandbox (see
// tasks.md T15 write-up), not re-proven here.
const mockRefundCreate = jest.fn();
const mockRefundFetch = jest.fn();

jest.mock('@paystack/paystack-sdk', () => {
  return class Paystack {
    constructor() {}
    get refund() {
      return { create: mockRefundCreate, fetch: mockRefundFetch };
    }
  };
});

const crypto = require('crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const Order = require('../models/Order');
const Product = require("../models/Product");
const User = require('../models/User');
const { runRefundReconcileJob } = require('../services/refundReconcileJob');

async function makeUser(role = 'admin') {
  const user = await User.create({
    name: role,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: 'Password123!',
    role,
    isVerified: true,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

function orderData(over = {}) {
  return {
    orderNumber: `EZW-T15-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
    items: [{ name: 'Phone case', price: 5000, qty: 1 }],
    subtotal: 5000,
    total: 5000,
    customer: { name: 'Kofi', phone: '0240000001' },
    status: 'paid',
    paystackReference: `REF_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...over,
  };
}

function paystackSignature(payload) {
  const secret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
  return crypto.createHmac('sha512', secret).update(JSON.stringify(payload)).digest('hex');
}

function sendWebhook(payload) {
  return request(app)
    .post('/api/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', paystackSignature(payload))
    .send(payload);
}

describe('POST /api/v1/orders/:id/refund — eligibility', () => {
  it('rejects an order with no paystackReference', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData({ paystackReference: undefined }));
    const res = await request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it('rejects a pending (unpaid) order', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData({ status: 'pending' }));
    const res = await request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('rejects an already-cancelled order', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData({ status: 'cancelled' }));
    const res = await request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('rejects staff (admin only, staff excluded)', async () => {
    const { token } = await makeUser('staff');
    const order = await Order.create(orderData());
    const res = await request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/orders/:id/refund — atomic double-submission guard', () => {
  it('two simultaneous refund requests: exactly one succeeds, one 409s', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData());
    mockRefundCreate.mockImplementation(async () => ({ status: true, data: { id: 999 } }));

    const [a, b] = await Promise.all([
      request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({}),
      request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({}),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(mockRefundCreate).toHaveBeenCalledTimes(1); // Paystack only ever contacted once
  });
});

describe('POST /api/v1/orders/:id/refund — happy path', () => {
  it('cancels the order, restocks (T2), and records refund.processing with the Paystack reference', async () => {
    const part = await Product.create({ name: 'Screen', category: 'Screen', partCategory: 'Screen', stock: 5, costPrice: 1000, price: 2000, useInRepairs: true});
    const { token } = await makeUser();
    const order = await Order.create(orderData({
      items: [{ part: part._id, name: 'Screen', price: 2000, qty: 2 }],
      subtotal: 4000, total: 4000,
      stockDeducted: true,
    }));
    mockRefundCreate.mockResolvedValueOnce({ status: true, data: { id: 18021724, status: 'pending' } });

    const res = await request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({ reason: 'Customer changed mind' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(res.body.data.refund.status).toBe('processing');
    expect(res.body.data.refund.reference).toBe('18021724');
    expect(res.body.data.refund.amount).toBe(4000);
    expect(res.body.data.stockRestored).toBe(true);
    expect(mockRefundCreate).toHaveBeenCalledWith(expect.objectContaining({
      transaction: order.paystackReference, amount: 4000, currency: 'GHS',
    }));

    const freshPart = await Product.findById(part._id);
    expect(freshPart.stock).toBe(7); // 5 + 2 restored
  });

  it('marks refund.failed (not processing) when Paystack rejects the request outright', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData());
    mockRefundCreate.mockResolvedValueOnce({ status: false, message: 'Transaction already refunded' });

    const res = await request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(502);
    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe('failed');
    expect(fresh.status).not.toBe('cancelled'); // fulfilment untouched on a confirmed rejection
  });

  it('leaves refund.processing (ambiguous, not failed) when the Paystack call throws', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData());
    mockRefundCreate.mockRejectedValueOnce(new Error('socket hang up'));

    const res = await request(app).post(`/api/v1/orders/${order._id}/refund`).set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(202);
    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe('processing'); // not "failed" — we don't know what happened
    expect(fresh.refund.reference).toBeNull(); // never confirmed, so nothing to reconcile against yet
  });
});

describe('Paystack webhook — refund.processed / refund.failed', () => {
  it('completes a processing refund on refund.processed', async () => {
    const order = await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'processing', amount: 5000, reference: '18021724', requestedAt: new Date() },
    }));

    const res = await sendWebhook({ event: 'refund.processed', data: { id: 18021724, status: 'processed' } });
    expect(res.status).toBe(200);

    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe('completed');
    expect(fresh.refund.completedAt).toBeTruthy();
  });

  it('fails a processing refund on refund.failed', async () => {
    const order = await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'processing', amount: 5000, reference: '18021725', requestedAt: new Date() },
    }));

    const res = await sendWebhook({ event: 'refund.failed', data: { id: 18021725, status: 'failed' } });
    expect(res.status).toBe(200);

    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe('failed');
  });

  it('is idempotent — a duplicate refund.processed does not error or change an already-settled refund', async () => {
    const order = await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'completed', amount: 5000, reference: '18021726', requestedAt: new Date(), completedAt: new Date() },
    }));

    const res = await sendWebhook({ event: 'refund.processed', data: { id: 18021726, status: 'processed' } });
    expect(res.status).toBe(200);
    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe('completed');
  });

  it('acks (200) without erroring for a refund event with no matching order', async () => {
    const res = await sendWebhook({ event: 'refund.processed', data: { id: 999999999 } });
    expect(res.status).toBe(200);
  });

  it('rejects a bad signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'not-the-real-signature')
      .send({ event: 'refund.processed', data: { id: 1 } });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/orders/:id/refund/sync — manual reconciliation', () => {
  it('resolves a processing refund by asking Paystack directly', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'processing', amount: 5000, reference: '18021727', requestedAt: new Date() },
    }));
    mockRefundFetch.mockResolvedValueOnce({ status: true, data: { id: 18021727, status: 'processed' } });

    const res = await request(app).post(`/api/v1/orders/${order._id}/refund/sync`).set('Authorization', `Bearer ${token}`).send();

    expect(res.status).toBe(200);
    expect(res.body.data.refund.status).toBe('completed');
    expect(mockRefundFetch).toHaveBeenCalledWith({ id: '18021727' });
  });

  it('leaves refund.processing when Paystack still reports pending', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'processing', amount: 5000, reference: '18021728', requestedAt: new Date() },
    }));
    mockRefundFetch.mockResolvedValueOnce({ status: true, data: { id: 18021728, status: 'pending' } });

    const res = await request(app).post(`/api/v1/orders/${order._id}/refund/sync`).set('Authorization', `Bearer ${token}`).send();

    expect(res.status).toBe(200);
    expect(res.body.data.refund.status).toBe('processing');
  });

  it('400s when there is no refund reference to check', async () => {
    const { token } = await makeUser();
    const order = await Order.create(orderData());
    const res = await request(app).post(`/api/v1/orders/${order._id}/refund/sync`).set('Authorization', `Bearer ${token}`).send();
    expect(res.status).toBe(400);
    expect(mockRefundFetch).not.toHaveBeenCalled();
  });
});

describe('runRefundReconcileJob — periodic fallback for a missed webhook', () => {
  it('resolves a stuck refund past the threshold', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const order = await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'processing', amount: 5000, reference: '18021729', requestedAt: old },
    }));
    mockRefundFetch.mockResolvedValueOnce({ status: true, data: { id: 18021729, status: 'processed' } });

    await runRefundReconcileJob();

    const fresh = await Order.findById(order._id);
    expect(fresh.refund.status).toBe('completed');
  });

  it('does not check a refund that is not yet past the stuck threshold', async () => {
    const recent = new Date(); // just now
    await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'processing', amount: 5000, reference: '18021730', requestedAt: recent },
    }));

    await runRefundReconcileJob();

    expect(mockRefundFetch).not.toHaveBeenCalled();
  });

  it('skips a stuck refund with no reference (the documented ambiguous-create gap)', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await Order.create(orderData({
      status: 'cancelled',
      refund: { status: 'processing', amount: 5000, reference: null, requestedAt: old },
    }));

    await runRefundReconcileJob();

    expect(mockRefundFetch).not.toHaveBeenCalled();
  });
});
