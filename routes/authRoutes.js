const express = require('express');
const {
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
  confirmPhoneChange,
  changePassword,
  enableTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
  verifyTwoFactor,
} = require('../controllers/authController');
const { protect, restrictTo } = require('../middleware/auth');
const { createUserSchema } = require('../validation/authSchema');
const { validate } = require('../middleware/validate');
const { createAddressSchema } = require('../validation/addressSchema');
const {
  getAddresses,
  createAddress,
  deleteAddress: removeAddress,
} = require('../controllers/addressController');

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
// T84 — binds the phone parked by PATCH /me, once its SMS PIN is proven.
router.post('/me/phone/confirm', protect, confirmPhoneChange);
// Deprecated address routes — kept so a client mid-deploy keeps working. They
// now delegate to the Address collection (routes/addressRoutes.js), so there is
// one store rather than two that can disagree. Remove once nothing calls them.
router.get('/me/addresses', protect, getAddresses);
router.post('/me/addresses', protect, validate(createAddressSchema), createAddress);
router.delete('/me/addresses/:addressId', protect, (req, _res, next) => {
  req.params.id = req.params.addressId;
  next();
}, removeAddress);
router.patch('/change-password', protect, changePassword);
router.post('/2fa/enable', protect, enableTwoFactor);
router.post('/2fa/confirm', protect, confirmTwoFactor);
router.post('/2fa/disable', protect, disableTwoFactor);
router.post('/2fa/verify', verifyTwoFactor);
router.get('/users', protect, restrictTo('admin'), getAllUsers);
router.post('/users',
  protect,
  restrictTo('admin'),
  (req, res, next) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid input.' });
    }
    req.body = parsed.data;
    next();
  },
  adminCreateUser,
);
// Admin user-detail page reads one user by id, so a bookmarked or refreshed
// /dashboard/users/:id works without having come through the list.
//
// restrictTo('admin') here matches its siblings below — and note it also admits
// superadmin, because restrictTo treats superadmin as satisfying every role
// check (middleware/auth.js:46). That is intended for these routes: superadmin
// manages users. It is called out because the same implicit behaviour is a trap
// elsewhere — see routes/addressRoutes.js, where denyRoles is used precisely
// because restrictTo would have let superadmin through.
router.get('/users/:id', protect, restrictTo('admin'), adminGetUser);
router.patch('/users/:id', protect, restrictTo('admin'), adminUpdateUser);
router.patch('/users/:id/block', protect, restrictTo('admin'), adminToggleBlock);
router.patch('/users/:id/password', protect, restrictTo('admin'), adminChangePassword);

module.exports = router;
