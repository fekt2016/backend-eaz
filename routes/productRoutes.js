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
router.get('/all', protect, restrictTo('admin', 'staff'), getAdminProducts);
router.post('/', protect, restrictTo('admin', 'staff'), createProduct);
router.put('/:id', protect, restrictTo('admin', 'staff'), updateProduct);
router.delete('/:id', protect, restrictTo('admin', 'staff'), deleteProduct);
router.get('/:slug', getProductBySlug);

module.exports = router;
