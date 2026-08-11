const crypto = require('crypto');
const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');
const { sendWelcomeEmail, sendPasswordResetEmail, sendVerificationPin, sendTwoFactorPin } = require('../utils/email');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, validatePassword } = require('../utils/sanitize');

const ALLOWED_ROLES = ['user', 'admin', 'staff', 'cashier', 'technician', 'superadmin'];

// Generate a 6-digit PIN
const generatePin = () => String(Math.floor(100000 + Math.random() * 900000));

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

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered.'
      });
    }

    const pin = generatePin();
    const pinExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const user = await User.create({
      name,
      email,
      ...(phone ? { phone } : {}),
      password,
      isVerified: false,
      verifyPin: pin,
      verifyPinExpires: pinExpires,
    });

    await sendVerificationPin(user, pin).catch(() => {});

    res.status(201).json({
      success: true,
      data: {
        message: 'Account created. Please check your email for a 6-digit verification code.',
        email: user.email,
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
    const email = sanitizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.'
      });
    }

    const user = await User.findOne({ email }).select('+password +verifyPin +twoFactorEnabled');
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    // Block blocked accounts
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        error: user.blockedReason
          ? `Your account has been suspended: ${user.blockedReason}`
          : 'Your account has been suspended. Please contact support.',
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
      user.twoFactorPin = pin;
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
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res) => {
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
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

const verifyPin = async (req, res, next) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const { pin } = req.body;
    if (!email || !pin) {
      return res.status(400).json({ success: false, error: 'Email and PIN are required.' });
    }

    const user = await User.findOne({ email })
      .select('+verifyPin +verifyPinExpires +password');

    if (!user) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
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

    if (user.verifyPin !== pin.trim()) {
      return res.status(400).json({ success: false, error: 'Incorrect verification code.' });
    }

    // Mark verified and clear PIN
    user.isVerified = true;
    user.verifyPin = undefined;
    user.verifyPinExpires = undefined;
    await user.save({ validateBeforeSave: false });

    // Send welcome email
    sendWelcomeEmail(user).catch(() => {});

    // Log them in immediately
    user.password = undefined;
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

const resendPin = async (req, res, next) => {
  try {
    const email = sanitizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const user = await User.findOne({ email })
      .select('+verifyPin +verifyPinExpires');

    if (!user) {
      // Don't reveal if email exists
      return res.status(200).json({ success: true, data: { message: 'If that account exists, a new code has been sent.' } });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, error: 'Account is already verified. Please log in.' });
    }

    const pin = generatePin();
    user.verifyPin = pin;
    user.verifyPinExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    await sendVerificationPin(user, pin).catch(() => {});

    res.status(200).json({ success: true, data: { message: 'A new verification code has been sent to your email.' } });
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

const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      data: users
    });
  } catch (error) {
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
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name, phone: phone || '' },
      { new: true, runValidators: true }
    );
    res.json({ success: true, data: { user: { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone } } });
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
    user.twoFactorPin = pin;
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
    if (user.twoFactorPin !== pin?.trim()) {
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
    if (user.twoFactorPin !== pin.trim()) {
      return res.status(400).json({ success: false, error: 'Incorrect code.' });
    }
    user.twoFactorPin = undefined;
    user.twoFactorPinExpires = undefined;
    await user.save({ validateBeforeSave: false });
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

    const user = await User.create({
      name,
      email,
      ...(phone ? { phone } : {}),
      password,
      role,
      isVerified: true,
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
    res.json({ success: true, data: updated });
  } catch (error) {
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
    res.json({ success: true, data: targetUser });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  getAllUsers,
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
};
