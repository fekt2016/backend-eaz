const express = require('express');
const {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  getAllUsers,
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
} = require('../controllers/authController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.post('/register', register);
router.post('/verify-pin', verifyPin);
router.post('/resend-pin', resendPin);
router.post('/login', login);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.patch('/reset-password/:token', resetPassword);
router.get('/me', protect, getMe);
router.patch('/me', protect, updateProfile);
router.patch('/change-password', protect, changePassword);
router.post('/2fa/enable', protect, enableTwoFactor);
router.post('/2fa/confirm', protect, confirmTwoFactor);
router.post('/2fa/disable', protect, disableTwoFactor);
router.post('/2fa/verify', verifyTwoFactor);
router.get('/users', protect, restrictTo('admin'), getAllUsers);
router.patch('/users/:id', protect, restrictTo('admin'), adminUpdateUser);
router.patch('/users/:id/block', protect, restrictTo('admin'), adminToggleBlock);
router.patch('/users/:id/password', protect, restrictTo('admin'), adminChangePassword);

module.exports = router;
