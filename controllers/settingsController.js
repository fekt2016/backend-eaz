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
    ];

    const updates = {};
    let touchedBusiness = false;
    for (const key of allowed) {
      if (key in req.body) {
        if (key === 'maintenanceMessage') {
          updates[key] = sanitizeMessage(req.body[key], 500) ?? null;
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
