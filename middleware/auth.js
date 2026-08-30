const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized. Please log in.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // `+verifyPin` is required for needsVerification() below — the field is
    // `select: false`, and without it the check silently always passes.
    //
    // It MUST be in the same select string. Chaining
    // `.select('-a -b').select('+verifyPin')` does not merge — the second call
    // loses the inclusion, verifyPin comes back undefined, and the verification
    // gate below quietly never fires. Measured, not assumed.
    const user = await User.findById(decoded.id)
      .select('-password -resetPasswordToken -resetPasswordExpires +verifyPin');
    if (!user) {
      return res.status(401).json({ success: false, error: 'User no longer exists.' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ success: false, error: 'Your account has been suspended. Please contact support.' });
    }

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
      return res.status(401).json({
        success: false,
        error: 'Your session has ended. Please log in again.',
      });
    }

    // T88 — an account still waiting on its verification PIN reaches nothing.
    // Uses the SAME predicate as login rather than `!isVerified`: accounts
    // predating the PIN system have isVerified=false and no verifyPin, and login
    // has always let them through. Refusing those here would lock them out of
    // every endpoint while still letting them log in.
    //
    // /auth/verify-pin and /auth/resend-pin are public routes — they do not use
    // `protect` — so no allow-list is needed for the user to get unstuck.
    if (user.needsVerification()) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your account before continuing.',
        requiresVerification: true,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token. Please log in again.'
      });
    }
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

module.exports = { protect, restrictTo, denyRoles };
