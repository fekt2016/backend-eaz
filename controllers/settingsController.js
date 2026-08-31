const Settings = require('../models/Settings');
const { sanitizeMessage } = require('../utils/sanitize');
const { logFromRequest, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { clearBusinessProfileCache } = require('../utils/businessProfile');

/**
 * GET /api/v1/settings
 * Public — returns current site settings (used by middleware for maintenance check)
 */
const getSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne({ key: 'global' });
    if (!settings) {
      settings = await Settings.create({ key: 'global' });
    }

    res.status(200).json({
      success: true,
      data: {
        maintenanceMode:           settings.maintenanceMode,
        maintenanceActive:         settings.maintenanceActive,
        maintenanceMessage:        settings.maintenanceMessage,
        maintenanceScheduledStart: settings.maintenanceScheduledStart,
        maintenanceScheduledEnd:   settings.maintenanceScheduledEnd,
        business:                  settings.business,
        updatedAt:                 settings.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/settings
 * Admin only — update site settings
 */
const updateSettings = async (req, res, next) => {
  try {
    const allowed = [
      'maintenanceMode',
      'maintenanceMessage',
      'maintenanceScheduledStart',
      'maintenanceScheduledEnd',
      'business',
      'pricing',
    ];

    const updates = {};
    let touchedBusiness = false;
    for (const key of allowed) {
      if (key in req.body) {
        if (key === 'maintenanceMessage') {
          updates[key] = sanitizeMessage(req.body[key], 500) ?? null;
        } else if (key === 'pricing' && req.body.pricing && typeof req.body.pricing === 'object') {
          // Dot-paths for the same reason as `business` below: a PATCH of one
          // knob must not wipe the other.
          //
          // Validated HERE as well as in the schema, because these two numbers
          // set every domain and hosting price in the shop. A typo — 155 instead
          // of 15.5, or a markup of 0.2 instead of 1.2 — would either 10x every
          // price or sell everything below cost, and the second is not
          // recoverable once orders land.
          const pr = req.body.pricing;
          if ('usdToGhsRate' in pr) {
            const rate = Number(pr.usdToGhsRate);
            if (!Number.isFinite(rate) || rate < 1 || rate > 1000) {
              return res.status(400).json({
                success: false,
                error: 'Exchange rate must be a number between 1 and 1000.',
              });
            }
            updates['pricing.usdToGhsRate'] = rate;
          }
          if ('domainMarkup' in pr) {
            const markup = Number(pr.domainMarkup);
            if (!Number.isFinite(markup) || markup < 1 || markup > 10) {
              return res.status(400).json({
                success: false,
                error: 'Markup must be between 1 and 10. Below 1 would sell domains below cost.',
              });
            }
            updates['pricing.domainMarkup'] = markup;
          }
          if (Object.keys(updates).some((k) => k.startsWith('pricing.'))) {
            updates['pricing.updatedAt'] = new Date();
            updates['pricing.updatedBy'] = req.user?._id || null;
          }
        } else if (key === 'business' && req.body.business && typeof req.body.business === 'object') {
          // Dot-path each field so an admin can PATCH one business field without
          // wiping the rest — `$set: { business: {...} }` would replace the whole
          // embedded subdocument instead of merging.
          const b = req.body.business;
          for (const f of ['shopName', 'shopPhone', 'whatsapp', 'email', 'location', 'hours', 'consultationPath']) {
            if (f in b) updates[`business.${f}`] = sanitizeMessage(String(b[f] ?? ''), 200) ?? '';
          }
          // Tax / VAT (T14) — display-only fields, not read into any order/invoice total math.
          if ('vatEnabled' in b)       updates['business.vatEnabled']      = !!b.vatEnabled;
          if ('pricesIncludeVat' in b) updates['business.pricesIncludeVat'] = !!b.pricesIncludeVat;
          if ('vatRate' in b)          updates['business.vatRate']         = Math.min(100, Math.max(0, Number(b.vatRate) || 0));
          if ('vatNumber' in b)        updates['business.vatNumber']       = sanitizeMessage(String(b.vatNumber ?? ''), 50) ?? '';
          if (Array.isArray(b.services)) {
            updates['business.services'] = b.services
              .filter((s) => s && s.name && s.price && s.path)
              .map((s) => ({
                name:  sanitizeMessage(String(s.name), 100)  ?? '',
                price: sanitizeMessage(String(s.price), 100) ?? '',
                path:  sanitizeMessage(String(s.path), 200)  ?? '',
              }));
          }
          touchedBusiness = true;
        } else {
          // Allow explicit null to clear date fields
          updates[key] = req.body[key] === '' ? null : req.body[key];
        }
      }
    }

    const settings = await Settings.findOneAndUpdate(
      { key: 'global' },
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    );

    if (touchedBusiness) clearBusinessProfileCache();

    // Drop the pricing cache so the new rate/markup is live immediately. Without
    // this an admin would save, see the old prices for up to the TTL, and
    // reasonably conclude the save had not worked.
    if (Object.keys(updates).some((k) => k.startsWith('pricing.'))) {
      require('../services/pricingSettings').invalidate();
    }

    await logFromRequest(req, {
      action: ACTIONS.SETTINGS_UPDATED,
      resourceType: RESOURCES.SETTINGS,
      resourceId: settings._id,
      resourceName: 'Global Settings',
      description: `Updated site settings (${Object.keys(updates).join(', ')})`,
      changes: Object.entries(updates).map(([k, v]) => ({ field: k, label: k, before: null, after: v })),
    });

    res.status(200).json({
      success: true,
      data: {
        maintenanceMode:           settings.maintenanceMode,
        maintenanceActive:         settings.maintenanceActive,
        maintenanceMessage:        settings.maintenanceMessage,
        maintenanceScheduledStart: settings.maintenanceScheduledStart,
        maintenanceScheduledEnd:   settings.maintenanceScheduledEnd,
        business:                  settings.business,
        updatedAt:                 settings.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSettings, updateSettings };
