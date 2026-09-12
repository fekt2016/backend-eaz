const jwt = require('jsonwebtoken');
const User = require('../models/User');

/*
 * One place decides whether a request has a usable session, so `protect` and
 * `attachUser` cannot drift apart. Returns the user, or a reason there is none.
 *
 * Reasons are the same information the HTTP refusals carried — `protect` maps
 * them to statuses, `attachUser` passes them through in a 200 body.
 */
const SESSION_OK = null;

async function resolveSession(req) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) return { user: null, reason: 'unauthenticated' };

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return { user: null, reason: 'invalid_token' };
    }
    throw err;
  }

  // `+verifyPin` is required for needsVerification() below — the field is
  // `select: false`, and without it the check silently always passes.
  //
  // It MUST be in the same select string. Chaining
  // `.select('-a -b').select('+verifyPin')` does not merge — the second call
  // loses the inclusion, verifyPin comes back undefined, and the verification
  // gate below quietly never fires. Measured, not assumed.
  const user = await User.findById(decoded.id)
    .select('-password -resetPasswordToken -resetPasswordExpires +verifyPin');
  if (!user) return { user: null, reason: 'no_such_user' };

  if (user.isBlocked) return { user: null, reason: 'blocked' };

  // T91 — a token minted before the account's tokenVersion was bumped is dead.
  // Logout, a password change and an admin reset all bump it, so the two
  // actions a user takes when they believe they are compromised now actually
  // cut the intruder off; previously a captured JWT survived both, for the
  // full 90-day expiry.
  //
  // A token with NO `tv` claim is treated as version 0, which is the model
  // default. That is deliberate: tokens issued before this shipped stay valid
  // rather than logging out every customer on deploy, and they die the moment
  // that account next logs out or changes its password. The residual risk is a
  // token stolen before the deploy on an account that then does neither.
  const tokenVersion = typeof decoded.tv === 'number' ? decoded.tv : 0;
  if (tokenVersion !== (user.tokenVersion || 0)) {
    return { user: null, reason: 'session_ended' };
  }

  // A self-deactivated account reaches nothing. Kept separate from isBlocked
  // above: that is a staff action against a user, this is the user's own
  // choice, and they deserve different wording — telling someone who
  // deactivated their own account that they have been "suspended" is wrong.
  if (user.isActive === false) return { user: null, reason: 'deactivated' };

  // T88 — an account still waiting on its verification PIN reaches nothing.
  // Uses the SAME predicate as login rather than `!isVerified`: accounts
  // predating the PIN system have isVerified=false and no verifyPin, and login
  // has always let them through. Refusing those here would lock them out of
  // every endpoint while still letting them log in.
  //
  // /auth/verify-pin and /auth/resend-pin are public routes — they do not use
  // `protect` — so no allow-list is needed for the user to get unstuck.
  if (user.needsVerification()) return { user: null, reason: 'unverified' };

  return { user, reason: SESSION_OK };
}

// reason -> the refusal `protect` has always sent. Statuses, wording and the
// extra flags are unchanged; they are only written down in one place now.
const REFUSALS = {
  unauthenticated: [401, { success: false, error: 'Not authorized. Please log in.' }],
  invalid_token:   [401, { success: false, error: 'Invalid or expired token. Please log in again.' }],
  no_such_user:    [401, { success: false, error: 'User no longer exists.' }],
  session_ended:   [401, { success: false, error: 'Your session has ended. Please log in again.' }],
  blocked:         [403, { success: false, error: 'Your account has been suspended. Please contact support.' }],
  deactivated:     [403, { success: false, error: 'This account has been deactivated. Please contact support to reactivate it.', deactivated: true }],
  unverified:      [403, { success: false, error: 'Please verify your account before continuing.', requiresVerification: true }],
};

const protect = async (req, res, next) => {
  try {
    const { user, reason } = await resolveSession(req);
    if (reason) {
      const [status, body] = REFUSALS[reason];
      return res.status(status).json(body);
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/*
 * T178 — for the one endpoint whose *question* is "is anyone signed in?".
 *
 * `protect` answers that with a 401, which is a correct status and a correct
 * answer — but Chrome logs every 401 as a console error, so every logged-out
 * visitor got one on every page view and the errors that matter were buried
 * under it. A browser's network log cannot be caught away in JS.
 *
 * So this resolves the same session with the same checks and never refuses:
 * the caller gets `req.user` or null, plus the reason, and decides for itself.
 * `protect` is untouched — every other route still 401s an anonymous caller.
 */
const attachUser = async (req, res, next) => {
  try {
    const { user, reason } = await resolveSession(req);
    req.user = user || null;
    req.authReason = reason;
    next();
  } catch (err) {
    next(err);
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    // superadmin has full access — it implicitly satisfies every role check.
    const allowed = req.user && (req.user.role === 'superadmin' || roles.includes(req.user.role));
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action.'
      });
    }
    next();
  };
};

const denyRoles = (...roles) => {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action.'
      });
    }
    next();
  };
};

module.exports = { protect, attachUser, restrictTo, denyRoles };
