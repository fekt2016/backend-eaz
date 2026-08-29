const express = require('express');
const {
  createCustomer, getCustomers, getCustomer, updateCustomer,
  createJob, getJobs, getJob, updateJob,
  uploadJobPhoto, deleteJobPhoto,
  addPayment,
  getParts, createPart, updatePart, deletePart,
  scanLookup,
  createSale, getSales, getSalesSummary, getSale, voidSale,
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
const { protect, restrictTo, denyRoles } = require('../middleware/auth');
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
// T83 (owner, 2026-08-29): staff no longer read reports. This is shop-wide BI —
// revenue, margins, staff performance — which belongs with /overview at
// superadmin + admin. Staff keep /my-overview, which is scoped to their own work.
router.get('/reports/analytics', restrictTo('superadmin', 'admin'), getReportsAnalytics);

// ── My dashboard — scoped to the logged-in user (all POS roles) ──────────────
// Staff: jobs they created + their sales + low stock. Technician: their jobs only.
router.get('/my-overview', getMyOverview);

// ── Repair part-orders — review & update status (superadmin + admin + staff) ──
router.get('/part-orders',       restrictTo('superadmin', 'admin', 'staff'), getPartOrders);
router.patch('/part-orders/:id', restrictTo('superadmin', 'admin', 'staff'), updatePartOrder);
router.patch('/repair-orders/:id', restrictTo('superadmin', 'admin', 'staff'), updateRepairOrder);

// ── Scanner lookup (superadmin + admin + staff) ──────────────────────────────
// T83: roles.md marks lookup ❌ for technicians. `denyRoles` rather than
// `restrictTo` so staff/admin access is unchanged.
router.get('/scan/:code', denyRoles('technician'), scanLookup);

// ── Customers (technician excluded) ──────────────────────────────────────────
// T83: the blanket gate let a technician read the whole customer list and edit
// records. roles.md marks customers ❌ for technicians.
router.use('/customers', denyRoles('technician'));
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

// ── Sales — technician has no access; ringing up is superadmin + staff ───────
// T83: this was the real hole — `createSale` performed no role check of its own,
// so the blanket gate let a technician record a sale, moving stock and money.
// Admin keeps the reads (CAN_SEE_ALL_SALES covers admin) but does not take money
// at the counter, matching job payments and expenses. Confirmed with the product
// owner 2026-08-29; `roles.md` updated to match.
router.use('/sales', denyRoles('technician'));
router.route('/sales')
  .get(getSales)
  .post(restrictTo('staff'), createSale);
// Must precede '/sales/:id' — otherwise Express matches 'summary' as an id.
router.get('/sales/summary', getSalesSummary);
router.route('/sales/:id').get(getSale);
router.patch('/sales/:id/void', restrictTo('superadmin'), voidSale);

// ── Inventory (superadmin + admin write; staff read-only; technician none) ───
// T83: the read was open to every POS role; roles.md marks stock ❌ for technicians.
// Writes were open to staff too — owner decision 2026-08-29: stock is managed by
// admin, matching what roles.md already said ("Add / edit stock" ❌ for staff).
// Staff keep the read so they can look items up while serving a customer.
router.get('/inventory', denyRoles('technician'), getParts);
router.post('/inventory',         restrictTo('superadmin', 'admin'), createPart);
router.patch('/inventory/:id',    restrictTo('superadmin', 'admin'), updatePart);
router.delete('/inventory/:id',   restrictTo('superadmin', 'admin'),          deletePart);

// ── Suppliers (superadmin + admin read; superadmin write) ────────────────────
// T83 (owner, 2026-08-29): staff no longer read suppliers. This restores what
// roles.md already specified — "See suppliers" was ❌ for staff all along, and
// the route was the thing out of step (one of the T105 divergences).
router.get('/suppliers',      restrictTo('superadmin', 'admin'), getSuppliers);
router.get('/suppliers/:id',  restrictTo('superadmin', 'admin'), getSupplier);
router.post('/suppliers',     restrictTo('superadmin'), createSupplier);
router.patch('/suppliers/:id',  restrictTo('superadmin'), updateSupplier);
router.delete('/suppliers/:id', restrictTo('superadmin'), deleteSupplier);

// ── Expenses (superadmin + admin write; superadmin + admin + staff read) ─────
// T5 — admin was omitted from both by oversight; the app's pattern everywhere
// else is admin-inclusive, and staff could already read. Confirmed with the
// product owner 2026-08-26: admin gets full access.
router.get('/expenses',     restrictTo('superadmin', 'staff', 'admin'), getExpenses);
router.post('/expenses',    restrictTo('superadmin', 'admin'), createExpense);
router.patch('/expenses/:id', restrictTo('superadmin', 'admin'), updateExpense);
router.delete('/expenses/:id', restrictTo('superadmin', 'admin'), deleteExpense);

// ── Uncollected reminders (superadmin + admin) ───────────────────────────────
router.get('/reminders/uncollected',  restrictTo('superadmin', 'admin', 'staff'), getUncollectedJobs);
router.post('/reminders/trigger',     restrictTo('superadmin', 'admin'), triggerReminders);

// ── Warranty tracking (superadmin + admin) ───────────────────────────────────
// T83 (owner, 2026-08-29): staff no longer track warranty claims. Note this also
// *adds* admin, who was excluded before despite roles.md marking warranty ✅ for
// them — the row was wrong in both directions.
router.get('/warranty', restrictTo('superadmin', 'admin'), getWarrantyJobs);

// ── Staff management (superadmin only) ──────────────────────────────────────
router.get('/staff',  restrictTo('superadmin'), getStaff);
router.post('/staff', restrictTo('superadmin'), createStaff);

// ── Technicians list (all POS roles) — for assigning jobs ────────────────────
router.get('/technicians', getTechnicians);

module.exports = router;
