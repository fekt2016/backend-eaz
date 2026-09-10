const Settings = require('../models/Settings');
const { sanitizeMessage } = require('../utils/sanitize');
const { logFromRequest, ACTIONS, RESOURCES } = require('../services/activityLogService');
const { clearBusinessProfileCache } = require('../utils/businessProfile');

/**
 * The shape both GET and PATCH return. Extracted because it was written out
 * twice already and a third copy (homeHero) is one more chance for the two to
 * drift — a field added to the read but forgotten on the write reads as "my save
 * did not stick" to whoever is editing.
 */
const toPublic = (settings) => ({
  maintenanceMode:           settings.maintenanceMode,
  maintenanceActive:         settings.maintenanceActive,
  maintenanceMessage:        settings.maintenanceMessage,
  maintenanceScheduledStart: settings.maintenanceScheduledStart,
  maintenanceScheduledEnd:   settings.maintenanceScheduledEnd,
  business:                  settings.business,
  homeHero:                  settings.homeHero,
  updatedAt:                 settings.updatedAt,
});

// ── Hero slide sanitisation ──────────────────────────────────────────────────
//
// Every field here is rendered on the public homepage, and two of them are more
// than text: `href` becomes a <Link href> and `image` becomes a next/image src.
// A slide is admin-authored, but "admin-authored" is not the same as "safe" —
// a pasted `javascript:` or an off-allowlist image host would either break the
// page or hand it to somebody else's server. So both are checked against a
// shape, not merely trimmed.
const MAX_HERO_SLIDES = 12;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ICON_NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

/** Site-relative paths only: '/services/seo' yes, '//evil.com' and 'javascript:' no. */
const isSitePath = (v) => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//');

// Hero images are rendered through next/image, which only accepts hosts listed
// in `remotePatterns` (next.config.mjs) and throws at render time on anything
// else. So an arbitrary https:// URL here would not merely look wrong — it would
// take the homepage down. Cloudinary is where POST /uploads puts files and is
// already on that allowlist; everything else has to be a file in the frontend's
// own public/ directory.
const CLOUDINARY_PREFIX = 'https://res.cloudinary.com/';
const isAllowedHeroImage = (v) => isSitePath(v) || v.startsWith(CLOUDINARY_PREFIX);

/**
 * @returns {{ slides: object[] } | { error: string }}
 */
function sanitizeHeroSlides(input) {
  if (!Array.isArray(input)) return { error: 'Hero slides must be an array.' };
  if (input.length === 0) {
    // Saving an empty array would leave the homepage with no hero at all, which
    // reads as a broken site rather than a deliberate edit.
    return { error: 'Keep at least one hero slide.' };
  }
  if (input.length > MAX_HERO_SLIDES) {
    return { error: `A maximum of ${MAX_HERO_SLIDES} hero slides is allowed.` };
  }

  const slides = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] || {};
    const label = `Slide ${i + 1}`;

    const service  = sanitizeMessage(String(raw.service  ?? ''), 60);
    const headline = sanitizeMessage(String(raw.headline ?? ''), 140);
    if (!service)  return { error: `${label}: a service label is required.` };
    if (!headline) return { error: `${label}: a headline is required.` };

    const href = String(raw.href ?? '/').trim().slice(0, 200);
    if (!isSitePath(href)) {
      return { error: `${label}: the link must be a path on this site, starting with "/".` };
    }

    const image = String(raw.image ?? '').trim().slice(0, 500);
    if (image && !isAllowedHeroImage(image)) {
      return { error: `${label}: use the upload button, or a path to an image already on the site (starting with "/").` };
    }

    const icon = String(raw.icon ?? '').trim();

    slides.push({
      // Unknown icon names are not an error — the frontend falls back to a
      // default icon, and refusing the whole save over a cosmetic field would
      // lose the admin's real edits.
      icon:        ICON_NAME.test(icon) ? icon : 'Palette',
      service,
      headline,
      description: sanitizeMessage(String(raw.description ?? ''), 400) ?? '',
      cta:         sanitizeMessage(String(raw.cta ?? ''), 60) ?? 'Learn more',
      href,
      image,
      accent:      HEX_COLOR.test(String(raw.accent ?? '')) ? String(raw.accent).trim() : '#F5A623',
      bg:          HEX_COLOR.test(String(raw.bg ?? ''))     ? String(raw.bg).trim()     : '#fffbf5',
    });
  }

  return { slides };
}

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

    res.status(200).json({ success: true, data: toPublic(settings) });
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
      'homeHero',
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
        } else if (key === 'homeHero' && req.body.homeHero && typeof req.body.homeHero === 'object') {
          // Dot-paths again, for the same merge reason as `business` below.
          if ('slides' in req.body.homeHero) {
            const result = sanitizeHeroSlides(req.body.homeHero.slides);
            if (result.error) {
              return res.status(400).json({ success: false, error: result.error });
            }
            updates['homeHero.slides']    = result.slides;
            updates['homeHero.updatedAt'] = new Date();
            updates['homeHero.updatedBy'] = req.user?._id || null;
          }
        } else if (key === 'business' && req.body.business && typeof req.body.business === 'object') {
          // Dot-path each field so an admin can PATCH one business field without
          // wiping the rest — `$set: { business: {...} }` would replace the whole
          // embedded subdocument instead of merging.
          const b = req.body.business;
          for (const f of ['shopName', 'shopPhone', 'whatsapp', 'email', 'location', 'hours', 'consultationPath']) {
            if (f in b) updates[`business.${f}`] = sanitizeMessage(String(b[f] ?? ''), 200) ?? '';
          }
          // Its own line because it is long-form: 20k, not the 200-char cap the
          // fields above share. Sanitised the same way — it reaches the model as
          // trusted instruction text, so markup has no business in it.
          if ('knowledge' in b) {
            updates['business.knowledge'] = sanitizeMessage(String(b.knowledge ?? ''), 20000) ?? '';
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
      // The slide array is a few KB of copy; an ActivityLog entry per save that
      // embedded it would grow the collection far faster than it is worth on a
      // 512MB heap. A count is what a reader of the log actually needs.
      changes: Object.entries(updates).map(([k, v]) => ({
        field: k,
        label: k,
        before: null,
        after: k === 'homeHero.slides' ? `${v.length} slide${v.length === 1 ? '' : 's'}` : v,
      })),
    });

    res.status(200).json({ success: true, data: toPublic(settings) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSettings, updateSettings };
