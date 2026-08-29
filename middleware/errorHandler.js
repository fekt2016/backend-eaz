const PROD = process.env.NODE_ENV === 'production';

const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars

  // ── Zod validation errors ──────────────────────────────────────────────────
  if (err.name === 'ZodError') {
    // Prefer `issues` (the canonical array of field problems) and fall back to
    // `errors`. Some Zod versions only populate `issues` for issues raised via
    // `ctx.addIssue` (superRefine), leaving the `errors` alias empty — relying
    // on `errors` alone would swallow the message and return a blank array.
    const issues = err.issues && err.issues.length ? err.issues : (err.errors || []);
    const fieldErrors = issues.map((e) => ({
      field:   (e.path || []).join('.'),
      message: e.message,
    }));
    return res.status(400).json({ success: false, error: 'Validation failed', errors: fieldErrors });
  }

  // ── Mongoose validation errors ─────────────────────────────────────────────
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path, message: e.message,
    }));
    return res.status(400).json({ success: false, error: 'Validation failed', errors });
  }

  // ── Mongoose duplicate key ─────────────────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ success: false, error: `${field} already exists.` });
  }

  // ── Mongoose cast error (invalid ObjectId) ─────────────────────────────────
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: 'Invalid ID format.' });
  }

  // ── JWT errors ─────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, error: 'Invalid token. Please log in again.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
  }

  // ── CORS error ─────────────────────────────────────────────────────────────
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ success: false, error: 'Cross-origin request blocked.' });
  }

  // ── Generic / unhandled ────────────────────────────────────────────────────
  const statusCode = err.statusCode || err.status || 500;

  // Never expose internal error details in production
  const message = (PROD && statusCode === 500)
    ? 'Something went wrong. Please try again later.'
    : (err.message || 'Internal Server Error');

  // Log 500s server-side (but not to client)
  if (statusCode >= 500) {
    console.error(`[${req.id || '?'}] ${req.method} ${req.originalUrl} → ${statusCode}:`, err.message);
    if (!PROD) console.error(err.stack);
  }

  res.status(statusCode).json({
    success: false,
    error:   message,
    // Only include stack trace in development, never in production
    ...((!PROD) && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
