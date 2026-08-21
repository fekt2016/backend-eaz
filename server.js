const mongoose = require("mongoose");
const dotenv = require("dotenv");
const { validateEnv } = require("./utils/validateEnv");
const app = require("./app");

// Load environment variables FIRST
dotenv.config({ path: "./.env" });

// CRITICAL: Force memory settings for cPanel (if not already set)
// cPanel often ignores NODE_OPTIONS, so we check and warn
const v8 = require('v8');
const heapLimit = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;

// Log Node.js options for debugging (especially important for cPanel)
// Low memory configuration: 512MB heap
const MIN_REQUIRED_MEMORY = 400; // Minimum 400MB required
const MAX_EXPECTED_MEMORY = 640; // 640MB - if above this, flags likely not applied
const TARGET_MEMORY = 512; // 512MB target

console.log(`📋 Node.js version: ${process.version}`);
console.log(`📋 Current max memory: ${heapLimit.toFixed(2)}MB`);

// Check memory limit first - this is the real indicator
// If memory is correct, start.sh is working (even if NODE_OPTIONS env var isn't set)
const memoryIsCorrect = heapLimit >= MIN_REQUIRED_MEMORY && heapLimit <= MAX_EXPECTED_MEMORY;

if (process.env.NODE_OPTIONS) {
  console.log(`✅ NODE_OPTIONS: ${process.env.NODE_OPTIONS}`);
} else if (!memoryIsCorrect) {
  // Only warn about NODE_OPTIONS if memory is ALSO wrong
  // If memory is correct, start.sh is working (it sets flags directly, not via env var)
  console.warn(`⚠️  NODE_OPTIONS environment variable not set`);
  console.warn(`⚠️  However, if memory limit is correct, start.sh is working correctly.`);
}

// MEMORY OPTIMIZATION: Check if memory flags are not applied (heap too high)
// Expected heap limit should be ~512MB, but default Node.js gives ~4GB


// Validate environment variables
validateEnv();

// Handle uncaught exceptions (synchronous errors)
process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT EXCEPTION! Shutting down...");
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

// Handle unhandled promise rejections (asynchronous errors)
process.on("unhandledRejection", (err) => {
  console.error("❌ UNHANDLED REJECTION! Shutting down...");
  console.error(err.name, err.message);
  console.error(err.stack);
  // Give server time to finish current requests
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

const startServer = async () => {
  try {
    // Validate required environment variables (support MONGO_URL, mongo_url, MONGO_URI)
    const mongoUrlRaw = process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
    if (!mongoUrlRaw) {
      throw new Error("MONGO_URL (or mongo_url) is not defined in environment variables");
    }

    const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
    const db = mongoUrlRaw.includes('<PASSWORD>') && dbPassword
      ? mongoUrlRaw.replace('<PASSWORD>', dbPassword)
      : mongoUrlRaw;
    
    // MongoDB connection with better error handling
    // Reduced maxPoolSize to 5 for lower memory usage (was 10)
    const conn = await mongoose.connect(db, {
      maxPoolSize: 5, // Reduced from 10 to save memory
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    });
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

    // Start Express server
    const server = app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on http://${HOST}:${PORT}`);
    });

    // Run renewal job once at startup, then every 24 hours
    try {
      const { runRenewalJob } = require('./utils/renewalJob');
      runRenewalJob().catch(() => {});
      setInterval(() => runRenewalJob().catch(() => {}), 24 * 60 * 60 * 1000);
      console.log('🔄 Renewal job scheduled (runs every 24h)');
    } catch (err) {
      console.warn('⚠️  Renewal job could not be loaded:', err.message);
    }

    // Uncollected device reminder — runs once at startup then every 12 hours
    try {
      const { runReminderJob } = require('./services/reminderJob');
      // Small delay so DB is fully ready
      setTimeout(() => runReminderJob().catch(() => {}), 10_000);
      setInterval(() => runReminderJob().catch(() => {}), 12 * 60 * 60 * 1000);
      console.log('🔔 Uncollected device reminder job scheduled (runs every 12h)');
    } catch (err) {
      console.warn('⚠️  Reminder job could not be loaded:', err.message);
    }

    // Scheduled blog publishing — runs shortly after startup then hourly, so a
    // post scheduledFor a given time goes live within the hour.
    try {
      const { runScheduledPublishJob } = require('./utils/scheduledPublishJob');
      setTimeout(() => runScheduledPublishJob().catch(() => {}), 15_000);
      setInterval(() => runScheduledPublishJob().catch(() => {}), 60 * 60 * 1000);
      console.log('🗓️  Scheduled blog publish job scheduled (runs hourly)');
    } catch (err) {
      console.warn('⚠️  Scheduled publish job could not be loaded:', err.message);
    }

    // Initialize Socket.io (optional - only if socket server exists)
    try {
      // Optional module — guarded by the MODULE_NOT_FOUND check below; doesn't exist yet.
      // eslint-disable-next-line n/no-missing-require
      const { initializeSocket } = require("./socket/socketServer");
      const io = initializeSocket(server);
      app.set("io", io); // Make io available to routes/controllers
      console.log(`🔌 Socket.io initialized`);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.log(`ℹ️  Socket.io server not found - continuing without real-time features`);
      } else {
        console.warn(`⚠️  Socket.io initialization failed:`, error.message);
      }
    }
    
    // MEMORY OPTIMIZATION: Use dedicated memory monitoring utility
    // This provides better memory tracking and only logs when needed
    let memoryMonitorInterval = null;
    if (process.env.NODE_ENV === "production") {
      try {
        // Optional module — guarded by the MODULE_NOT_FOUND check below; doesn't exist yet.
        // eslint-disable-next-line n/no-missing-require
        const { startMemoryMonitoring } = require("./utils/memoryMonitor");
        // Monitor every 10 minutes, log only when heap exceeds 1.5GB
        // This reduces log noise and memory overhead from frequent monitoring
        memoryMonitorInterval = startMemoryMonitoring({
          intervalMs: 600000, // 10 minutes (reduced from 1 minute to save CPU/memory)
          heapThresholdMB: 400, // 400MB threshold (75% of 512MB limit)
          logAlways: false, // Only log when threshold exceeded
        });
        console.log("✅ Memory monitoring started (logs every 10 minutes or when threshold exceeded)");
      } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
          console.log(`ℹ️  Memory monitor not found - continuing without memory monitoring`);
        } else {
          console.warn(`⚠️  Memory monitor initialization failed:`, error.message);
        }
      }
    }
    
    // Graceful shutdown
    let shutdownTimeout = null;
    const shutdown = async (signal) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);
      
      // Clear memory monitoring interval
      if (memoryMonitorInterval) {
        clearInterval(memoryMonitorInterval);
        memoryMonitorInterval = null;
      }
      
      // Stop accepting new connections
      server.close(() => {
        console.log("✅ HTTP server closed.");
        
        // Close database connection
        mongoose.connection.close(false).then(() => {
          console.log("✅ MongoDB connection closed.");
          // Clear shutdown timeout if still pending
          if (shutdownTimeout) {
            clearTimeout(shutdownTimeout);
          }
          process.exit(0);
        }).catch((err) => {
          console.error("❌ Error closing MongoDB connection:", err);
          if (shutdownTimeout) {
            clearTimeout(shutdownTimeout);
          }
          process.exit(1);
        });
      });
      
      // Force close after 10 seconds
      shutdownTimeout = setTimeout(() => {
        console.error("❌ Forced shutdown after timeout");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error("❌ Server startup error:", err);
    process.exit(1);
  }
};

startServer();
