const express = require('express');
const { submitContact, getContacts } = require('../controllers/contactController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.post('/', submitContact);
router.get('/', protect, restrictTo('admin'), getContacts);

module.exports = router;
