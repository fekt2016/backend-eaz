const express = require('express');
const { uploadImage, upload } = require('../controllers/uploadController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// T33: 'staff' added — createProduct/updateProduct (productRoutes.js) and
// createPart/updatePart (posRoutes.js) already allow staff to manage the
// records this endpoint uploads images for; without it, staff hit a 403
// on the upload itself despite being allowed to save the record it feeds.
router.post('/', protect, restrictTo('admin', 'staff'), upload.single('image'), uploadImage);

module.exports = router;
