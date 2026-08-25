const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  createShipment,
  getShipments,
  getShipment,
  advanceShipmentStage,
  attachOrdersToShipment,
} = require('../controllers/shipmentController');

const router = express.Router();

// Incoming stock is internal logistics — supplier names, container numbers and
// staff notes all live here, so the whole router is admin/staff only. Customers
// see the simplified version through their order's public tracking page.
router.use(protect, restrictTo('admin', 'superadmin', 'staff'));

router.route('/').get(getShipments).post(createShipment);
router.get('/:id', getShipment);
router.patch('/:id/stage', advanceShipmentStage);
router.post('/:id/orders', attachOrdersToShipment);

module.exports = router;
