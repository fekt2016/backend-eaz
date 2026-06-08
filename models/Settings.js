const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // ── Maintenance ────────────────────────────────────────────
  maintenanceMode:           { type: Boolean, default: false },
  maintenanceMessage:        { type: String,  default: "We're performing scheduled maintenance. We'll be back shortly!" },
  maintenanceScheduledStart: { type: Date,    default: null },
  maintenanceScheduledEnd:   { type: Date,    default: null },
}, { timestamps: true });

/**
 * Compute whether maintenance is currently active based on:
 *  1. maintenanceMode manually set to true, OR
 *  2. Current time falls within the scheduled window
 */
settingsSchema.virtual('maintenanceActive').get(function () {
  const now = new Date();
  if (this.maintenanceMode) return true;
  if (this.maintenanceScheduledStart && this.maintenanceScheduledEnd) {
    return now >= this.maintenanceScheduledStart && now <= this.maintenanceScheduledEnd;
  }
  if (this.maintenanceScheduledStart && !this.maintenanceScheduledEnd) {
    return now >= this.maintenanceScheduledStart;
  }
  return false;
});

settingsSchema.set('toJSON',   { virtuals: true });
settingsSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Settings', settingsSchema);
