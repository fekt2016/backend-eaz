const { normalizePhone } = require('./phone');

/**
 * Build the Mongo `$or` that links shop Orders to a person.
 *
 * Shop orders are GUEST checkouts — they carry no `user` ref (see T84). The
 * only link back to an account is the contact details captured at checkout, so
 * "this person's orders" means "orders whose customer.email or customer.phone
 * matches theirs".
 *
 * Extracted from orderController.getMyOrders when the admin user-detail page
 * needed the same lookup for an arbitrary user. Two copies of this would drift,
 * and the drift would be silent: an admin would see a different set of orders
 * than the customer sees for themselves, with nothing to indicate which is
 * right. Behaviour is unchanged from the original.
 *
 * Returns null when there is nothing to match on — callers must treat that as
 * "no orders", NOT as "match everything". An empty $or array matches nothing in
 * Mongo but throws on some versions, and a missing filter would return the whole
 * collection; returning null forces the caller to be explicit.
 */
function buildCustomerOrderFilter({ email, phone } = {}) {
  const or = [];

  if (email) {
    or.push({ 'customer.email': String(email).toLowerCase() });
  }

  if (phone) {
    const digits = normalizePhone(phone);
    if (digits) {
      // New orders carry a normalized phoneDigits — the authoritative key.
      or.push({ 'customer.phoneDigits': digits });
      // Legacy orders only have the raw phone string; try common formats.
      const variants = new Set([phone, digits]);
      if (digits.startsWith('0')) {
        variants.add(`233${digits.slice(1)}`);
        variants.add(`+233${digits.slice(1)}`);
      }
      if (!/^0/.test(digits) && digits.startsWith('233')) {
        variants.add(`0${digits.slice(3)}`);
      }
      or.push({ 'customer.phone': { $in: [...variants] } });
    }
  }

  return or.length ? { $or: or } : null;
}

module.exports = { buildCustomerOrderFilter };
