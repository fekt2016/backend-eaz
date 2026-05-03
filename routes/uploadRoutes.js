const express = require('express');
const { uploadImage, upload } = require('../controllers/uploadController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.post('/', protect, restrictTo('admin'), upload.single('image'), uploadImage);

module.exports = router;
