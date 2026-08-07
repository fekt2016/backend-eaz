const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getDeliveryZones,
  getAllZones,
  createDeliveryZone,
  updateDeliveryZone,
  deleteDeliveryZone
} = require('../controllers/deliveryZoneController');

const router = express.Router();

router.get('/', getDeliveryZones);
router.get('/all', protect, restrictTo('admin'), getAllZones);
router.post('/', protect, restrictTo('admin'), createDeliveryZone);
router.put('/:id', protect, restrictTo('admin'), updateDeliveryZone);
router.delete('/:id', protect, restrictTo('admin'), deleteDeliveryZone);

module.exports = router;
