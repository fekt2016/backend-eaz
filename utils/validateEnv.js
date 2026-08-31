/**
 * Validate required environment variables
 */
const validateEnv = () => {
  // T85 — NODE_ENV unset is not a neutral state here: `PROD` being false turns
  // OFF the auth cookie's Secure flag and its sameSite=strict, AND turns ON
  // err.stack in error responses. Both silently, together. ecosystem.config.js
  // On Spaceship Essential this comes from cPanel → Setup Node.js App
  // ("Application mode: Production"), so say so loudly if it is missing — this
  // is the last chance to notice before the app serves traffic with those
  // controls off.
  if (!process.env.NODE_ENV) {
    console.warn('⚠️  NODE_ENV is not set — running in NON-production mode.');
    console.warn('   The auth cookie will NOT be Secure/sameSite=strict, and error');
    console.warn('   responses WILL include stack traces. If this is a deployed');
    console.warn('   host, set Application mode to Production in cPanel → Setup Node.js App.');
  }

  // Check for MONGO_URL (or mongo_url / MONGO_URI)
  const mongoUrl = process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
  if (!mongoUrl) {
    console.error('❌ Missing required environment variable: MONGO_URL or mongo_url');
    console.error('Please check your .env or config.env file.');
    process.exit(1);
  }

  // If MONGO_URL contains <PASSWORD>, check for DATABASE_PASSWORD
  if (mongoUrl.includes('<PASSWORD>') && !process.env.DATABASE_PASSWORD && !process.env.database_password) {
    console.error('❌ MONGO_URL contains <PASSWORD> but DATABASE_PASSWORD is not set');
    console.error('Please set DATABASE_PASSWORD in your .env file.');
    process.exit(1);
  }

  // JWT_SECRET required for auth (no fallback in production)
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
    console.error('❌ Missing required environment variable: JWT_SECRET');
    console.error('Please set JWT_SECRET in your .env file (min 32 characters recommended).');
    process.exit(1);
  }
  if (process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET is too short (minimum 32 characters required).');
    console.error('Generate a strong secret with: openssl rand -hex 64');
    process.exit(1);
  }

  // PAYSTACK_SECRET is critical — without it the webhook silently fails
  if (!process.env.PAYSTACK_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ Missing PAYSTACK_SECRET — payments will not work in production');
      process.exit(1);
    } else {
      console.warn('⚠️  PAYSTACK_SECRET not set — payment webhooks will be rejected');
    }
  }

  // FRONTEND_URL is interpolated into the Paystack `callback_url` and into the
  // customer tracking links in services/notify.js. utils/frontendUrl.js returns
  // "" when it is unset in production — no throw, no warning — so Paystack gets
  // a RELATIVE callback_url and customers are texted a link with no host. T97
  // added this same fail-fast to the frontend's seo.js; this is the backend half
  // (T119), and it matters more because this one reaches payments.
  const siteUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || '').trim();
  if (!siteUrl) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ Missing required environment variable: FRONTEND_URL (or CLIENT_URL)');
      console.error('   Paystack callback_url and customer tracking links would be built from an empty string.');
      process.exit(1);
    } else {
      console.warn('⚠️  FRONTEND_URL not set — development falls back to http://localhost:3000');
    }
  } else if (!/^https?:\/\//i.test(siteUrl)) {
    // A host-relative value fails exactly the same way an empty one does.
    console.error(`❌ FRONTEND_URL must be an absolute http(s) URL — got "${siteUrl}"`);
    process.exit(1);
  }

  // Optional: Warn about recommended variables
  const recommendedVars = [
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL', // T62 — verified sender for every transactional email
    'CLOUDINARY_CLOUD_NAME',
    'SPACESHIP_API_KEY',
    'SPACESHIP_API_SECRET',
    'ANTHROPIC_API_KEY',
  ];

  const missingRecommended = recommendedVars.filter(varName => !process.env[varName]);
  if (missingRecommended.length > 0) {
    console.warn('⚠️  Missing recommended environment variables (some features may not work):');
    missingRecommended.forEach(varName => {
      console.warn(`   - ${varName}`);
    });
  }

  console.log('✅ Environment variables validated');
};

module.exports = { validateEnv };

