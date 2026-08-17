const express    = require('express');
const dotenv     = require('dotenv');
const cookieParser = require('cookie-parser');
const helmet     = require('helmet');
const xss        = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const hpp        = require('hpp');
const morgan     = require('morgan');
const crypto     = require('crypto');

// Load environment variables early
dotenv.config({ path: '.env' });

// Import custom middleware & routes
const { errorHandler } = require('./middleware/errorHandler');
const { protect, restrictTo } = require('./middleware/auth');
const authRoutes         = require('./routes/authRoutes');
const contactRoutes      = require('./routes/contactRoutes');
const projectRoutes      = require('./routes/projectRoutes');
const uploadRoutes       = require('./routes/uploadRoutes');
const domainRoutes       = require('./routes/domainRoutes');
const hostingOrderRoutes = require('./routes/hostingOrderRoutes');
const webhookRoutes      = require('./routes/webhookRoutes');
const adminRoutes        = require('./routes/adminRoutes');
const reviewRoutes       = require('./routes/reviewRoutes');
const postRoutes         = require('./routes/postRoutes');
const chatRoutes         = require('./routes/chatRoutes');
const settingsRoutes     = require('./routes/settingsRoutes');
const serviceOrderRoutes = require('./routes/serviceOrderRoutes');
const posRoutes          = require('./routes/posRoutes');
const trackRoutes        = require('./routes/trackRoutes');
const productRoutes      = require('./routes/productRoutes');
const orderRoutes        = require('./routes/orderRoutes');
const deliveryZoneRoutes = require('./routes/deliveryZoneRoutes');
const productReviewRoutes = require('./routes/productReviewRoutes');

const app = express();

const ENV  = process.env.NODE_ENV || 'development';
const PROD = ENV === 'production';

// Trust the first proxy (Nginx in prod, Next.js dev server locally)
// Required for express-rate-limit to correctly read X-Forwarded-For
app.set('trust proxy', 1);
console.log(`\n🚀 [EazWorld API] Starting server in ${ENV.toUpperCase()} mode`);

// ────────────────────────────────────────────────
// 🧱 Security — Headers (Helmet)
// ────────────────────────────────────────────────
const cspDirectives = {
  defaultSrc:  ["'self'"],
  scriptSrc:   ["'self'"],
  styleSrc:    ["'self'", "'unsafe-inline'"],
  imgSrc:      ["'self'", "data:", "https://res.cloudinary.com"],
  connectSrc:  ["'self'"],
  fontSrc:     ["'self'"],
  objectSrc:   ["'none'"],
  frameSrc:    ["'none'"],
  baseUri:     ["'self'"],
  formAction:  ["'self'"],
  // Only add upgrade-insecure-requests in production (requires HTTPS)
  ...(PROD && { upgradeInsecureRequests: [] }),
};

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  hsts: PROD
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  crossOriginEmbedderPolicy: false, // allow Paystack iframe
}));

// ────────────────────────────────────────────────
// 🧱 Security — XSS, NoSQL injection, HPP
// ────────────────────────────────────────────────
app.use(xss());                  // strip XSS from body/query
app.use(mongoSanitize());        // prevent NoSQL injection ($, .)
app.use(hpp({                    // prevent HTTP Parameter Pollution
  whitelist: ['sort', 'fields', 'page', 'limit', 'status', 'type'],
}));

// ────────────────────────────────────────────────
// 🪝 Webhook Routes (raw body — must come before JSON parser)
// ────────────────────────────────────────────────
app.use('/api/webhooks', webhookRoutes);

// ────────────────────────────────────────────────
// ⚙️ Body Parsing & Cookies
// ────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// ────────────────────────────────────────────────
// 🆔 Request ID (tracing / logs)
// ────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.id = crypto.randomUUID();
  next();
});

// ────────────────────────────────────────────────
// 🌍 CORS
// ────────────────────────────────────────────────
const allowedOrigins = [
  ...new Set([                          // deduplicate (FRONTEND_URL & CLIENT_URL are often the same)
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    ...(!PROD ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'] : []),
  ].filter(Boolean)),
];



if (PROD && !allowedOrigins.length) {
  console.error('❌ FATAL: FRONTEND_URL or CLIENT_URL must be set in production. Exiting.');
  process.exit(1);
}
const corsOrigins = allowedOrigins.length ? allowedOrigins : ['http://localhost:3000'];
console.log(`✅ Allowed CORS origins: ${corsOrigins.join(', ')}`);

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server / health-check requests (no origin)
    if (!origin || corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ────────────────────────────────────────────────
// 🔒 Rate Limiting
// ────────────────────────────────────────────────
function makeLimit(windowMinutes, max, message) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: message },
    skip: (req) => !PROD && req.ip === '::1', // skip localhost in dev
  });
}

// Global — 150 req / 15 min per IP
app.use('/api/', makeLimit(15, 150, 'Too many requests. Please try again later.'));

// Auth — strict limits
app.use('/api/v1/auth/login',           makeLimit(15, 10,  'Too many login attempts. Try again in 15 minutes.'));
app.use('/api/v1/auth/register',        makeLimit(60, 5,   'Too many accounts created from this IP.'));
app.use('/api/v1/auth/forgot-password', makeLimit(60, 5,   'Too many password reset requests. Try again in 1 hour.'));
app.use('/api/v1/auth/verify',          makeLimit(15, 10,  'Too many verification attempts.'));

// Public submission endpoints — prevent spam
app.use('/api/v1/contacts',             makeLimit(60, 10,  'Too many messages sent. Please try again later.'));
app.use('/api/v1/reviews',              makeLimit(60, 5,   'Too many reviews submitted. Please try again later.'));
// Product-review submits only — public GET list must not be throttled like a form.
app.use('/api/v1/products/:productId/reviews', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many reviews submitted. Please try again later.' },
  skip: (req) => req.method !== 'POST' || (!PROD && req.ip === '::1'),
}));

// Chat — public and unbounded by default, so lock it down
app.use('/api/v1/chat',                 makeLimit(15, 60,  'Too many chat messages. Please slow down.'));

// Domain search — calls paid Namecheap API
app.use('/api/v1/domain/search',        makeLimit(15, 30,  'Too many domain searches. Please try again later.'));
app.use('/api/v1/domain/check',         makeLimit(15, 30,  'Too many domain checks. Please try again later.'));

// Repair tracking — public endpoint, moderate limit
app.use('/api/v1/track',                makeLimit(15, 60,  'Too many tracking requests. Please try again later.'));

// ────────────────────────────────────────────────
// 📝 Logging (dev only)
// ────────────────────────────────────────────────
if (!PROD) app.use(morgan('dev'));

// ────────────────────────────────────────────────
// 🛡️ Prevent server info leakage
// ────────────────────────────────────────────────
app.disable('x-powered-by'); // already done by helmet but explicit

// ────────────────────────────────────────────────
// 📦 API Routes
// ────────────────────────────────────────────────
app.use('/api/v1/auth',     authRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/uploads',  uploadRoutes);
app.use('/api/v1/domain',   domainRoutes);
app.use('/api/v1/hosting',  hostingOrderRoutes);
app.use('/api/v1/admin',    adminRoutes);
app.use('/api/v1/reviews',  reviewRoutes);
app.use('/api/v1/posts',    postRoutes);
app.use('/api/v1/chat',     chatRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/services', serviceOrderRoutes);
app.use('/api/v1/pos',      posRoutes);
app.use('/api/v1/track',   trackRoutes);   // public — no auth
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/orders',   orderRoutes);
app.use('/api/v1/delivery-zones', deliveryZoneRoutes);
app.use('/api/v1/product-reviews', productReviewRoutes);

// ────────────────────────────────────────────────
// 🩺 Health Check
// ────────────────────────────────────────────────
const mongoose = require('mongoose');
app.get('/api/health', (req, res) => {
  const dbState  = mongoose.connection.readyState;
  const dbStatus = ['disconnected','connected','connecting','disconnecting'][dbState] || 'unknown';
  const ok = dbState === 1;
  res.status(ok ? 200 : 503).json({
    status:      ok ? 'OK' : 'DEGRADED',
    message:     ok ? 'EazWorld API is running' : 'API running but database not connected',
    database:    dbStatus,
    environment: ENV,
    timestamp:   new Date().toISOString(),
  });
});

// ────────────────────────────────────────────────
// 🧹 404 — Unknown Routes
// ────────────────────────────────────────────────
app.all('*', (req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// ────────────────────────────────────────────────
// ⚠️ Global Error Handler
// ────────────────────────────────────────────────
app.use(errorHandler);

// Process-level error handlers live in server.js — not here.

module.exports = app;
