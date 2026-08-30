/**
 * Account self-service: deactivation and Ghana Card identity verification.
 *
 * Kept out of authController, which is already ~1100 lines and covers login,
 * registration, 2FA, password reset and admin user management. These are a
 * distinct concern with distinct security properties — in particular the Ghana
 * Card handling below, which deliberately does NOT behave like the rest of the
 * app's uploads.
 */
const multer = require('multer');
const { cloudinary } = require('../config/cloudinary');
const User = require('../models/User');
const { log, logFromRequest, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { sanitizeText } = require('../utils/sanitize');

// Ghana Card numbers are GHA-XXXXXXXXX-X (9 digits, then a check digit).
const GHANA_CARD_RE = /^GHA-\d{9}-\d$/;

// In-memory, because the file goes straight to Cloudinary and never touches
// disk — an ID document should not linger in a temp directory on the server.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp)$/.test(file.mimetype)) {
      return cb(new Error('Card images must be JPEG, PNG or WebP.'));
    }
    cb(null, true);
  },
});

/**
 * Upload with `type: 'authenticated'`.
 *
 * Every other upload in this app lands in a public Cloudinary folder, where
 * anyone holding the URL can fetch it forever. That is acceptable for a product
 * photo and not for a national ID card. `authenticated` delivery means the
 * stored public_id is useless on its own — viewing requires a signed URL, which
 * only the admin endpoint below will mint, and only briefly.
 */
function uploadAuthenticated(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, type: 'authenticated', resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

// ── POST /api/v1/account/deactivate ───────────────────────────────────────
// Reversible by owner decision: orders and history are untouched, and an admin
// can switch the account back on. Requires the current password, because this
// ends every session the account has and someone who has walked away from an
// unlocked laptop should not be able to do it.
const deactivateAccount = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: 'Your password is required to deactivate.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Password is incorrect.' });
    }

    // An admin deactivating themselves would lock the shop out of its own
    // administration if they were the only one.
    if (['admin', 'superadmin'].includes(user.role)) {
      return res.status(400).json({
        success: false,
        error: 'Administrator accounts cannot be self-deactivated. Ask another administrator.',
      });
    }

    user.isActive = false;
    user.deactivatedAt = new Date();
    user.deactivationReason = sanitizeText(req.body.reason, 500) || '';
    // T91 — end every session now, not when the token happens to expire.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save({ validateBeforeSave: false });

    await log({
      actor: user,
      action: ACTIONS.USER_UPDATED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email,
      description: `Deactivated own account (${user.email})`,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: req.id,
    });

    res.clearCookie('token', { path: '/' });
    res.status(200).json({
      success: true,
      data: { message: 'Your account has been deactivated. Contact support to reactivate it.' },
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/account/ghana-card ───────────────────────────────────────
const submitGhanaCard = async (req, res, next) => {
  try {
    const number = String(req.body.number || '').trim().toUpperCase();
    if (!GHANA_CARD_RE.test(number)) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid Ghana Card number in the form GHA-123456789-0.',
      });
    }

    const front = req.files && req.files.front && req.files.front[0];
    const back = req.files && req.files.back && req.files.back[0];
    if (!front || !back) {
      return res.status(400).json({ success: false, error: 'Both the front and back of the card are required.' });
    }

    const user = await User.findById(req.user._id).select('+ghanaCard.number');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    if (user.ghanaCard.status === 'approved') {
      return res.status(409).json({
        success: false,
        error: 'Your identity is already verified. Contact support to change your card details.',
      });
    }

    const [frontUp, backUp] = await Promise.all([
      uploadAuthenticated(front.buffer, 'eazworld/ghana-cards'),
      uploadAuthenticated(back.buffer, 'eazworld/ghana-cards'),
    ]);

    user.ghanaCard.number = number;
    user.ghanaCard.frontImageId = frontUp.public_id;
    user.ghanaCard.backImageId = backUp.public_id;
    user.ghanaCard.status = 'pending';
    user.ghanaCard.submittedAt = new Date();
    user.ghanaCard.reviewedAt = null;
    user.ghanaCard.reviewedBy = null;
    user.ghanaCard.rejectionReason = '';
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      data: {
        status: 'pending',
        maskedNumber: user.maskedGhanaCardNumber(),
        submittedAt: user.ghanaCard.submittedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/account/ghana-card ────────────────────────────────────────
// The user's own status. Never returns the full number or an image URL.
const getMyGhanaCard = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+ghanaCard.number');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    res.status(200).json({
      success: true,
      data: {
        status: user.ghanaCard.status,
        maskedNumber: user.maskedGhanaCardNumber(),
        submittedAt: user.ghanaCard.submittedAt,
        reviewedAt: user.ghanaCard.reviewedAt,
        rejectionReason: user.ghanaCard.rejectionReason,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/admin/users/:id/ghana-card ────────────────────────────────
// The reviewer's view. Unlike every other read of this field, it returns the
// FULL card number — manual review means comparing what the user typed against
// what is printed on the card, and a masked number cannot be compared. That is
// exactly why it is admin-only, on its own endpoint rather than folded into
// adminGetUser, and logged: a full national ID number leaving the database
// should be a deliberate, attributable act rather than a side effect of opening
// a user's profile.
const getGhanaCardForReview = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('+ghanaCard.number name email');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    if (user.ghanaCard.status === 'none') {
      return res.status(200).json({ success: true, data: { status: 'none' } });
    }

    await logFromRequest(req, {
      action: ACTIONS.USER_UPDATED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email,
      description: `Opened Ghana Card details for ${user.name}`,
    });

    res.status(200).json({
      success: true,
      data: {
        status: user.ghanaCard.status,
        number: user.ghanaCard.number,
        hasFront: Boolean(user.ghanaCard.frontImageId),
        hasBack: Boolean(user.ghanaCard.backImageId),
        submittedAt: user.ghanaCard.submittedAt,
        reviewedAt: user.ghanaCard.reviewedAt,
        rejectionReason: user.ghanaCard.rejectionReason,
      },
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    next(error);
  }
};

// ── PATCH /api/v1/admin/users/:id/ghana-card ──────────────────────────────
const reviewGhanaCard = async (req, res, next) => {
  try {
    const { decision } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'Decision must be "approved" or "rejected".' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    if (user.ghanaCard.status !== 'pending') {
      return res.status(409).json({ success: false, error: 'There is no pending submission to review.' });
    }

    user.ghanaCard.status = decision;
    user.ghanaCard.reviewedAt = new Date();
    user.ghanaCard.reviewedBy = req.user._id;
    user.ghanaCard.rejectionReason =
      decision === 'rejected' ? (sanitizeText(req.body.reason, 500) || 'Not specified') : '';
    await user.save({ validateBeforeSave: false });

    await logFromRequest(req, {
      action: ACTIONS.USER_UPDATED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email,
      description: `Ghana Card ${decision} for ${user.name} (${user.email})`,
      metadata: { ghanaCardDecision: decision },
    });

    res.status(200).json({
      success: true,
      data: { status: user.ghanaCard.status, reviewedAt: user.ghanaCard.reviewedAt },
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    next(error);
  }
};

// ── GET /api/v1/admin/users/:id/ghana-card/image/:side ────────────────────
// Mints a SHORT-LIVED signed URL rather than returning a stored link. The
// images are `type: 'authenticated'` on Cloudinary, so the public_id alone
// cannot be fetched — this is the only way to see them, it is admin-only, and
// each link expires in five minutes.
const getGhanaCardImageUrl = async (req, res, next) => {
  try {
    const side = req.params.side;
    if (!['front', 'back'].includes(side)) {
      return res.status(400).json({ success: false, error: 'Side must be "front" or "back".' });
    }

    const user = await User.findById(req.params.id).select('ghanaCard name email');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const publicId = side === 'front' ? user.ghanaCard.frontImageId : user.ghanaCard.backImageId;
    if (!publicId) {
      return res.status(404).json({ success: false, error: 'No card image on file.' });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    const url = cloudinary.url(publicId, {
      type: 'authenticated',
      resource_type: 'image',
      sign_url: true,
      secure: true,
      expires_at: expiresAt,
    });

    await logFromRequest(req, {
      action: ACTIONS.USER_UPDATED,
      resourceType: RESOURCES.USER,
      resourceId: user._id,
      resourceName: user.email,
      description: `Viewed Ghana Card (${side}) for ${user.name}`,
      metadata: { side },
    });

    res.status(200).json({ success: true, data: { url, expiresAt } });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    next(error);
  }
};

module.exports = {
  upload,
  deactivateAccount,
  submitGhanaCard,
  getMyGhanaCard,
  getGhanaCardForReview,
  reviewGhanaCard,
  getGhanaCardImageUrl,
};
