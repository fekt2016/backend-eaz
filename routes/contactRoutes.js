const express = require('express');
const { submitContact, getContacts, getContact, updateContact, deleteContact } = require('../controllers/contactController');
const { protect, restrictTo } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { submitContactSchema } = require('../validation/contactSchema');

const router = express.Router();

// Public
// T126 — the schema existed in validation/ and was never wired to anything.
// It is wired now, but note it had to be REWRITTEN first: as written it declared
// only 4 of the 9 fields the controller reads, and `validate()` strips unknown
// keys, so plugging it in unchanged would have silently dropped phone,
// businessName, service, type and plan from every submission.
router.post('/', validate(submitContactSchema), submitContact);

// Admin only
router.get('/',           protect, restrictTo('admin'), getContacts);
router.get('/:id',        protect, restrictTo('admin'), getContact);
router.patch('/:id',      protect, restrictTo('admin'), updateContact);
router.delete('/:id',     protect, restrictTo('admin'), deleteContact);

module.exports = router;
