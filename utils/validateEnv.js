/**
 * Validate required environment variables
 */
const validateEnv = () => {
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

  // Optional: Warn about recommended variables
  const recommendedVars = [
    'PAYSTACK_SECRET',
    'RESEND_API_KEY',
    'CLOUDINARY_CLOUD_NAME',
    'NAMECHEAP_API_USER',
    'NAMECHEAP_API_KEY',
    'NAMECHEAP_CLIENT_IP',
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

