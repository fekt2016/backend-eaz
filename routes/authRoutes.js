const express = require('express');
const {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  getAllUsers
} = require('../controllers/authController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.patch('/reset-password/:token', resetPassword);
router.get('/me', protect, getMe);
router.get('/users', protect, restrictTo('admin'), getAllUsers);

module.exports = router;
