/**
 * Minimal level-aware logger. Wraps console for now so it stays dependency-free
 * on the 512MB cPanel heap, but gives one place to control verbosity and to
 * later swap in a real transport (pino/winston) without touching call sites.
 *
 * Level is read from LOG_LEVEL (error < warn < info < debug); default 'info'.
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, sink, args) {
  if (LEVELS[level] <= current) sink(`[${level.toUpperCase()}]`, ...args);
}

const logger = {
  error: (...args) => emit('error', console.error, args),
  warn: (...args) => emit('warn', console.warn, args),
  info: (...args) => emit('info', console.log, args),
  debug: (...args) => emit('debug', console.log, args),
};

module.exports = logger;
