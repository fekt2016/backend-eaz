const ChatSession = require('../models/ChatSession');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeMessage } = require('../utils/sanitize');
const { getBusinessProfile } = require('../utils/businessProfile');

// ─────────────────────────────────────────────────────────────────────────────
// AI HOOK — swap this function when you're ready to plug in OpenAI / Claude
// Just replace the body with your API call and return a string response.
// ─────────────────────────────────────────────────────────────────────────────
async function getAIResponse(messages, userMessage) {
  // TODO: replace with AI call e.g.:
  // const openai = require('openai');
  // const response = await openai.chat.completions.create({ ... });
  // return response.choices[0].message.content;
  return null; // returning null falls through to rule-based engine
}

// Digits-only WhatsApp number (e.g. "233244388190") → display format "+233 244 388 190"
function _formatWhatsapp(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.startsWith('233') && d.length === 12) {
    return `+233 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9, 12)}`;
  }
  return `+${d}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RULE-BASED ENGINE
// Service list, pricing, and contact info come from `Settings.business`
// (admin-editable) via `getBusinessProfile()` — see utils/businessProfile.js.
// ─────────────────────────────────────────────────────────────────────────────
function ruleBasedResponse(message, knowledge) {
  const msg = message.toLowerCase().trim();

  // Greetings
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|howdy|yo)\b/.test(msg)) {
    return {
      text: "Hi there! 👋 I'm **Eazy**, EazWorld's assistant. I can help you with information about our services, pricing, or help you get started.\n\nWhat can I help you with today?",
      suggestions: ['Our Services', 'Pricing', 'Book a Consultation', 'Contact Us'],
    };
  }

  // Services overview
  if (/\b(services?|what do you (do|offer)|what can you do|offerings?)\b/.test(msg)) {
    const list = knowledge.services.map(s => `• **${s.name}**`).join('\n');
    return {
      text: `Here's what EazWorld offers:\n\n${list}\n\nWhich service would you like to know more about?`,
      suggestions: ['Web Design', 'SEO', 'Branding', 'Phone Repair'],
    };
  }

  // Pricing
  if (/\b(pric(e|ing|es)|cost|how much|fee|rates?|charges?|package)\b/.test(msg)) {
    const list = knowledge.services.map(s => `• **${s.name}** — ${s.price}`).join('\n');
    return {
      text: `Here's a summary of our pricing:\n\n${list}\n\nAll prices are in Ghana Cedis. Want a custom quote for your project?`,
      suggestions: ['Get a Custom Quote', 'Book Free Consultation', 'Web Design Pricing', 'SEO Pricing'],
    };
  }

  // Web design
  if (/\b(web(site)?|web design|web dev|landing page|ecommerce|e-commerce|online store)\b/.test(msg)) {
    return {
      text: `Our **Web Design & Development** service includes:\n\n• Custom design tailored to your brand\n• Mobile-responsive & fast\n• SEO-ready from day one\n• Most websites live within 2 weeks\n• Starting from **GHS 1,500**\n\nWant to see examples of our work?`,
      suggestions: ['View Portfolio', 'Book Consultation', 'Get a Quote', 'See Pricing'],
    };
  }

  // SEO
  if (/\b(seo|search engine|google ranking|rank|organic traffic|keywords?)\b/.test(msg)) {
    return {
      text: `Our **SEO** service helps you rank higher on Google and get more organic traffic:\n\n• Local SEO — **GHS 800/month**\n• Business SEO — **GHS 2,000/month**\n\nAll plans include keyword research, on-page optimisation, and monthly reports.\n\nWe specialise in Ghanaian businesses — we know the local market!`,
      suggestions: ['SEO Pricing', 'Book Consultation', 'Paid Ads Instead'],
    };
  }

  // Paid ads
  if (/\b(paid ads?|google ads?|meta ads?|facebook ads?|instagram ads?|advertising|ppc|campaign)\b/.test(msg)) {
    return {
      text: `Our **Paid Advertising** service runs Google & Meta campaigns targeted to your audience:\n\n• Ads Starter — **GHS 800/month** (management fee)\n• Ads Business — **GHS 2,000/month** (management fee)\n\n*Note: Ad spend budget is separate and paid directly to Google/Meta.*`,
      suggestions: ['Paid Ads Pricing', 'Book Consultation', 'SEO Instead'],
    };
  }

  // Branding
  if (/\b(brand(ing)?|logo|identity|design|visual)\b/.test(msg)) {
    return {
      text: `Our **Branding** packages are one-time projects:\n\n• Logo Only — **GHS 500**\n• Brand Starter — **GHS 1,500** ⭐ Most Popular\n• Brand Premium — **GHS 3,500**\n\nAll packages include multiple revisions and final files in all formats.`,
      suggestions: ['Branding Pricing', 'Book Consultation', 'Web Design Too'],
    };
  }

  // Social media
  if (/\b(social media|instagram|facebook|twitter|tiktok|content creation|posting)\b/.test(msg)) {
    return {
      text: `Our **Social Media Management** service keeps your brand active and growing:\n\n• Social Starter — **GHS 600/month**\n• Social Business — **GHS 1,500/month**\n\nIncludes content creation, scheduling, community management, and monthly analytics.`,
      suggestions: ['Social Media Pricing', 'Book Consultation', 'Email Marketing Too'],
    };
  }

  // Email marketing
  if (/\b(email marketing|newsletter|mailchimp|campaign|subscribers?)\b/.test(msg)) {
    return {
      text: `Our **Email Marketing** service turns subscribers into buyers:\n\n• Email Starter — **GHS 500/month**\n• Email Business — **GHS 1,200/month**\n\n*Note: Platform subscription (Mailchimp etc.) is paid separately.*`,
      suggestions: ['Email Pricing', 'Book Consultation', 'Social Media Too'],
    };
  }

  // Phone repair
  if (/\b(phone|repair|screen|battery|fix(ed)?|broken|iphone|samsung|tecno|infinix)\b/.test(msg)) {
    return {
      text: `We offer **fast, reliable phone repair** in Accra:\n\n• All major brands (iPhone, Samsung, Tecno, Infinix, etc.)\n• Most repairs done **same day**\n• 30-day warranty on all repairs\n• Honest pricing — no hidden fees\n• Walk-ins welcome!\n\n📍 Visit us in Accra`,
      suggestions: ['Our Location', 'Contact Us', 'Other Services'],
    };
  }

  // Hosting
  if (/\b(hosting|web host|server|cpanel|domain)\b/.test(msg)) {
    return {
      text: `We offer **web hosting & domain registration** for Ghanaian businesses:\n\n• Hosting from **GHS 150/year**\n• Domains from **GHS 80/year**\n• cPanel included\n• Pay via Mobile Money, Paystack or bank transfer\n\nAll prices in Ghana Cedis!`,
      suggestions: ['Hosting Plans', 'Register a Domain', 'Get Hosting + Domain'],
    };
  }

  // Portfolio / work
  if (/\b(portfolio|work|projects?|case stud(y|ies)|examples?|previous|saiisai)\b/.test(msg)) {
    return {
      text: `Our most notable project is **Saiisai** — Ghana's emerging online marketplace, built entirely by EazWorld:\n\n• 150+ verified sellers\n• 15,000+ products listed\n• 500+ daily transactions\n• 4.7/5 platform rating\n\nWe've also built platforms for WorldStar GH, JM Logistics, Giwa Investment, and many more.`,
      suggestions: ['View Full Portfolio', 'Book Consultation', 'Get a Quote'],
    };
  }

  // Location / where are you
  if (/\b(where|location|address|accra|ghana|visit|find you|office)\b/.test(msg)) {
    return {
      text: `📍 We're based in **${knowledge.location}**.\n\nYou can visit us in person — walk-ins are welcome for phone repairs.\n\nFor digital services, we work with clients across Ghana and beyond — all remotely.\n\n🕐 Hours: ${knowledge.hours}`,
      suggestions: ['Get Directions', 'WhatsApp Us', 'Book Consultation'],
    };
  }

  // Contact
  if (/\b(contact|reach|talk|speak|call|whatsapp|email|get in touch)\b/.test(msg)) {
    return {
      text: `You can reach us through:\n\n📱 **WhatsApp:** ${_formatWhatsapp(knowledge.whatsapp)}\n📧 **Email:** ${knowledge.email}\n📍 **Location:** ${knowledge.location}\n🕐 **Hours:** ${knowledge.hours}\n\nOr book a free consultation and we'll call you back!`,
      suggestions: ['Book Free Consultation', 'WhatsApp Now', 'Send a Message'],
    };
  }

  // Consultation / booking
  if (/\b(consult(ation)?|book(ing)?|appointment|meet|discuss|free call|schedule)\b/.test(msg)) {
    return {
      text: `We offer a **free 30-minute consultation** — no pressure, just a chat about your goals.\n\nDuring the call we'll:\n• Understand your business needs\n• Recommend the right services\n• Give you a transparent quote\n\nBook yours now — slots are limited!`,
      suggestions: ['Book Consultation Now', 'WhatsApp Instead', 'Tell Me More'],
    };
  }

  // About EazWorld
  if (/\b(about|who are you|eazworld|team|company|agency)\b/.test(msg)) {
    return {
      text: `**EazWorld** is a premium digital agency based in **Accra, Ghana** 🇬🇭\n\nWe help Ghanaian businesses build, grow, and compete in the digital economy through:\n\n• World-class web design\n• Data-driven marketing\n• Reliable hosting & domains\n• Fast phone repairs\n\nWe've been in business for 5+ years, serving 200+ clients with a 4.7/5 rating.`,
      suggestions: ['Our Services', 'View Portfolio', 'Meet the Team', 'Book Consultation'],
    };
  }

  // Thanks / goodbye
  if (/\b(thanks?|thank you|bye|goodbye|see you|great|awesome|perfect|wonderful)\b/.test(msg)) {
    return {
      text: `You're welcome! 😊 It was a pleasure chatting with you.\n\nFeel free to come back anytime. If you're ready to grow your business, we'd love to help!\n\n🚀 **EazWorld — Built in Accra, Built for Africa.**`,
      suggestions: ['Book Consultation', 'View Services', 'Contact Us'],
    };
  }

  // Default fallback
  return {
    text: `Thanks for your message! I'm not quite sure about that, but I'd love to connect you with the right person.\n\nYou can:\n• 📱 WhatsApp us at ${_formatWhatsapp(knowledge.whatsapp)}\n• 📅 Book a free consultation\n• 📧 Email ${knowledge.email}`,
    suggestions: ['Book Consultation', 'WhatsApp Us', 'Our Services', 'Pricing'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/chat
 * Send a message and get a response
 */
const sendMessage = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    const message = sanitizeMessage(req.body.message, 2000);
    const name    = sanitizeName(req.body.name);
    const email   = sanitizeEmail(req.body.email);
    const phone   = sanitizePhone(req.body.phone);

    if (!sessionId || !message?.trim()) {
      return res.status(400).json({ success: false, error: 'sessionId and message are required.' });
    }

    // Find or create session
    let session = await ChatSession.findOne({ sessionId });
    if (!session) {
      session = await ChatSession.create({ sessionId, messages: [] });
    }

    // Update contact info if provided
    if (name)  session.name  = name;
    if (email) session.email = email;
    if (phone) session.phone = phone;

    const trimmedMsg = message.trim();

    // Detect internal trigger markers sent by the widget
    const isHumanRequest = trimmedMsg === '[User requested to speak with a human agent]';
    const isUserEndChat  = trimmedMsg === '[User ended the conversation]';

    if (isHumanRequest) session.humanRequested = true;

    // When the user ends the chat, resolve and save a visible system message
    if (isUserEndChat) {
      session.messages.push({ role: 'bot', content: '🔴 The user has ended this conversation.' });
      session.resolved       = true;
      session.humanRequested = false;
      session.lastActivity   = new Date();
      await session.save();
      return res.status(200).json({
        success: true,
        data: { response: null, suggestions: [], sessionId, ended: true },
      });
    }

    // Save user message (skip saving internal trigger markers as visible messages)
    if (!isHumanRequest) {
      session.messages.push({ role: 'user', content: trimmedMsg });
    }
    session.lastActivity = new Date();

    // If human mode is active — skip bot, just persist and return empty response
    if (session.humanRequested || isHumanRequest) {
      await session.save();
      return res.status(200).json({
        success: true,
        data: { response: null, suggestions: [], sessionId, humanRequested: true },
      });
    }

    // Generate response — try AI first, fall back to rule-based
    const history = session.messages.map(m => ({ role: m.role, content: m.content }));
    let botResponse;
    let suggestions = [];

    const aiText = await getAIResponse(history, trimmedMsg);
    if (aiText) {
      botResponse = aiText;
    } else {
      const knowledge = await getBusinessProfile();
      const result = ruleBasedResponse(trimmedMsg, knowledge);
      botResponse  = result.text;
      suggestions  = result.suggestions || [];
    }

    // Save bot response
    session.messages.push({ role: 'bot', content: botResponse });
    await session.save();

    res.status(200).json({
      success: true,
      data: {
        response: botResponse,
        suggestions,
        sessionId,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/chat/sessions — admin only
 * List all chat sessions
 */
const getSessions = async (req, res, next) => {
  try {
    const { resolved } = req.query;
    const filter = {};
    if (resolved === 'true')  filter.resolved = true;
    if (resolved === 'false') filter.resolved = false;

    const sessions = await ChatSession.find(filter)
      // Sort: pending (requested but not accepted) first, then active live chats, then rest
      .sort({ humanAccepted: -1, humanRequested: -1, lastActivity: -1 })
      .select('sessionId name email phone resolved humanRequested humanAccepted lastActivity createdAt messages');

    res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/chat/sessions/:sessionId — admin only
 * Get full session with messages
 */
const getSession = async (req, res, next) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found.' });
    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/chat/sessions/:sessionId — admin only
 * Mark session as resolved / update contact info
 */
const updateSession = async (req, res, next) => {
  try {
    const { resolved } = req.body;
    const session = await ChatSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found.' });

    if (resolved === true && !session.resolved) {
      // Save a visible system message so the user's widget picks it up via polling
      session.messages.push({ role: 'bot', content: '🔴 The EazWorld team has ended this conversation. Thank you for chatting with us!' });
      session.humanRequested = false;
      session.humanAccepted  = false;
      session.lastActivity   = new Date();
    }
    if (resolved !== undefined) {
      session.resolved = resolved;
    }
    await session.save();
    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/chat/sessions/:sessionId — admin only
 */
const deleteSession = async (req, res, next) => {
  try {
    await ChatSession.findOneAndDelete({ sessionId: req.params.sessionId });
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/chat/sessions/:sessionId/reply — admin only
 * Send a message from admin to the user's chat session
 */
const adminReply = async (req, res, next) => {
  try {
    const message = sanitizeMessage(req.body.message, 2000);
    if (!message?.trim()) {
      return res.status(400).json({ success: false, error: 'message is required.' });
    }

    const session = await ChatSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found.' });

    session.messages.push({ role: 'admin', content: message.trim() });
    session.lastActivity = new Date();
    // Re-open the session if it was resolved
    if (session.resolved) session.resolved = false;
    await session.save();

    res.status(200).json({ success: true, data: { message: message.trim() } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/chat/sessions/:sessionId/messages — public (widget polling)
 * Returns messages newer than `since` (ISO date string)
 */
const getMessages = async (req, res, next) => {
  try {
    // Verify caller owns this session — the widget sends its ew_session cookie automatically.
    // Admins bypass this check (they use the authenticated /sessions/:id route instead).
    const callerSession = req.cookies?.ew_session;
    const isAdmin = req.user?.role === 'admin'; // set by protect middleware if token present
    if (!isAdmin && callerSession !== req.params.sessionId) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const session = await ChatSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found.' });

    const { since } = req.query;
    let messages = session.messages;

    if (since) {
      const sinceDate = new Date(since);
      messages = messages.filter((m) => new Date(m.createdAt) > sinceDate);
    }

    res.status(200).json({
      success: true,
      data:    messages,
      meta: {
        humanRequested: session.humanRequested,
        humanAccepted:  session.humanAccepted,
        resolved:       session.resolved,
        name:           session.name,
        email:          session.email,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/chat/sessions/:sessionId/accept — admin only
 * Accept a pending live-chat request
 */
const acceptChat = async (req, res, next) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found.' });
    if (!session.humanRequested) return res.status(400).json({ success: false, error: 'No pending chat request.' });

    session.humanAccepted   = true;
    session.humanAcceptedAt = new Date();
    session.lastActivity    = new Date();
    await session.save();

    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendMessage, getSessions, getSession, updateSession, deleteSession, adminReply, getMessages, acceptChat };
