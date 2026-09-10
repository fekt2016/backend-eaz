/**
 * Shared dependencies, config and helpers for the hosting order controllers.
 *
 * hostingOrderController.js was one 1,197-line file spanning the plan
 * catalogue, buying and renewing, what an owner may do with a live account, and
 * admin fulfilment. It is now split into
 * controllers/hosting/<domain>Controller.js, each pulling what it needs from
 * here. `controllers/hostingOrderController.js` re-exports every handler so the
 * route file is unaffected — the shape posController and orderController use.
 *
 * Moved verbatim; no logic was rewritten.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const Paystack = require('@paystack/paystack-sdk');
const streamifier = require('streamifier');
const HostingOrder = require('../../models/HostingOrder');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, sanitizeDomain } = require('../../utils/sanitize');
const { getPlanPrice, HOSTING_PLANS, PLAN_AVAILABILITY, isSellable } = require('../../config/hostingPlans');
const namecheap = require('../../services/namecheap');
const { cloudinary } = require('../../config/cloudinary');
const { sendOrderConfirmation, sendPaymentReceived, sendHostingCredentials } = require('../../utils/hostingEmail');
const { provisionHostingAccount } = require('../../utils/provisionHosting');
const { buildInvoiceBuffer } = require('../../utils/hostingInvoice');
const { escapeRegex } = require('../../utils/regex');
const { extractTLD } = require('../../utils/domainHelper');
const whm = require('../../services/whm');
const { logFromRequest, ACTIONS, RESOURCES } = require('../../services/activityLogService');

const paystackSecret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_KEY;
let paystack;
if (paystackSecret && paystackSecret.startsWith('sk_')) {
  paystack = new Paystack(paystackSecret);
} else {
  console.warn('⚠️  Paystack secret key not configured. Set PAYSTACK_SECRET or PAYSTACK_KEY (sk_...) for Card/Mobile Money.');
}

const FRONTEND_URL = require("../../utils/frontendUrl")();


function computeAddonsTotal(addons) {
  if (!Array.isArray(addons)) return 0;
  return addons.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
}

module.exports = {
  // deps
  crypto, mongoose, Paystack, streamifier, HostingOrder,
  sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, sanitizeDomain,
  getPlanPrice, HOSTING_PLANS, PLAN_AVAILABILITY, isSellable,
  namecheap, cloudinary, whm,
  sendOrderConfirmation, sendPaymentReceived, sendHostingCredentials,
  provisionHostingAccount, buildInvoiceBuffer,
  escapeRegex, extractTLD,
  logFromRequest, ACTIONS, RESOURCES,
  paystack, FRONTEND_URL,
  // shared helper — used by both createOrder and staffCreateHostingAccount
  computeAddonsTotal,
};
