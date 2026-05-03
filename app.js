const express = require('express');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

// Load environment variables early
dotenv.config({ path: '.env' });

// Import custom middleware & routes
const { errorHandler } = require('./middleware/errorHandler');
const { protect, restrictTo } = require('./middleware/auth');
const authRoutes = require('./routes/authRoutes');
const contactRoutes = require('./routes/contactRoutes');
const projectRoutes = require('./routes/projectRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const domainRoutes = require('./routes/domainRoutes');
const hostingOrderRoutes = require('./routes/hostingOrderRoutes');

const app = express();

// ────────────────────────────────────────────────
// 🌐 Environment & Health Logging
// ────────────────────────────────────────────────
const ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 5000;
console.log(`\n🚀 [EazWorld API] Starting server in ${ENV.toUpperCase()} mode`);

// ────────────────────────────────────────────────
// 🧱 Security Middleware
// ────────────────────────────────────────────────
app.use(helmet()); // secure HTTP headers
app.use(xss()); // prevent XSS
app.use(mongoSanitize()); // sanitize query/body from NoSQL injection

// ────────────────────────────────────────────────
// ⚙️ Body Parsing & Cookies
// ────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ────────────────────────────────────────────────
// 🔒 Rate Limiting
// ────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many requests from this IP, please try again later.',
  },
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { status: 'fail', message: 'Too many login attempts. Try again later.' },
});
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { status: 'fail', message: 'Too many reset requests. Try again later.' },
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/forgot-password', forgotLimiter);

// ────────────────────────────────────────────────
// 🌍 CORS Configuration
// ────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  'http://localhost:3000',  // Next.js default
  'http://localhost:5173',  // Vite default
].filter(Boolean);
const corsOrigin = allowedOrigins.length > 0 ? allowedOrigins : ['http://localhost:3000', 'http://localhost:5173'];
console.log(`✅ Allowed CORS origins: ${corsOrigin.join(', ')}`);
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));

// ────────────────────────────────────────────────
// 📝 Logging (only in development)
// ────────────────────────────────────────────────
if (ENV === 'development') {
  app.use(morgan('dev'));
}

// ────────────────────────────────────────────────
// 📦 API Routes
// ────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/uploads', uploadRoutes);
app.use('/api/v1/domain', domainRoutes);
app.use('/api/v1/hosting', hostingOrderRoutes);

// ────────────────────────────────────────────────
// 🩺 Health Check Route (includes DB connection status)
// ────────────────────────────────────────────────
const mongoose = require('mongoose');

app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : dbState === 3 ? 'disconnecting' : 'disconnected';
  const ok = dbState === 1;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'OK' : 'DEGRADED',
    message: ok ? 'EazWorld API is running' : 'API running but database not connected',
    database: dbStatus,
    environment: ENV,
    timestamp: new Date().toISOString(),
  });
});

// ────────────────────────────────────────────────
// ⚠️ Global Error Handler
// ────────────────────────────────────────────────
app.use(errorHandler);

// ────────────────────────────────────────────────
// 🧹 Handle Undefined Routes
// ────────────────────────────────────────────────
app.all('*', (req, res) => {
  res.status(404).json({
    status: 'fail',
    message: `Route ${req.originalUrl} not found on this server.`,
  });
});

// ────────────────────────────────────────────────
// 🧩 Graceful Shutdown Helper
// ────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Promise Rejection:', err.name, err.message);
  console.error('🔥 Shutting down gracefully...');
  process.exit(1);
});

module.exports = app;
