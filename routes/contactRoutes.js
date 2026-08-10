const express = require('express');
const { submitContact, getContacts, getContact, updateContact, deleteContact } = require('../controllers/contactController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Public
router.post('/', submitContact);

// Admin only
router.get('/',           protect, restrictTo('admin'), getContacts);
router.get('/:id',        protect, restrictTo('admin'), getContact);
router.patch('/:id',      protect, restrictTo('admin'), updateContact);
router.delete('/:id',     protect, restrictTo('admin'), deleteContact);

module.exports = router;
