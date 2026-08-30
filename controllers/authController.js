const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');
const { sendWelcomeEmail, sendPasswordResetEmail, sendVerificationPin, sendTwoFactorPin } = require('../utils/email');
const { sendVerificationPinSms } = require('../services/notify');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, validatePassword } = require('../utils/sanitize');
const { log, logFromRequest, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { paginate }    = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');

const ALLOWED_ROLES = ['user', 'admin', 'staff', 'technician', 'superadmin'];

// Shared by login/resetPassword/verifyPin — a blocked account must not obtain a
// fresh session token through any of these flows, not just login.
const blockedAccountError = (user) =>
  user.blockedReason
    ? `Your account has been suspended: ${user.blockedReason}`
    : 'Your account has been suspended. Please contact support.';

// Generate a 6-digit PIN (crypto.randomInt — Math.random is a PRNG, not a CSPRNG)
const generatePin = () => String(crypto.randomInt(100000, 1000000));

// verifyPin/twoFactorPin are stored hashed, same pattern as resetPasswordToken —
// a DB read must not expose a usable code. Unsalted SHA-256 (not bcrypt): these
// are short-lived, low-entropy codes, and hashing here defends against exposure
// at rest, not online brute force (that's the still-open T46 rate-limit gap).
const hashPin = (pin) => crypto.createHash('sha256').update(pin).digest('hex');
const pinMatches = (storedHash, candidate) => {
  if (!storedHash || !candidate) return false;
  const candidateHash = hashPin(candidate);
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(candidateHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const getCookieMaxAge = () => {
  const val = process.env.JWT_COOKIE_EXPIRES_IN || '7d';
  const days = parseInt(String(val).replace(/d$/i, ''), 10) || 7;
  return days * 24 * 60 * 60 * 1000;
};

const PROD = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,                   // JS cannot access the cookie
  secure:   PROD,                   // HTTPS only in production
  sameSite: PROD ? 'strict' : 'lax', // strict in prod, lax in dev (allows redirects)
  maxAge:   getCookieMaxAge(),
  path:     '/',
};

const sendTokenResponse = (user, statusCode, res) => {
  const token = user.generateAuthToken();
  res.cookie('token', token, cookieOptions);
  // Do NOT include the raw token in the JSON body — the httpOnly cookie is the auth mechanism.
  // Sending it in the body would allow JS/XSS to steal it.
  res.status(statusCode).json({
    success: true,
    data: {
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email,
        role:  user.role,
      },
    },
  });
};

const register = async (req, res, next) => {
  try {
    const name = sanitizeName(req.body.name);
    const email = sanitizeEmail(req.body.email);
    const phone = sanitizePhone(req.body.phone);
    const { password } = req.body;

    // T17: registration accepts either identifier, but not neither — sanitizeEmail/
    // sanitizePhone already collapse '' and whitespace-only input to undefined.
    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({
        success: false,
        error: 'Name, password, and an email or phone number are required.'
      });
    }

    const pwError = validatePassword(password);
    if (pwError) {
      return res.status(400).json({ success: false, error: pwError });
    }

    if (email) {
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Email already registered.'
        });
      }
    }

    // Phone is optional, but when supplied it must be unique (canonical form
    // guaranteed by sanitizePhone above). The unique index is the race-safe
    // backstop; this pre-check gives a friendlier message.
    if (phone) {
      const phoneTaken = await User.findOne({ phone });
      if (phoneTaken) {
        return res.status(409).json({
          success: false,
          error: 'Phone number already registered.'
        });
      }
    }

    const pin = generatePin();
    const pinExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const user = await User.create({
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      password,
      isVerified: false,
      verifyPin: hashPin(pin),
      verifyPinExpires: pinExpires,
    });

    // Verification goes to whichever identifier was actually provided — never both.
    if (email) {
      await sendVerificationPin(user, pin).catch(() => {});
    } else {
      await sendVerificationPinSms(phone, name, pin).catch(() => {});
    }

    await log({
      actor: user,
      action: ACTIONS.USER_REGISTERED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email || user.phone,
      description: `New account registered (${user.email || user.phone})`,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: req.id,
    });

    res.status(201).json({
      success: true,
      data: {
        message: email
          ? 'Account created. Please check your email for a 6-digit verification code.'
          : 'Account created. Please check your phone for a 6-digit verification code.',
        email: user.email,
        phone: user.phone,
        requiresVerification: true,
      }
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered.'
      });
    }
    if (error.code === 11000 && error.keyPattern?.phone) {
      return res.status(409).json({
        success: false,
        error: 'Phone number already registered.'
      });
    }
    if (error.name === 'ValidationError') {
      const msg = error.message || Object.values(error.errors || {}).map((e) => e.message).join(', ');
      return res.status(400).json({
        success: false,
        error: msg
      });
    }
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const identifier = (req.body.email || req.body.phone || '').trim();
    const { password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email or phone and password are required.'
      });
    }

    // Match by whichever identifier the customer typed — email and/or phone.
    // Both are sanitized so +233 / spaces / casing never break the lookup.
    const email = sanitizeEmail(identifier);
    const phone = sanitizePhone(identifier);
    const lookups = [];
    if (/\S+@\S+\.\S+/.test(email)) lookups.push({ email });
    if (phone && phone.length >= 9) lookups.push({ phone });
    if (!lookups.length) {
      return res.status(400).json({ success: false, error: 'Enter a valid email or phone number.' });
    }

    const user = await User.findOne({ $or: lookups }).select('+password +verifyPin +twoFactorEnabled');
    if (!user) {
      await log({
        action: ACTIONS.AUTH_LOGIN_FAILED,
        resourceType: RESOURCES.AUTH,
        resourceId: identifier.toLowerCase(),
        description: `Failed login attempt for ${identifier}`,
        metadata: { reason: 'account_not_found' },
        status: 'failure',
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        requestId: req.id,
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.'
      });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      await log({
        action: ACTIONS.AUTH_LOGIN_FAILED,
        resourceType: RESOURCES.AUTH,
        resourceId: user._id,
        resourceName: user.email,
        description: `Failed login attempt for ${user.email}`,
        metadata: { reason: 'invalid_password' },
        status: 'failure',
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        requestId: req.id,
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid email or phone or password.'
      });
    }

    // Block blocked accounts
    if (user.isBlocked) {
      await log({
        action: ACTIONS.AUTH_LOGIN_FAILED,
        resourceType: RESOURCES.AUTH,
        resourceId: user._id,
        resourceName: user.email,
        description: `Blocked account attempted login (${user.email})`,
        metadata: { reason: 'account_blocked' },
        status: 'failure',
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        requestId: req.id,
      });
      return res.status(403).json({
        success: false,
        error: blockedAccountError(user),
      });
    }

    // Block unverified accounts — only applies to accounts registered
    // after the PIN verification system was introduced. Old accounts
    // (isVerified=false but no verifyPin set) are treated as verified.
    const needsVerification = user.isVerified === false && user.verifyPin;
    if (needsVerification) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your email before logging in.',
        requiresVerification: true,
        email: user.email,
      });
    }

    // If 2FA is enabled, send OTP instead of logging in
    if (user.twoFactorEnabled) {
      const pin = generatePin();
      user.twoFactorPin = hashPin(pin);
      user.twoFactorPinExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save({ validateBeforeSave: false });
      await sendTwoFactorPin(user, pin).catch(() => {});
      return res.status(200).json({
        success: true,
        data: {
          requiresTwoFactor: true,
          email: user.email,
          message: 'A verification code has been sent to your email.',
        }
      });
    }

    user.password = undefined;
    await log({
      actor: user,
      action: ACTIONS.AUTH_LOGIN,
      resourceType: RESOURCES.AUTH,
      resourceId: user._id,
      resourceName: user.email,
      description: `Logged in as ${user.email}`,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: req.id,
    });
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res) => {
  // Best-effort actor identity from the (possibly still valid) token cookie —
  // logout is unauthenticated by design, so we decode without verifying expiry.
  let actor = null;
  try {
    const token = req.cookies && req.cookies.token;
    if (token) {
      const payload = jwt.decode(token);
      if (payload && payload.id) {
        actor = { id: payload.id, email: payload.email, role: payload.role };
      }
    }
  } catch { /* ignore — logout should never fail */ }
  await log({
    actor,
    action: ACTIONS.AUTH_LOGOUT,
    resourceType: RESOURCES.AUTH,
    resourceId: actor ? actor.id : undefined,
    resourceName: actor ? actor.email : undefined,
    description: actor ? `Logged out (${actor.email})` : 'Logged out',
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
    requestId: req.id,
  });
  // Reuse full cookieOptions so secure/sameSite are consistent
  res.cookie('token', 'none', { ...cookieOptions, maxAge: 5000 });
  res.status(200).json({ success: true, data: { message: 'Logged out.' } });
};

const forgotPassword = async (req, res, next) => {
  let user;
  try {
    const email = sanitizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required.'
      });
    }

    user = await User.findOne({ email }).select('+resetPasswordToken +resetPasswordExpires');
    if (!user) {
      return res.status(200).json({
        success: true,
        data: { message: 'If that email exists, a reset link has been sent.' }
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const baseUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/auth/reset-password/${rawToken}`;

    await sendPasswordResetEmail(user, resetUrl).catch(() => {});

    return res.status(200).json({
      success: true,
      data: { message: 'If that email exists, a reset link has been sent.' }
    });
  } catch (err) {
    if (user) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false }).catch(() => {});
    }
    next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+password +resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token.'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, error: blockedAccountError(user) });
    }

    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters.'
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    user.password = undefined;
    await log({
      actor: user,
      action: ACTIONS.USER_PASSWORD_CHANGED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email,
      description: `Password reset via email link (${user.email})`,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: req.id,
    });
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

const verifyPin = async (req, res, next) => {
  try {
    // T17: a phone-only registrant has no email to submit here — accept
    // whichever identifier was used to register, same $or lookup as login.
    const identifier = (req.body.email || req.body.phone || '').trim();
    const { pin } = req.body;
    if (!identifier || !pin) {
      return res.status(400).json({ success: false, error: 'Email or phone and PIN are required.' });
    }

    const email = sanitizeEmail(identifier);
    const phone = sanitizePhone(identifier);
    const lookups = [];
    if (/\S+@\S+\.\S+/.test(email)) lookups.push({ email });
    if (phone && phone.length >= 9) lookups.push({ phone });
    if (!lookups.length) {
      return res.status(400).json({ success: false, error: 'Enter a valid email or phone number.' });
    }

    const user = await User.findOne({ $or: lookups })
      .select('+verifyPin +verifyPinExpires +password');

    if (!user) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, error: blockedAccountError(user) });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, error: 'Account is already verified. Please log in.' });
    }

    if (!user.verifyPin || !user.verifyPinExpires) {
      return res.status(400).json({ success: false, error: 'No verification code found. Please request a new one.' });
    }

    if (new Date() > user.verifyPinExpires) {
      return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new one.' });
    }

    if (!pinMatches(user.verifyPin, pin.trim())) {
      return res.status(400).json({ success: false, error: 'Incorrect verification code.' });
    }

    // Mark verified and clear PIN
    user.isVerified = true;
    user.verifyPin = undefined;
    user.verifyPinExpires = undefined;
    await user.save({ validateBeforeSave: false });

    // Send welcome email — only when the account actually has one (T17: phone-only
    // registrants have no email to send to).
    if (user.email) sendWelcomeEmail(user).catch(() => {});

    // Log them in immediately
    user.password = undefined;
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

const resendPin = async (req, res, next) => {
  try {
    // T17: same identifier flexibility as verifyPin — accept email or phone.
    const identifier = (req.body.email || req.body.phone || '').trim();
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Email or phone is required.' });
    }

    const email = sanitizeEmail(identifier);
    const phone = sanitizePhone(identifier);
    const lookups = [];
    if (/\S+@\S+\.\S+/.test(email)) lookups.push({ email });
    if (phone && phone.length >= 9) lookups.push({ phone });
    if (!lookups.length) {
      return res.status(400).json({ success: false, error: 'Enter a valid email or phone number.' });
    }

    const user = await User.findOne({ $or: lookups })
      .select('+verifyPin +verifyPinExpires');

    if (!user) {
      // Don't reveal if the account exists
      return res.status(200).json({ success: true, data: { message: 'If that account exists, a new code has been sent.' } });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, error: 'Account is already verified. Please log in.' });
    }

    const pin = generatePin();
    user.verifyPin = hashPin(pin);
    user.verifyPinExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    if (user.email) {
      await sendVerificationPin(user, pin).catch(() => {});
    } else {
      await sendVerificationPinSms(user.phone, user.name, pin).catch(() => {});
    }

    res.status(200).json({
      success: true,
      data: {
        message: user.email
          ? 'A new verification code has been sent to your email.'
          : 'A new verification code has been sent to your phone.',
      }
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res) => {
  res.status(200).json({
    success: true,
    data: { user: req.user }
  });
};

// ── Admin: list users ─────────────────────────────────────────────────────
// This was `User.find()` — every user, every field, no pagination, no lean —
// rendered into one response on a 512MB heap. Same class as T87.
//
// Search moved to the SERVER at the same time, and that pairing is the point:
// the list page filtered client-side over the full array, so paginating alone
// would have left search finding matches only on the page you happen to be on.
// That is not a visible error, it is a wrong answer, which is worse.
//
// Two shapes, because two callers want genuinely different things:
//   default      paginated page of full user documents, for the list table
//   ?compact=1   every user projected to { _id, name, email, role }, for the
//                Activity Log's actor dropdown, which needs a COMPLETE list —
//                a truncated dropdown silently hides actors. The projection is
//                what keeps that affordable: four fields instead of the whole
//                document.
const getAllUsers = async (req, res, next) => {
  try {
    const filter = {};

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { name:  { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
        { phone: { $regex: safe, $options: 'i' } },
      ];
    }
    if (req.query.role && req.query.role !== 'all') filter.role = req.query.role;
    if (req.query.blocked === 'true')  filter.isBlocked = true;
    if (req.query.blocked === 'false') filter.isBlocked = { $ne: true };

    if (req.query.compact === '1') {
      const users = await User.find(filter)
        .select('name email role')
        .sort({ name: 1 })
        .lean();
      return res.status(200).json({ success: true, data: { users, total: users.length, compact: true } });
    }

    const { page, limit, skip } = paginate(req.query);

    // blockedTotal is counted across the WHOLE filtered set, not the page — the
    // header shows "N registered · M blocked", and computing M from one page
    // would quietly report a different number on every page.
    const [users, total, blockedTotal] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
      User.countDocuments({ ...filter, isBlocked: true }),
    ]);

    res.status(200).json({
      success: true,
      data: { users, total, blockedTotal, page, limit },
    });
  } catch (error) {
    next(error);
  }
};

// ── Admin: one user by id ─────────────────────────────────────────────────
// Added for the admin user-detail page. The list endpoint returns every user,
// so the page could have filtered client-side — but that means the detail view
// only works if you arrived from the list, and a bookmarked or refreshed URL
// shows nothing. Fetching one user by id makes the page independent of how you
// got there.
//
// `.lean()` because this is a read-only projection, and the password field is
// already `select: false` on the schema so it cannot leak here.
const adminGetUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    // A malformed id is a client error, not a 500.
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    next(error);
  }
};

// ── Settings: Update profile ───────────────────────────────────────────────
const updateProfile = async (req, res, next) => {
  try {
    const name = sanitizeName(req.body.name);
    const phone = sanitizePhone(req.body.phone);
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required.' });
    }

    // When setting a non-empty phone, it must not belong to another account
    // (clearing the phone to '' is always allowed). The unique index backstops races.
    if (phone) {
      const phoneOwner = await User.findOne({ phone, _id: { $ne: req.user._id } });
      if (phoneOwner) {
        return res.status(409).json({ success: false, error: 'Phone number already in use by another account.' });
      }
    }

    // T84 — a phone change does not take effect here. Guest shop orders are
    // matched to an account by phone number, so writing an unproven number
    // would hand this account another customer's order history: their name,
    // address, items and totals. The uniqueness check above does not stop it,
    // because a guest has no account to collide with. The number is parked and
    // an SMS PIN sent; `confirmPhoneChange` binds it. Name still saves now.
    const current = await User.findById(req.user._id).select('+pendingPhone');
    const next = phone || '';
    const changing = next !== (current.phone || '');

    current.name = name;

    let phoneVerificationRequired = false;
    if (changing && next) {
      const pin = generatePin();
      current.pendingPhone = next;
      current.pendingPhonePin = hashPin(pin);
      current.pendingPhonePinExpires = new Date(Date.now() + 15 * 60 * 1000);
      await current.save();
      // Best-effort, exactly as registration treats it — a failed SMS must not
      // roll back the parked change, or the user cannot retry.
      await sendVerificationPinSms(next, name, pin).catch(() => {});
      phoneVerificationRequired = true;
    } else if (changing && !next) {
      // Clearing is not a claim on anything, so it needs no proof.
      current.phone = '';
      current.phoneVerifiedAt = null;
      current.pendingPhone = '';
      current.pendingPhonePin = undefined;
      current.pendingPhonePinExpires = undefined;
      await current.save();
    } else {
      await current.save();
    }

    const user = current;
    res.json({
      success: true,
      phoneVerificationRequired,
      data: { user: { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone } },
    });
  } catch (error) { next(error); }
};

// ── Settings: Confirm a phone change (T84) ─────────────────────────────────
// The second half of updateProfile's parked change: the PIN proves the account
// controls the number before it binds, and `phoneVerifiedAt` records that it
// was proven — which is what order matching keys on.
const confirmPhoneChange = async (req, res, next) => {
  try {
    const pin = String(req.body.pin || '').trim();
    if (!pin) {
      return res.status(400).json({ success: false, error: 'Verification code is required.' });
    }

    const user = await User.findById(req.user._id)
      .select('+pendingPhone +pendingPhonePin +pendingPhonePinExpires');

    if (!user.pendingPhone || !user.pendingPhonePin) {
      return res.status(400).json({ success: false, error: 'No phone change is awaiting confirmation.' });
    }
    if (!user.pendingPhonePinExpires || user.pendingPhonePinExpires < new Date()) {
      return res.status(400).json({ success: false, error: 'That code has expired. Please request the change again.' });
    }
    if (!pinMatches(user.pendingPhonePin, pin)) {
      return res.status(400).json({ success: false, error: 'Incorrect verification code.' });
    }

    // Re-check uniqueness at bind time, not just at request time — another
    // account could have taken the number while this PIN was outstanding.
    const owner = await User.findOne({ phone: user.pendingPhone, _id: { $ne: user._id } });
    if (owner) {
      return res.status(409).json({ success: false, error: 'Phone number already in use by another account.' });
    }

    user.phone = user.pendingPhone;
    user.phoneVerifiedAt = new Date();
    user.pendingPhone = '';
    user.pendingPhonePin = undefined;
    user.pendingPhonePinExpires = undefined;
    await user.save();

    res.json({
      success: true,
      data: { user: { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone } },
    });
  } catch (error) { next(error); }
};

// ── Settings: Change password ──────────────────────────────────────────────
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters.' });
    }
    const user = await User.findById(req.user._id).select('+password');
    const match = await user.comparePassword(currentPassword);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }
    user.password = newPassword;
    await user.save();
    await log({
      actor: user,
      action: ACTIONS.USER_PASSWORD_CHANGED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email,
      description: `Changed own password (${user.email})`,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: req.id,
    });
    res.json({ success: true, data: { message: 'Password changed successfully.' } });
  } catch (error) { next(error); }
};

// ── Settings: Enable 2FA ───────────────────────────────────────────────────
const enableTwoFactor = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.twoFactorEnabled) {
      return res.status(400).json({ success: false, error: '2FA is already enabled.' });
    }
    // Send confirmation PIN to verify it's really them
    const pin = generatePin();
    user.twoFactorPin = hashPin(pin);
    user.twoFactorPinExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });
    await sendTwoFactorPin(user, pin).catch(() => {});
    res.json({ success: true, data: { message: 'A verification code has been sent to your email to confirm 2FA setup.' } });
  } catch (error) { next(error); }
};

// ── Settings: Confirm enable 2FA with PIN ──────────────────────────────────
const confirmTwoFactor = async (req, res, next) => {
  try {
    const { pin } = req.body;
    const user = await User.findById(req.user._id).select('+twoFactorPin +twoFactorPinExpires');
    if (!user.twoFactorPin || new Date() > user.twoFactorPinExpires) {
      return res.status(400).json({ success: false, error: 'Code expired. Please request a new one.' });
    }
    if (!pinMatches(user.twoFactorPin, pin?.trim())) {
      return res.status(400).json({ success: false, error: 'Incorrect code.' });
    }
    user.twoFactorEnabled = true;
    user.twoFactorPin = undefined;
    user.twoFactorPinExpires = undefined;
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, data: { message: '2FA has been enabled on your account.' } });
  } catch (error) { next(error); }
};

// ── Settings: Disable 2FA ──────────────────────────────────────────────────
const disableTwoFactor = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: 'Password is required to disable 2FA.' });
    }
    const user = await User.findById(req.user._id).select('+password');
    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Incorrect password.' });
    }
    user.twoFactorEnabled = false;
    user.twoFactorPin = undefined;
    user.twoFactorPinExpires = undefined;
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, data: { message: '2FA has been disabled.' } });
  } catch (error) { next(error); }
};

// ── Login: Verify 2FA PIN ──────────────────────────────────────────────────
const verifyTwoFactor = async (req, res, next) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const { pin } = req.body;
    if (!email || !pin) {
      return res.status(400).json({ success: false, error: 'Email and code are required.' });
    }
    const user = await User.findOne({ email })
      .select('+twoFactorPin +twoFactorPinExpires');
    if (!user) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }
    if (!user.twoFactorPin || new Date() > user.twoFactorPinExpires) {
      return res.status(400).json({ success: false, error: 'Code expired. Please log in again.' });
    }
    if (!pinMatches(user.twoFactorPin, pin.trim())) {
      return res.status(400).json({ success: false, error: 'Incorrect code.' });
    }
    user.twoFactorPin = undefined;
    user.twoFactorPinExpires = undefined;
    await user.save({ validateBeforeSave: false });
    await log({
      actor: user,
      action: ACTIONS.AUTH_LOGIN,
      resourceType: RESOURCES.AUTH,
      resourceId: user._id,
      resourceName: user.email,
      description: `Logged in via 2FA as ${user.email}`,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: req.id,
    });
    sendTokenResponse(user, 200, res);
  } catch (error) { next(error); }
};

// ── Admin: Change any user's password ─────────────────────────────────────
const adminChangePassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }
    const targetUser = await User.findById(req.params.id).select('+password');
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    targetUser.password = newPassword;
    await targetUser.save();
    await logFromRequest(req, {
      action: ACTIONS.USER_PASSWORD_CHANGED,
      resourceType: RESOURCES.USER,
      resourceId: targetUser._id,
      resourceName: targetUser.email,
      description: `Admin reset password for ${targetUser.name} (${targetUser.email})`,
    });
    res.json({ success: true, data: { message: 'Password updated successfully.' } });
  } catch (error) {
    next(error);
  }
};

// ── Admin: Create a user with a role ─────────────────────────────────────
const adminCreateUser = async (req, res, next) => {
  try {
    const name = sanitizeName(req.body.name);
    const email = sanitizeEmail(req.body.email);
    const phone = sanitizePhone(req.body.phone);
    const { password } = req.body;
    const role = req.body.role || 'user';

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required.'
      });
    }

    const pwError = validatePassword(password);
    if (pwError) {
      return res.status(400).json({ success: false, error: pwError });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(', ')}.`
      });
    }

    // Only a superadmin can create another superadmin.
    if (role === 'superadmin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        error: 'Only a super admin can create another super admin.'
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered.'
      });
    }

    // Enforce phone uniqueness when supplied (unique index is the race-safe backstop).
    if (phone) {
      const phoneTaken = await User.findOne({ phone });
      if (phoneTaken) {
        return res.status(409).json({
          success: false,
          error: 'Phone number already in use by another account.'
        });
      }
    }

    const user = await User.create({
      name,
      email,
      ...(phone ? { phone } : {}),
      password,
      role,
      isVerified: true,
    });

    await logFromRequest(req, {
      action: ACTIONS.USER_CREATED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email,
      description: `Created user ${user.name} (${user.email}) with role ${role}`,
      metadata: { role },
    });

    res.status(201).json({
      success: true,
      data: {
        id:    user._id,
        name:  user.name,
        email: user.email,
        phone: user.phone || '',
        role:  user.role,
      },
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered.'
      });
    }
    if (error.code === 11000 && error.keyPattern?.phone) {
      return res.status(409).json({
        success: false,
        error: 'Phone number already in use by another account.'
      });
    }
    if (error.name === 'ValidationError') {
      const msg = error.message || Object.values(error.errors || {}).map((e) => e.message).join(', ');
      return res.status(400).json({
        success: false,
        error: msg
      });
    }
    next(error);
  }
};

// ── Admin: Update any user ─────────────────────────────────────────────────
const adminUpdateUser = async (req, res, next) => {
  try {
    const name = sanitizeName(req.body.name);
    const email = sanitizeEmail(req.body.email);
    const phone = sanitizePhone(req.body.phone);
    const { role } = req.body;
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Prevent admin from demoting themselves
    if (String(targetUser._id) === String(req.user._id) && role && role !== 'admin' && role !== 'superadmin') {
      return res.status(400).json({ success: false, error: 'You cannot remove your own admin role.' });
    }

    // When setting a non-empty phone, it must not belong to another account
    // (clearing the phone to '' is always allowed). The unique index backstops races.
    if (phone) {
      const phoneOwner = await User.findOne({ phone, _id: { $ne: targetUser._id } });
      if (phoneOwner) {
        return res.status(409).json({ success: false, error: 'Phone number already in use by another account.' });
      }
    }

    const updates = {};
    if (name)  updates.name  = name;
    if (email) updates.email = email;
    if (phone !== undefined) updates.phone = phone || '';
    if (role && ALLOWED_ROLES.includes(role)) {
      // Only a superadmin can assign the superadmin role.
      if (role === 'superadmin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only a super admin can assign the super admin role.' });
      }
      updates.role = role;
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

    // Audit: a role change is its own security-relevant event; other edits are
    // logged as a generic update with the changed fields.
    const roleChanged = role && updated.role !== targetUser.role;
    const changes = [
      ...(name && name !== targetUser.name ? [{ field: 'name', label: 'Name', before: targetUser.name, after: name }] : []),
      ...(email && email !== targetUser.email ? [{ field: 'email', label: 'Email', before: targetUser.email, after: email }] : []),
      ...(phone !== undefined && (phone || '') !== (targetUser.phone || '') ? [{ field: 'phone', label: 'Phone', before: targetUser.phone, after: phone }] : []),
      ...(roleChanged ? [{ field: 'role', label: 'Role', before: targetUser.role, after: updated.role }] : []),
    ];
    await logFromRequest(req, {
      action: roleChanged ? ACTIONS.USER_ROLE_CHANGED : ACTIONS.USER_UPDATED,
      resourceType: RESOURCES.USER,
      resourceId: updated._id,
      resourceName: updated.email,
      description: roleChanged
        ? `Changed ${updated.name}'s role from ${targetUser.role} to ${updated.role}`
        : `Updated user ${updated.name} (${updated.email})`,
      changes,
      metadata: { roleChanged },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.phone) {
      return res.status(409).json({ success: false, error: 'Phone number already in use by another account.' });
    }
    next(error);
  }
};

// ── Admin: Block / unblock a user ─────────────────────────────────────────
const adminToggleBlock = async (req, res, next) => {
  try {
    const { isBlocked } = req.body;
    const blockedReason = sanitizeText(req.body.blockedReason, 500);
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    // Prevent admin from blocking themselves
    if (String(targetUser._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, error: 'You cannot block your own account.' });
    }
    targetUser.isBlocked = Boolean(isBlocked);
    targetUser.blockedReason = isBlocked ? (blockedReason || '') : '';
    await targetUser.save({ validateBeforeSave: false });
    await logFromRequest(req, {
      action: isBlocked ? ACTIONS.USER_BLOCKED : ACTIONS.USER_UNBLOCKED,
      resourceType: RESOURCES.USER,
      resourceId: targetUser._id,
      resourceName: targetUser.email,
      description: isBlocked
        ? `Blocked ${targetUser.name} (${targetUser.email})${blockedReason ? ` — ${blockedReason}` : ''}`
        : `Unblocked ${targetUser.name} (${targetUser.email})`,
      changes: [{ field: 'isBlocked', label: 'Blocked', before: !isBlocked, after: Boolean(isBlocked) }],
    });
    res.json({ success: true, data: targetUser });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  confirmPhoneChange,
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  getAllUsers,
  adminGetUser,
  adminCreateUser,
  adminUpdateUser,
  adminToggleBlock,
  adminChangePassword,
  verifyPin,
  resendPin,
  updateProfile,
  changePassword,
  enableTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
  verifyTwoFactor,
  generatePin,
  hashPin,
  pinMatches,
};
