const express = require('express');
const { protect } = require('../middleware/auth');
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
router.put('/',        replaceCart);
router.patch('/merge', mergeCart);
router.patch('/items', upsertItem);
router.delete('/items/:lineId', removeItem);
router.delete('/',     clearCart);

module.exports = router;
