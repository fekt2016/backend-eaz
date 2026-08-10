const Settings = require('../models/Settings');
const { sanitizeMessage } = require('../utils/sanitize');

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
    ];

    const updates = {};
    for (const key of allowed) {
      if (key in req.body) {
        if (key === 'maintenanceMessage') {
          updates[key] = sanitizeMessage(req.body[key], 500) ?? null;
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

    res.status(200).json({
      success: true,
      data: {
        maintenanceMode:           settings.maintenanceMode,
        maintenanceActive:         settings.maintenanceActive,
        maintenanceMessage:        settings.maintenanceMessage,
        maintenanceScheduledStart: settings.maintenanceScheduledStart,
        maintenanceScheduledEnd:   settings.maintenanceScheduledEnd,
        updatedAt:                 settings.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSettings, updateSettings };
