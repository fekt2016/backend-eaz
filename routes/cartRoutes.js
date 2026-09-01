const express = require('express');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  replaceCartSchema,
  mergeCartSchema,
  upsertItemSchema,
} = require('../validation/cartSchema');
const {
  getCart,
  replaceCart,
  mergeCart,
  upsertItem,
  removeItem,
  clearCart,
} = require('../controllers/cartController');

const router = express.Router();

router.use(protect);

router.get('/',        getCart);
router.put('/',        validate(replaceCartSchema), replaceCart);
router.patch('/merge', validate(mergeCartSchema), mergeCart);
router.patch('/items', validate(upsertItemSchema), upsertItem);
router.delete('/items/:lineId', removeItem);
router.delete('/',     clearCart);

module.exports = router;
