/**
 * The plan catalogue and its prices.
 *
 * Split out of controllers/hostingOrderController.js, which re-exports these
 * so the route file is unchanged. Moved verbatim.
 */
const {
  HOSTING_PLANS, PLAN_AVAILABILITY,
} = require("./common");


/**
 * GET /api/v1/hosting/plans
 * Return plan config (public, no auth).
 */
const getPlans = async (req, res, next) => {
  try {
    // `cloud` and `email` cannot be delivered from a cPanel reseller plan at all,
    // so they are not advertised — a catalogue entry is a promise. `vps` IS
    // returned: its prices are shown as indicative and the card asks for an
    // enquiry (plan.availability === 'enquiry'), which is why availability
    // travels with the plan instead of being re-decided in the storefront.
    const sellable = Object.fromEntries(
      Object.entries(HOSTING_PLANS).filter(
        ([planType]) => PLAN_AVAILABILITY[planType] !== 'unavailable'
      )
    );
    return res.status(200).json({ success: true, data: sellable });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPlans,
};
