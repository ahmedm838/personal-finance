'use strict';

/**
 * Publishes the exchange rates the balance sheet values foreign holdings at:
 * the Central Bank of Egypt's own sell price.
 *
 * The CBE's page is behind a WAF that rejects automated requests, so this
 * reads AllRatesToday's open-data mirror of the same published table, which
 * needs no key and carries the buy and sell columns unchanged. Attribution is
 * required by its licence and is shown in the app.
 *
 * No dependencies, so the scheduled workflow needs no install step.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'rates.json');
const SOURCE = 'https://raw.githubusercontent.com/AllRates-Today/central-bank-exchange-rates/main/data/cbe/latest.json';
const ATTRIBUTION = 'AllRatesToday (CC BY-NC 4.0)';

/** The sell price for one currency against the pound. */
function sellRate(body, base) {
  const row = (body.rates || []).find((r) => r.base === base && r.quote === 'EGP' && r.type === 'sell');
  const value = row && Number(row.value);

  // A wrong rate would silently rewrite every foreign holding, so refuse
  // anything that cannot plausibly be a pound rate rather than publish it.
  if (!Number.isFinite(value) || value < 5 || value > 500) {
    throw new Error(`No usable ${base} sell rate in the feed`);
  }
  return Number(value.toFixed(4));
}

async function main() {
  const res = await fetch(SOURCE, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = await res.json();
  if (body.source !== 'cbe') throw new Error(`Feed is for "${body.source}", not the CBE`);

  const payload = {
    usd: sellRate(body, 'USD'),
    eur: sellRate(body, 'EUR'),
    source: 'CBE sell rate',
    rateDate: body.date,
    attribution: ATTRIBUTION,
    fetched: new Date().toISOString(),
  };

  // fetched moves on every run, so comparing whole files would commit every
  // weekday whether or not a rate moved. Only the figures decide.
  let current = null;
  try { current = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }
  if (current && current.usd === payload.usd && current.eur === payload.eur) {
    console.log(`\n  USD ${payload.usd}    EUR ${payload.eur}    unchanged\n`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\n  USD ${payload.usd}    EUR ${payload.eur}    CBE sell, ${payload.rateDate}\n`);
}

main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });
