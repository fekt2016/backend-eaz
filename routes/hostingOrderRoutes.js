/**
 * Hosting orders API (base: /api/v1/hosting)
 *
 * Admin / external console contract (auth: JWT cookie or Authorization as used by `protect`):
 * - Snapshot counts: GET /orders/admin-summary (admin JWT)
 * - List (optionally filter + search): GET /orders?status=...&q=email|domain|reference|id&limit=...
 * - After verifying bank payment: PATCH /orders/:id  JSON body: { "status": "paid" }
 *   → sets paidAt, queues WHM provisioning; order becomes status "active" when provisioning succeeds.
 * - Re-run provisioning on a stuck paid order: PATCH same with { "status": "paid" } again (idempotent).
 * - Active orders: only PATCH to { "status": "cancelled" } or { "status": "failed" }.
 * - Buyer cPanel SSO (owner): GET /orders/:id/cpanel-login — only when status is "active" and cpanelUsername is set.
 */
const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { upload } = require('../controllers/uploadController');
const {
  getPlans,
  createOrder,
  getOrders,
  getAdminOverview,
  getHostingOrdersAdminSummary,
  getOrder,
  getOrderByReference,
  getInvoice,
  updateOrderStatus,
  uploadOrderProof,
  getCpanelLoginUrl,
  renewOrder,
  deleteOrder
} = require('../controllers/hostingOrderController');

const router = express.Router();

router.get('/plans', getPlans);
router.post('/orders', protect, createOrder);
router.get('/orders', protect, getOrders);
router.get('/orders/admin-overview', protect, restrictTo('admin'), getAdminOverview);
router.get('/orders/admin-summary', protect, restrictTo('admin'), getHostingOrdersAdminSummary);
router.get('/orders/by-reference/:reference', protect, getOrderByReference);
router.get('/orders/:id/invoice', protect, getInvoice);
router.get('/orders/:id/cpanel-login', protect, getCpanelLoginUrl);
router.get('/orders/:id', protect, getOrder);
router.post('/orders/:id/proof', protect, upload.single('proof'), uploadOrderProof);
router.post('/orders/:id/renew', protect, renewOrder);
router.patch('/orders/:id', protect, restrictTo('admin'), updateOrderStatus);
router.delete('/orders/:id', protect, restrictTo('admin'), deleteOrder);

module.exports = router;
