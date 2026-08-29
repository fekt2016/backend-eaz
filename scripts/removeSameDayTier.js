/**
 * Drop the dormant `same_day` speed tier from every shipping zone.
 *
 *   node scripts/removeSameDayTier.js            # DRY RUN — prints the plan, writes nothing
 *   node scripts/removeSameDayTier.js --apply    # actually writes
 *
 * Why (T117): EazWorld sells three courier speeds — Standard, Next Day and
 * Express, where Express means dispatch starts now. `same_day` was a fourth,
 * kept switched off behind ShippingSettings.sameDayAvailable. Leaving it in the
 * data is not harmless: it duplicates Express's promise at the *cheaper*
 * next-day multiplier (1.2 against 1.5), so anyone flipping that switch would
 * put two "today" options side by side with the faster-sounding one costing
 * less. The seed no longer creates it; this removes it from zones already saved.
 *
 * Safe to run more than once — zones without the tier are left alone. Nothing
 * else on the zone is touched: base rates, per-kg rates, bands and the other
 * three tiers are untouched, and no order or quote is rewritten.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const ShippingZone = require('../models/ShippingZone');

const APPLY = process.argv.includes('--apply');
const TIER = 'same_day';

(async () => {
  const uri = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URL / MONGO_URI is not set.');
  await mongoose.connect(uri);

  const zones = await ShippingZone.find({ 'speedTiers.code': TIER }).select('zoneKey name speedTiers');
  console.log(`${zones.length} zone(s) carry a "${TIER}" tier.`);

  for (const zone of zones) {
    const before = zone.speedTiers.map((t) => t.code);
    const after = before.filter((c) => c !== TIER);
    console.log(`  ${zone.zoneKey || zone.name}: [${before.join(', ')}] -> [${after.join(', ')}]`);
    if (APPLY) {
      zone.speedTiers = zone.speedTiers.filter((t) => t.code !== TIER);
      await zone.save();
    }
  }

  console.log(APPLY ? 'Applied.' : 'Dry run — nothing written. Re-run with --apply.');
  await mongoose.disconnect();
})().catch((err) => { console.error(err.message); process.exit(1); });
