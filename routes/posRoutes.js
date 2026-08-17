const express = require('express');
const {
  createCustomer, getCustomers, getCustomer, updateCustomer,
  createJob, getJobs, getJob, updateJob,
  uploadJobPhoto, deleteJobPhoto,
  addPayment,
  getParts, createPart, updatePart, deletePart,
  scanLookup,
  createSale, getSales, getSale, voidSale,
  initiateMomoCharge, checkMomoCharge, initiateCardCharge,
  getStaff, createStaff,
  getTechnicians,
  getOverview, getMyOverview, getReportsAnalytics,
  getPartOrders, updatePartOrder, updateRepairOrder,
  getExpenses, createExpense, updateExpense, deleteExpense,
  triggerReminders, getUncollectedJobs,
  getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
  getWarrantyJobs,
} = require('../controllers/posController');
const { protect, restrictTo } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/heic'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Images only.'), allowed.includes(file.mimetype));
  },
});

const router = express.Router();

// All POS routes require authentication
router.use(protect);
router.use(restrictTo('superadmin', 'admin', 'staff', 'technician'));

// ── Overview / reports — shop-wide financials (superadmin + admin) ───────────
router.get('/overview', restrictTo('superadmin', 'admin'), getOverview);

// ── Reports & analytics — consolidated BI for the Reports dashboard ──────────
// superadmin/admin/staff can read reports (matches the sidebar visibility).
router.get('/reports/analytics', restrictTo('superadmin', 'admin', 'staff'), getReportsAnalytics);

// ── My dashboard — scoped to the logged-in user (all POS roles) ──────────────
// Staff: jobs they created + their sales + low stock. Technician: their jobs only.
router.get('/my-overview', getMyOverview);

// ── Repair part-orders — review & update status (superadmin + admin + staff) ──
router.get('/part-orders',       restrictTo('superadmin', 'admin', 'staff'), getPartOrders);
router.patch('/part-orders/:id', restrictTo('superadmin', 'admin', 'staff'), updatePartOrder);
router.patch('/repair-orders/:id', restrictTo('superadmin', 'admin', 'staff'), updateRepairOrder);

// ── Scanner lookup (all POS roles) ───────────────────────────────────────────
router.get('/scan/:code', scanLookup);

// ── Customers ────────────────────────────────────────────────────────────────
router.route('/customers').get(getCustomers).post(createCustomer);
router.route('/customers/:id').get(getCustomer).patch(updateCustomer);

// ── Repair jobs (all POS roles) ──────────────────────────────────────────────
router.route('/jobs').get(getJobs).post(createJob);
router.route('/jobs/:id').get(getJob).patch(updateJob);
router.post('/jobs/:id/photos', upload.single('photo'), uploadJobPhoto);
router.delete('/jobs/:id/photos/:photoId', restrictTo('superadmin', 'staff'), deleteJobPhoto);
router.post('/jobs/:id/payments', restrictTo('superadmin', 'staff', 'admin'), addPayment);

// Paystack MoMo charge — teller (staff), admin and superadmin only
router.post('/jobs/:id/momo-charge',            restrictTo('superadmin', 'staff', 'admin'), initiateMomoCharge);
router.get( '/jobs/:id/momo-charge/:reference', restrictTo('superadmin', 'staff', 'admin'), checkMomoCharge);

// Paystack card charge (in-store, staff-initiated) — teller, admin and superadmin only
router.post('/jobs/:id/card-charge',            restrictTo('superadmin', 'staff', 'admin'), initiateCardCharge);
router.get( '/jobs/:id/card-charge/:reference', restrictTo('superadmin', 'staff', 'admin'), checkMomoCharge);

// ── Sales (all POS roles) ────────────────────────────────────────────────────
router.route('/sales').get(getSales).post(createSale);
router.route('/sales/:id').get(getSale);
router.patch('/sales/:id/void', restrictTo('superadmin'), voidSale);

// ── Inventory (superadmin + staff + admin write; others read-only) ───────────
router.get('/inventory', getParts);
router.post('/inventory',         restrictTo('superadmin', 'staff', 'admin'), createPart);
router.patch('/inventory/:id',    restrictTo('superadmin', 'staff', 'admin'), updatePart);
router.delete('/inventory/:id',   restrictTo('superadmin', 'admin'),          deletePart);

// ── Suppliers (superadmin + staff + admin read; superadmin write) ────────────
router.get('/suppliers',      restrictTo('superadmin', 'staff', 'admin'), getSuppliers);
router.get('/suppliers/:id',  restrictTo('superadmin', 'staff', 'admin'), getSupplier);
router.post('/suppliers',     restrictTo('superadmin'), createSupplier);
router.patch('/suppliers/:id',  restrictTo('superadmin'), updateSupplier);
router.delete('/suppliers/:id', restrictTo('superadmin'), deleteSupplier);

// ── Expenses (superadmin only — write; superadmin + staff read) ──────────────
router.get('/expenses',     restrictTo('superadmin', 'staff'), getExpenses);
router.post('/expenses',    restrictTo('superadmin'), createExpense);
router.patch('/expenses/:id', restrictTo('superadmin'), updateExpense);
router.delete('/expenses/:id', restrictTo('superadmin'), deleteExpense);

// ── Uncollected reminders (superadmin + admin) ───────────────────────────────
router.get('/reminders/uncollected',  restrictTo('superadmin', 'admin', 'staff'), getUncollectedJobs);
router.post('/reminders/trigger',     restrictTo('superadmin', 'admin'), triggerReminders);

// ── Warranty tracking (superadmin + staff) ───────────────────────────────────
router.get('/warranty', restrictTo('superadmin', 'staff'), getWarrantyJobs);

// ── Staff management (superadmin only) ──────────────────────────────────────
router.get('/staff',  restrictTo('superadmin'), getStaff);
router.post('/staff', restrictTo('superadmin'), createStaff);

// ── Technicians list (all POS roles) — for assigning jobs ────────────────────
router.get('/technicians', getTechnicians);

module.exports = router;
