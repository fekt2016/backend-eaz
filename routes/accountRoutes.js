const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  upload,
  deactivateAccount,
  submitGhanaCard,
  getMyGhanaCard,
} = require('../controllers/accountController');

// A customer's own account settings. Every route is scoped to req.user inside
// the controller; nothing here takes an owner from the request.
router.use(protect);

router.post('/deactivate', deactivateAccount);

router.get('/ghana-card', getMyGhanaCard);
// The app's shared /uploads route is restrictTo('admin','staff'), so a customer
// cannot use it — and should not, because that route stores files publicly.
// Card images are uploaded here instead, straight to authenticated Cloudinary
// storage without touching disk.
router.post(
  '/ghana-card',
  upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]),
  submitGhanaCard,
);

module.exports = router;
