const express = require('express');
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.get('/',   getSettings);                               // public
router.patch('/', protect, restrictTo('admin'), updateSettings); // admin only

module.exports = router;
