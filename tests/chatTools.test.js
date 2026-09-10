// Tools give the chat assistant live data and a way to hand a cart to checkout
// (2026-09-10). The invariants pinned here are the ones that involve money or
// other people's data — the rest of the file is convenience.
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { TOOL_DEFINITIONS, EXECUTORS, executeTool } = require('../services/chatTools');

async function makeProduct(over = {}) {
  return Product.create({
    name: 'Tecno Spark 20 Pro',
    slug: `tecno-spark-${Math.random().toString(36).slice(2, 8)}`,
    price: 165000, // pesewas — GH₵1,650.00
    stock: 25,
    category: 'Phones',
    sellOnline: true,
    isActive: true,
    ...over,
  });
}

describe('chat tools — the model can never set a price', () => {
  // The whole safety argument rests on this: there is no argument anywhere in
  // the schemas through which a discount could be talked into existence.
  it('exposes no price, total, or discount field on any tool', () => {
    const json = JSON.stringify(TOOL_DEFINITIONS.map((t) => t.input_schema));
    for (const forbidden of ['price', 'total', 'discount', 'amount', 'cost']) {
      expect(json.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
  });

  it('prices a cart from the database, ignoring anything extra the model sends', async () => {
    const p = await makeProduct({ price: 165000 });
    // A model talked into "helping" passes a price. The schema has no such
    // field, and buildCart must not grow one by accident either.
    const res = await EXECUTORS.build_cart({ items: [{ slug: p.slug, qty: 2, price: 1 }] });

    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].unitPrice).toMatch(/1,650/);
    expect(res.lines[0].lineTotal).toMatch(/3,300/);
    expect(res.subtotal).toMatch(/3,300/);
  });
});

describe('chat tools — build_cart', () => {
  it('returns a checkout link carrying only slugs and quantities', async () => {
    const p = await makeProduct();
    const res = await EXECUTORS.build_cart({ items: [{ slug: p.slug, qty: 3 }] });

    expect(res.checkoutUrl).toContain('/cart/add?items=');
    expect(res.checkoutUrl).toContain(`${p.slug}:3`);
    // No money in the URL — the cart page re-reads every price by slug.
    expect(res.checkoutUrl).not.toMatch(/price|total|165000/i);
  });

  it('refuses more than the available stock', async () => {
    const p = await makeProduct({ stock: 2 });
    const res = await EXECUTORS.build_cart({ items: [{ slug: p.slug, qty: 5 }] });
    expect(res.error).toMatch(/only 2 in stock/i);
  });

  it('skips an unknown product but keeps the rest of the cart', async () => {
    const p = await makeProduct();
    const res = await EXECUTORS.build_cart({ items: [{ slug: p.slug, qty: 1 }, { slug: 'no-such-thing', qty: 1 }] });

    expect(res.lines).toHaveLength(1);
    expect(res.problems.join(' ')).toMatch(/no-such-thing/);
  });

  it('will not sell a product that is hidden from the shop', async () => {
    const p = await makeProduct({ sellOnline: false });
    const res = await EXECUTORS.build_cart({ items: [{ slug: p.slug, qty: 1 }] });
    expect(res.error).toBeTruthy();
    expect(res.lines).toBeUndefined();
  });

  it('rejects an empty cart rather than producing an empty checkout link', async () => {
    expect((await EXECUTORS.build_cart({ items: [] })).error).toMatch(/no items/i);
  });
});

describe('chat tools — search_products', () => {
  // Customers type phrases. Matching the whole phrase as one literal reported
  // brands as unstocked while they sat on the shelf.
  it('finds a product from a multi-word phrase', async () => {
    await makeProduct({ name: 'Tecno Spark 20 Pro', category: 'Phones' });
    const res = await EXECUTORS.search_products({ query: 'do you have any tecno phones in stock' });
    expect(res.products.map((p) => p.name)).toContain('Tecno Spark 20 Pro');
  });

  it('formats prices as GH₵ so the model cannot misread pesewas as cedis', async () => {
    await makeProduct({ price: 165000 });
    const res = await EXECUTORS.search_products({ query: 'tecno' });
    expect(res.products[0].price).toMatch(/GH₵1,650\.00/);
  });

  it('hides products that are not sold online', async () => {
    const p = await makeProduct({ name: 'Internal Only Widget', sellOnline: false });
    const res = await EXECUTORS.search_products({ query: 'Internal Only Widget' });
    expect(res.products.map((x) => x.slug)).not.toContain(p.slug);
  });

  it('says nothing matched rather than returning junk', async () => {
    const res = await EXECUTORS.search_products({ query: 'zzzz-no-such-product' });
    expect(res.products).toHaveLength(0);
    expect(res.note).toMatch(/whatsapp/i);
  });

  it('survives regex metacharacters in the query', async () => {
    // "c++ charger" would throw on an unescaped regex and take the turn with it.
    await expect(EXECUTORS.search_products({ query: 'c++ (charger) [new]' })).resolves.toBeDefined();
  });
});

describe('chat tools — track_order leaks nothing', () => {
  // Reachable by any anonymous visitor. Safe only because the tracking number is
  // itself the credential — so the payload must stay minimal.
  it('returns status but no customer details, items or money', async () => {
    const order = await Order.create({
      // Date.now() alone collides when suites run in parallel — two orders in the
      // same millisecond hit the unique index and fail the run intermittently.
      orderNumber: `EZW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trackingNumber: `TRK${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      items: [{ name: 'Tecno Spark', price: 165000, qty: 1 }],
      subtotal: 165000,
      total: 165000,
      customer: { name: 'Ama Serwaa', phone: '0244000000', email: 'ama@example.com' },
      status: 'processing',
    });

    const res = await EXECUTORS.track_order({ trackingNumber: order.trackingNumber });
    const json = JSON.stringify(res);

    expect(res.found).toBe(true);
    expect(res.status).toBe('processing');
    expect(json).not.toMatch(/Ama Serwaa|0244000000|ama@example\.com/);
    expect(json).not.toMatch(/165000/);
  });

  it('reports not-found instead of erroring on a bad number', async () => {
    const res = await EXECUTORS.track_order({ trackingNumber: 'TRK-NOPE' });
    expect(res.found).toBe(false);
  });
});

describe('chat tools — failures never break the turn', () => {
  it('turns an unknown tool name into a readable result', async () => {
    expect((await executeTool('drop_database', {})).error).toMatch(/unknown tool/i);
  });

  it('turns a thrown executor into a result the model can apologise with', async () => {
    const spy = jest.spyOn(Product, 'find').mockImplementation(() => { throw new Error('mongo is down'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await executeTool('search_products', { query: 'phone' });
    expect(res.error).toMatch(/whatsapp/i);

    spy.mockRestore();
    consoleSpy.mockRestore();
  });
});

describe('chat tools — start_registration keeps credentials out of chat', () => {
  const { EXECUTORS: E } = require('../services/chatTools');

  // The whole point of the hand-off. ChatSession stores messages as plaintext
  // and admin/staff read every transcript at /dashboard/chats, where they are
  // retained for the quality metrics — so a password collected in chat would
  // sit in the clear in front of the whole team, forever.
  it('accepts no password field on the tool, and ignores one if sent', () => {
    const def = TOOL_DEFINITIONS.find((t) => t.name === 'start_registration');
    expect(Object.keys(def.input_schema.properties)).toEqual(['name', 'email', 'phone']);

    const res = E.start_registration({ name: 'Ama', email: 'a@b.com', password: 'hunter2' });
    expect(JSON.stringify(res)).not.toContain('hunter2');
    expect(res.signupUrl).not.toMatch(/password/i);
  });

  it('tells the model in the result itself not to ask for one', () => {
    const res = E.start_registration({ name: 'Ama', phone: '0244000000' });
    expect(res.instruction).toMatch(/do not ask for a password/i);
  });

  it('builds a prefilled link and normalises what the customer typed', () => {
    const res = E.start_registration({ name: 'Ama Serwaa', email: '  AMA@Example.COM ', phone: '+233 24 400 0000' });
    expect(res.signupUrl).toContain('/auth/register?');
    expect(res.signupUrl).toContain('name=Ama+Serwaa');
    expect(res.signupUrl).toContain('email=ama%40example.com'); // lowercased
    expect(res.signupUrl).toContain('phone=0244000000');        // Ghana local format
  });

  it('creates no account — it is a link, not a write', async () => {
    const User = require('../models/User');
    const before = await User.countDocuments();
    E.start_registration({ name: 'Ghost', email: 'ghost@example.com' });
    expect(await User.countDocuments()).toBe(before);
  });

  it('requires a name, and an email or a phone', () => {
    expect(E.start_registration({ email: 'a@b.com' }).error).toMatch(/name/i);
    expect(E.start_registration({ name: 'Ama' }).error).toMatch(/email address or a phone/i);
  });

  // Convenient, but it would be an enumeration oracle behind the chat limiter
  // (60 per 15 min) rather than the registration one (5 per hour). The sign-up
  // form already reports a duplicate on submit, at the correct rate limit.
  it('does not reveal whether an address is already registered', async () => {
    const User = require('../models/User');
    const email = `taken-${Date.now()}@example.com`;
    await User.create({ name: 'Existing', email, password: 'Password123!', isVerified: true });

    const taken = E.start_registration({ name: 'Someone', email });
    const free  = E.start_registration({ name: 'Someone', email: `free-${Date.now()}@example.com` });

    expect(taken.error).toBeUndefined();
    expect(Object.keys(taken)).toEqual(Object.keys(free)); // identical shape either way
  });

  it('cannot be steered into linking somewhere else', () => {
    const res = E.start_registration({ name: 'Ama', email: 'a@b.com' });
    // The host comes from FRONTEND_URL and the path is fixed, so nothing the
    // customer types can redirect the link off-site.
    expect(res.signupUrl.split('?')[0]).toMatch(/\/auth\/register$/);
  });
});
