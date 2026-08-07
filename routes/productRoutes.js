const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getProducts,
  getProductBySlug,
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct
} = require('../controllers/productController');

const router = express.Router();

router.get('/', getProducts);
router.get('/all', protect, restrictTo('admin'), getAdminProducts);
router.post('/', protect, restrictTo('admin'), createProduct);
router.put('/:id', protect, restrictTo('admin'), updateProduct);
router.delete('/:id', protect, restrictTo('admin'), deleteProduct);
router.get('/:slug', getProductBySlug);

module.exports = router;
