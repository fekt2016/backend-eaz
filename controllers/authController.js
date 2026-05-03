const crypto = require('crypto');
const User = require('../models/User');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/email');

const getCookieMaxAge = () => {
  const val = process.env.JWT_COOKIE_EXPIRES_IN || '7d';
  const days = parseInt(String(val).replace(/d$/i, ''), 10) || 7;
  return days * 24 * 60 * 60 * 1000;
};

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: getCookieMaxAge()
};

const sendTokenResponse = (user, statusCode, res) => {
  const token = user.generateAuthToken();
  res.cookie('token', token, cookieOptions);
  res.status(statusCode).json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      token
    }
  });
};

const register = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required.'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters.'
      });
    }

    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered.'
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: (phone && String(phone).trim()) || '',
      password
    });

    sendWelcomeEmail(user).catch(() => {});
    sendTokenResponse(user, 201, res);
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.'
      });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
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

    user.password = undefined;
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 5 * 1000),
    httpOnly: true
  });
  res.status(200).json({ success: true, data: { message: 'Logged out.' } });
};

const forgotPassword = async (req, res, next) => {
  let user;
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required.'
      });
    }

    user = await User.findOne({ email: email.trim().toLowerCase() }).select('+resetPasswordToken +resetPasswordExpires');
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

const getMe = async (req, res) => {
  res.status(200).json({
    success: true,
    data: { user: req.user }
  });
};

module.exports = {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getMe
};
