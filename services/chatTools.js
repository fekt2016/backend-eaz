/**
 * Tools the chat assistant can call (2026-09-10).
 *
 * The system prompt grounds the model in facts that rarely change. These cover
 * the ones that change constantly — stock, prices at today's exchange rate,
 * domain availability, where an order is — because a number typed into a prompt
 * is stale the moment the admin edits it, and a confidently stale price is worse
 * than no answer.
 *
 * Three rules hold for everything in this file:
 *
 *  1. READ-ONLY, with one exception. `build_cart` validates a cart and returns a
 *     link; it writes nothing. No tool creates an order, moves money, or mutates
 *     a record. The customer still checks out and pays through the normal UI.
 *  2. THE MODEL NEVER SUPPLIES A PRICE. It passes slugs and quantities; every
 *     figure returned here is read from the database. There is no argument
 *     anywhere below through which a discount could be talked into existence.
 *  3. NOTHING PERSONAL CROSSES. Tools are reachable by any anonymous visitor who
 *     can open the chat widget, so none of them takes a customer id or email and
 *     none returns another person's data. `track_order` is safe for exactly one
 *     reason: the tracking number IS the credential, and it returns the same
 *     minimal payload the public tracking page already shows.
 */
const Product      = require('../models/Product');
const Order        = require('../models/Order');
const Post         = require('../models/Post');
const Project      = require('../models/Project');
const namecheap    = require('./namecheap');
const { formatGhs } = require('../utils/money');
const { sanitizeName, sanitizeEmail, sanitizePhone } = require('../utils/sanitize');
const { HOSTING_PLANS, isSellable } = require('../config/hostingPlans');
const frontendUrl  = require('../utils/frontendUrl');

// Caps exist to protect the context window, not the database. Every extra row
// is input tokens on this request AND on every later turn that replays it.
const MAX_PRODUCTS = 8;
const MAX_ARTICLES = 5;
const MAX_CART_LINES = 20;

/** Escape a user string before it becomes a regex. Without this, "c++" throws. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Definitions sent to the model ────────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: 'search_products',
    description:
      'Search the online shop for products by name or category — phones, laptops, ' +
      'accessories, chargers, cases, repair parts. Returns live price and stock. ' +
      'Use this for ANY question about what is sold or what something costs; never ' +
      'guess a product price.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the customer is looking for, e.g. "iphone charger" or "laptop".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'build_cart',
    description:
      'Validate a set of products and produce a checkout link with the cart ready. ' +
      'Call this ONLY after the customer has confirmed the exact items and quantities. ' +
      'Returns the verified line prices and a link — give the customer that link so ' +
      'they can choose delivery and pay. This does not place the order or take payment.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The lines to put in the cart. Use the exact `slug` returned by search_products.',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Product slug from search_products.' },
              qty:  { type: 'integer', description: 'How many, 1 or more.' },
            },
            required: ['slug', 'qty'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'track_order',
    description:
      "Look up an order's delivery status by its tracking number. Ask the customer " +
      'for the tracking number from their confirmation email or the track page.',
    input_schema: {
      type: 'object',
      properties: {
        trackingNumber: { type: 'string', description: 'The tracking number the customer gives you.' },
      },
      required: ['trackingNumber'],
    },
  },
  {
    name: 'get_hosting_plans',
    description:
      'Current web-hosting plans with live GH₵ prices at today\'s exchange rate. ' +
      'Use for any hosting price or specification question.',
    input_schema: {
      type: 'object',
      properties: {
        planType: {
          type: 'string',
          description: 'Which family to list. Omit for all sellable plans.',
          enum: ['shared', 'wordpress', 'vps', 'cloud', 'email'],
        },
      },
    },
  },
  {
    name: 'check_domain',
    description:
      'Check whether a domain name is available to register and what it costs in GH₵. ' +
      'Use whenever a customer asks about a specific domain.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Full domain including the extension, e.g. "mybusiness.com".' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'start_registration',
    description:
      'Produce a sign-up link with the customer\'s details already filled in. Offer this ' +
      'when someone asks to create an account, or after they order and want to track it. ' +
      'Collect their name and an email or phone number first. ' +
      'NEVER ask for a password and never accept one — they set it on the sign-up page.',
    input_schema: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: "The customer's full name." },
        email: { type: 'string', description: 'Their email address, if they gave one.' },
        phone: { type: 'string', description: 'Their phone number, if they gave one.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_content',
    description:
      'Search published blog articles and portfolio projects. Use to show relevant ' +
      'past work ("have you built anything like mine?") or point at a guide.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic or industry, e.g. "restaurant" or "SEO".' },
        kind:  { type: 'string', enum: ['blog', 'portfolio', 'both'], description: 'Defaults to both.' },
      },
      required: ['query'],
    },
  },
];

// ── Executors ────────────────────────────────────────────────────────────────

/*
 * Customers type phrases, not substrings: "tecno phones", "charger for my
 * samsung", "iphone 13 screen". Matching the whole phrase as one literal finds
 * nothing unless a product is named exactly that — "tecno phones" cannot match
 * "Tecno Spark 20 Pro", so the assistant reports the brand as unstocked while
 * 25 of them sit on the shelf.
 *
 * So: tokenise, drop the filler words that appear in every phrasing, then
 * require ALL remaining terms across name+category ("tecno" AND "phones" —
 * Phones being the category). If that is too strict, retry with ANY term, which
 * degrades to a broader list rather than to silence.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'do', 'does', 'for', 'get', 'got', 'have',
  'how', 'i', 'in', 'is', 'it', 'me', 'much', 'my', 'need', 'of', 'or', 'sell',
  'some', 'stock', 'the', 'to', 'want', 'what', 'with', 'you', 'your',
]);

function queryTerms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9+]+/i)
    .filter((w) => w && w.length > 1 && !STOPWORDS.has(w))
    .slice(0, 6); // a long sentence must not become a 20-clause query
}

const termClause = (term) => {
  const rx = new RegExp(escapeRegex(term), 'i');
  return { $or: [{ name: rx }, { category: rx }] };
};

async function searchProducts({ query }) {
  const terms = queryTerms(query);
  if (!terms.length) return { products: [] };

  const base = { sellOnline: true, isActive: true };
  const select = 'name slug price stock category';

  let rows = await Product.find({ ...base, $and: terms.map(termClause) })
    .select(select).limit(MAX_PRODUCTS).lean();

  if (!rows.length && terms.length > 1) {
    rows = await Product.find({ ...base, $or: terms.map(termClause) })
      .select(select).limit(MAX_PRODUCTS).lean();
  }

  return {
    products: rows.map((p) => ({
      name: p.name,
      slug: p.slug,
      price: formatGhs(p.price),
      category: p.category || '',
      inStock: (p.stock ?? 0) > 0,
      stock: p.stock ?? 0,
    })),
    note: rows.length ? undefined : 'Nothing matched. Offer to check on WhatsApp rather than guessing.',
  };
}

/**
 * Validate a cart and hand back a link.
 *
 * Prices are re-read from the database here, never taken from the model's
 * arguments — the schema above has no price field at all, and this is the
 * function that would have to honour one if it did.
 */
async function buildCart({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'No items given. Ask the customer what they want to buy.' };
  }
  if (items.length > MAX_CART_LINES) {
    return { error: `That is more than ${MAX_CART_LINES} different products. Suggest ordering on the shop page.` };
  }

  const lines = [];
  const problems = [];
  let subtotal = 0;

  for (const raw of items) {
    const slug = String(raw?.slug || '').trim();
    const qty = Math.max(1, Math.floor(Number(raw?.qty) || 1));
    if (!slug) continue;

    const p = await Product.findOne({ slug, sellOnline: true, isActive: true })
      .select('name slug price stock')
      .lean();

    if (!p) { problems.push(`"${slug}" is not in the shop.`); continue; }
    if (!Number(p.price) || p.price <= 0) { problems.push(`${p.name} has no price set — it cannot be ordered online.`); continue; }
    if ((p.stock ?? 0) < qty) { problems.push(`${p.name}: only ${p.stock ?? 0} in stock, ${qty} requested.`); continue; }

    const lineTotal = Math.round(p.price) * qty;
    subtotal += lineTotal;
    lines.push({ name: p.name, slug: p.slug, qty, unitPrice: formatGhs(p.price), lineTotal: formatGhs(lineTotal) });
  }

  if (!lines.length) {
    return { error: problems.join(' ') || 'None of those products could be added.' };
  }

  // The link carries slugs and quantities only. The cart page re-reads every
  // price from the API, and checkout prices the order server-side again, so a
  // tampered link changes what is in the basket and never what it costs.
  const query = lines.map((l) => `${encodeURIComponent(l.slug)}:${l.qty}`).join(',');
  const checkoutUrl = `${frontendUrl()}/cart/add?items=${query}`;

  return {
    lines,
    subtotal: formatGhs(subtotal),
    checkoutUrl,
    problems: problems.length ? problems : undefined,
    instruction:
      'Show the customer the lines and the subtotal, then give them checkoutUrl as a ' +
      'plain link on its own line. Tell them delivery is chosen and paid for on that ' +
      'page, and that the subtotal does not yet include delivery.',
  };
}

async function trackOrder({ trackingNumber }) {
  const tn = String(trackingNumber || '').trim().toUpperCase();
  if (!tn) return { error: 'Ask the customer for their tracking number.' };

  // Same minimal projection the public tracking page uses. No customer details,
  // no items, no money — this tool is reachable by anyone with the number.
  const order = await Order.findOne({ trackingNumber: tn })
    .select('trackingNumber orderNumber status createdAt trackingHistory')
    .lean();

  if (!order) return { found: false, note: 'No order with that tracking number. Ask them to double-check it.' };

  const last = (order.trackingHistory || []).slice(-1)[0];
  return {
    found: true,
    trackingNumber: order.trackingNumber,
    status: order.status,
    placedOn: order.createdAt,
    latestUpdate: last ? { status: last.status, note: last.note || '', at: last.timestamp } : null,
  };
}

function getHostingPlans({ planType } = {}) {
  const types = planType ? [planType] : Object.keys(HOSTING_PLANS);
  const plans = [];

  for (const type of types) {
    const tiers = HOSTING_PLANS[type] || {};
    for (const [tier, plan] of Object.entries(tiers)) {
      if (typeof isSellable === 'function' && !isSellable(type, tier)) continue;
      plans.push({
        planType: type,
        tier,
        name: plan.name,
        tagline: plan.tagline || '',
        // Live getters — they convert at the admin's current exchange rate, so
        // this is today's price and not one baked in at deploy.
        monthly: formatGhs(plan.monthlyPrice),
        annual: formatGhs(plan.annualPrice),
        specs: (plan.specs || []).slice(0, 5).map((s) => `${s.label}: ${s.value}`),
      });
    }
  }
  return { plans, note: 'Annual billing is charged as ten months — two months free.' };
}

async function checkDomain({ domain }) {
  const name = String(domain || '').trim().toLowerCase();
  if (!name.includes('.')) {
    return { error: 'Ask for the full domain including the extension, e.g. mybusiness.com.' };
  }
  if (!namecheap.hasConfig()) {
    return { error: 'Domain search is unavailable right now. Offer to check on WhatsApp.' };
  }
  try {
    const result = await namecheap.checkDomain(name);
    return {
      domain: name,
      available: !!result?.available,
      price: result?.price != null ? formatGhs(result.price) : undefined,
      note: result?.available ? undefined : 'Taken — suggest a variation and check that one.',
    };
  } catch {
    return { error: 'The registrar did not respond. Offer to check on WhatsApp.' };
  }
}

async function searchContent({ query, kind = 'both' }) {
  const rx = new RegExp(escapeRegex(String(query || '').trim()), 'i');
  if (!rx.source || rx.source === '(?:)') return { articles: [], projects: [] };

  const out = {};
  if (kind === 'blog' || kind === 'both') {
    const posts = await Post.find({ status: 'published', $or: [{ title: rx }, { excerpt: rx }] })
      .select('title slug excerpt')
      .limit(MAX_ARTICLES)
      .lean();
    out.articles = posts.map((p) => ({ title: p.title, url: `/blog/${p.slug}`, excerpt: (p.excerpt || '').slice(0, 160) }));
  }
  if (kind === 'portfolio' || kind === 'both') {
    const projects = await Project.find({ $or: [{ title: rx }, { description: rx }, { category: rx }] })
      .select('title description category')
      .limit(MAX_ARTICLES)
      .lean();
    out.projects = projects.map((p) => ({ title: p.title, category: p.category || '', summary: (p.description || '').slice(0, 160) }));
  }
  return out;
}

/*
 * A sign-up link, prefilled.
 *
 * Everything sensitive about registration is kept OUT of the conversation:
 *
 *  - No password, ever. ChatSession stores messages as plaintext and every
 *    admin and staff member reads transcripts at /dashboard/chats, where they
 *    are deliberately retained for the chat-quality metrics. A password typed
 *    into chat would sit in the clear in front of the whole team, and customers
 *    reuse passwords across their email and bank.
 *  - No account is created here. This writes nothing; the customer submits the
 *    real form, which is the rate-limited, validated path it always was.
 *  - No "is this email taken?" check, deliberately. It would be convenient, and
 *    it would also be an account-enumeration oracle behind the chat limiter (60
 *    per 15 min) instead of the registration one (5 per hour). The sign-up form
 *    already reports a duplicate on submit, at the correct rate limit.
 */
function startRegistration({ name, email, phone }) {
  const cleanName  = sanitizeName(name);
  const cleanEmail = sanitizeEmail(email);
  const cleanPhone = sanitizePhone(phone);

  if (!cleanName) {
    return { error: 'Ask the customer for their name first.' };
  }
  if (!cleanEmail && !cleanPhone) {
    return { error: 'Ask for an email address or a phone number — one of the two is required.' };
  }

  const params = new URLSearchParams({ name: cleanName });
  if (cleanEmail) params.set('email', cleanEmail);
  if (cleanPhone) params.set('phone', cleanPhone);

  return {
    signupUrl: `${frontendUrl()}/auth/register?${params.toString()}`,
    prefilled: { name: cleanName, email: cleanEmail || undefined, phone: cleanPhone || undefined },
    instruction:
      'Give the customer signupUrl as a plain link on its own line. Tell them their ' +
      'details are already filled in and they just choose a password. Do NOT ask for ' +
      'a password here — you cannot accept one.',
  };
}

const EXECUTORS = {
  search_products:   searchProducts,
  build_cart:        buildCart,
  track_order:       trackOrder,
  get_hosting_plans: getHostingPlans,
  check_domain:      checkDomain,
  search_content:    searchContent,
  start_registration: startRegistration,
};

/**
 * Run one tool call and always return something the model can read.
 *
 * A thrown executor must never break the conversation: the turn is already in
 * flight and the customer is watching a typing indicator. Failures come back as
 * `{ error }` so the model can apologise and offer WhatsApp — the same
 * degradation the rest of this integration uses.
 */
async function executeTool(name, input) {
  const fn = EXECUTORS[name];
  if (!fn) return { error: `Unknown tool "${name}".` };
  try {
    return await fn(input || {});
  } catch (err) {
    console.error(`[chat] tool ${name} failed:`, err.message);
    return { error: 'That lookup failed. Offer to check on WhatsApp instead of guessing.' };
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool, EXECUTORS };
