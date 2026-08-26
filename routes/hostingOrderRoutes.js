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
 * - Manual builds (T68): GET /orders/awaiting-provisioning lists paid VPS/Cloud/Email
 *   orders auto-provisioning skipped; PATCH /orders/:id/mark-provisioned with
 *   { username, password, domain? } activates them and emails credentials (idempotent).
 * - Buyer cPanel SSO (owner): GET /orders/:id/cpanel-login — only when status is "active" and cpanelUsername is set.
 */
const express = require('express');
const { protect, restrictTo, denyRoles } = require('../middleware/auth');
const { upload } = require('../controllers/uploadController');
const {
  getPlans,
  createOrder,
  staffCreateHostingAccount,
  getOrders,
  getAwaitingProvisioning,
  markProvisioned,
  getAdminOverview,
  getHostingOrdersAdminSummary,
  getOrder,
  getOrderByReference,
  getInvoice,
  updateOrderStatus,
  uploadOrderProof,
  getCpanelLoginUrl,
  renewOrder,
  deleteOrder,
  getServiceStatus,
  changeHostingPassword,
  suspendService,
  unsuspendService,
  terminateService
} = require('../controllers/hostingOrderController');

const router = express.Router();

router.get('/plans', getPlans);
router.post('/orders', protect, denyRoles('technician'), createOrder);
router.post('/orders/staff-create', protect, restrictTo('admin', 'staff'), staffCreateHostingAccount);
router.get('/orders', protect, denyRoles('technician'), getOrders);
router.get('/orders/admin-overview', protect, restrictTo('admin'), getAdminOverview);
router.get('/orders/admin-summary', protect, restrictTo('admin'), getHostingOrdersAdminSummary);
// T68 — the manual build queue. Declared before '/orders/:id' or Express reads
// "awaiting-provisioning" as an id.
router.get('/orders/awaiting-provisioning', protect, restrictTo('admin', 'staff'), getAwaitingProvisioning);
router.patch('/orders/:id/mark-provisioned', protect, restrictTo('admin', 'staff'), markProvisioned);
router.get('/orders/by-reference/:reference', protect, denyRoles('technician'), getOrderByReference);
router.get('/orders/:id/invoice', protect, denyRoles('technician'), getInvoice);
router.get('/orders/:id/cpanel-login', protect, denyRoles('technician'), getCpanelLoginUrl);
router.get('/orders/:id/status', protect, denyRoles('technician'), getServiceStatus);
router.get('/orders/:id', protect, denyRoles('technician'), getOrder);
router.post('/orders/:id/proof', protect, denyRoles('technician'), upload.single('proof'), uploadOrderProof);
router.post('/orders/:id/renew', protect, denyRoles('technician'), renewOrder);
router.post('/orders/:id/password', protect, denyRoles('technician'), changeHostingPassword);
router.post('/orders/:id/suspend', protect, restrictTo('admin'), suspendService);
router.post('/orders/:id/unsuspend', protect, restrictTo('admin'), unsuspendService);
router.post('/orders/:id/terminate', protect, restrictTo('admin'), terminateService);
router.patch('/orders/:id', protect, restrictTo('admin'), updateOrderStatus);
router.delete('/orders/:id', protect, restrictTo('admin'), deleteOrder);

module.exports = router;
