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

// ── Customers ────────────────────────────────────────────────────────────────
// T83: the blanket gate let a technician read the whole customer list and edit
// records. roles.md marks customers ❌ for technicians.
// T105 (owner, 2026-09-01): staff may SEARCH and CREATE customers — job intake
// silently creates a walk-in customer when booking a repair — but only admin may
// EDIT an existing record. Bigger granularity than T83's blanket rule, and the
// route comment here is the authority; roles.md has been updated to match.
router.use('/customers', denyRoles('technician'));
router.route('/customers').get(getCustomers).post(createCustomer);
router.route('/customers/:id').get(getCustomer).patch(restrictTo('superadmin', 'admin'), updateCustomer);

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
// Admin keeps the reads (CAN_SEE_ALL_SALES covers admin) but does not ring up
// retail sales at the register (that's superadmin + staff). Job payments and
// expenses are separate routes where admin DOES take money (see below — T105
// confirmed admin backstops the till). Confirmed with the product owner.
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
// T113 (owner, 2026-08-29): staff record their own spending. Who may *see* whose
// is scoped inside the controller — staff their own, admin theirs plus every
// staff member's, superadmin everything — and the same scope gates edit/delete,
// so an expense you cannot see is one you cannot touch.
router.get('/expenses',     restrictTo('superadmin', 'staff', 'admin'), getExpenses);
router.post('/expenses',    restrictTo('superadmin', 'admin', 'staff'), createExpense);
// Editing and deleting stay with admin: staff record spending, they do not revise
// it. The controller's scope still applies on top, so an admin cannot edit a
// superadmin's expense by guessing its id.
router.patch('/expenses/:id', restrictTo('superadmin', 'admin'), updateExpense);
router.delete('/expenses/:id', restrictTo('superadmin', 'admin'), deleteExpense);

// ── Uncollected reminders (superadmin + admin; staff may trigger) ────────────
router.get('/reminders/uncollected',  restrictTo('superadmin', 'admin', 'staff'), getUncollectedJobs);
// T105 (owner, 2026-09-01): staff may send collection reminders — the till follows
// up on devices ready for collection, as roles.md always said.
router.post('/reminders/trigger',     restrictTo('superadmin', 'admin', 'staff'), triggerReminders);

// ── Warranty tracking (superadmin + admin) ───────────────────────────────────
// T83 (owner, 2026-08-29): staff no longer track warranty claims. Note this also
// *adds* admin, who was excluded before despite roles.md marking warranty ✅ for
// them — the row was wrong in both directions.
router.get('/warranty', restrictTo('superadmin', 'admin'), getWarrantyJobs);

// ── Staff management (superadmin + admin) ───────────────────────────────────
// T105 (owner, 2026-09-01): admin may create staff — the shop manager hires and
// manages the floor, matching roles.md ("Create staff accounts" admin ✅).
router.get('/staff',  restrictTo('superadmin', 'admin'), getStaff);
router.post('/staff', restrictTo('superadmin', 'admin'), createStaff);

// ── Technicians list (all POS roles) — for assigning jobs ────────────────────
router.get('/technicians', getTechnicians);

module.exports = router;
