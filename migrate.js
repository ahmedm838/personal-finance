// One-off: drop the exchange rates from Settings, and split Monthly Driving
// into "times per year" x "km each time".
const { load, save } = require('./lib/workbook');

// Read off the old free-text frequency; the product must reproduce the old
// monthly distance exactly, which is asserted below.
const SPLIT = {
  Work: { frequency: 240, km: 62 },            // 20 days per month
  Travelling: { frequency: 24, km: 400 },      // 2 times per month
  'Summer Trips': { frequency: 2, km: 1100 },  // 2 times per year
  'North Coast': { frequency: 5, km: 700 },    // 5 times per year
  Others: { frequency: 12, km: 250 },          // no note; was a monthly figure
};

(async () => {
  const { db } = await load();

  const before = db.DrivingMonthly.reduce((t, r) => t + (Number(r.distance_km) || 0), 0);

  const rates = db.Settings.filter((r) => r.key === 'usd_rate' || r.key === 'eur_rate');
  if (rates.length) {
    console.log('  removing from Settings:', rates.map((r) => r.key).join(', '));
    db.Settings = db.Settings.filter((r) => r.key !== 'usd_rate' && r.key !== 'eur_rate');
  }

  for (const r of db.DrivingMonthly) {
    const split = SPLIT[r.item];
    if (!split) throw new Error(`No split known for driving row "${r.item}"`);
    r.frequency = split.frequency;
    r.km = split.km;
    r.distance_km = split.km * split.frequency;
    delete r.remarks;
  }

  const perYear = db.DrivingMonthly.reduce((t, r) => t + r.distance_km, 0);
  const perMonth = perYear / 12;
  if (Math.abs(perMonth - before) > 0.01) {
    throw new Error(`Monthly distance changed: ${before} -> ${perMonth}. Refusing to save.`);
  }

  await save();
  console.log(`  driving: ${perYear} km/year = ${perMonth} km/month (unchanged)`);
  for (const r of db.DrivingMonthly) {
    console.log(`    ${r.item.padEnd(14)} ${String(r.frequency).padStart(4)} x ${String(r.km).padStart(5)} km = ${r.distance_km}`);
  }
  console.log('  settings left:', db.Settings.map((r) => r.key).join(', '));
})().catch((e) => { console.error('\n  ' + e.message + '\n'); process.exit(1); });
