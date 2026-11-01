'use strict';

/**
 * Publishes the exchange rates the balance sheet values foreign holdings at.
 *
 * The Central Bank of Egypt's own page sits behind a WAF that rejects
 * automated requests, so this reads open.er-api.com, which exists to be called
 * by programs. Its figures are market mid rates — close to the CBE's official
 * sell price, but not the same number.
 *
 * No dependencies, so the scheduled workflow needs no install step.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'rates.json');
const SOURCE = 'open.er-api.com';

async function rateToEgp(base) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${base}: HTTP ${res.status}`);

  const body = await res.json();
  if (body.result !== 'success') throw new Error(`${base}: ${body['error-type'] || 'unsuccessful response'}`);

  const rate = body.rates && body.rates.EGP;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`${base}: no usable EGP rate in the response`);
  return { rate, updated: body.time_last_update_utc };
}

async function main() {
  const [usd, eur] = await Promise.all([rateToEgp('USD'), rateToEgp('EUR')]);

  // A garbage rate would silently rewrite every foreign holding, so refuse
  // anything that cannot plausibly be an EGP rate rather than publish it.
  for (const [name, rate] of [['USD', usd.rate], ['EUR', eur.rate]]) {
    if (rate < 5 || rate > 500) throw new Error(`${name}/EGP of ${rate} is outside the plausible range; refusing to publish.`);
  }

  const payload = {
    usd: Number(usd.rate.toFixed(4)),
    eur: Number(eur.rate.toFixed(4)),
    source: SOURCE,
    sourceUpdated: usd.updated,
    fetched: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\n  USD/EGP ${payload.usd}    EUR/EGP ${payload.eur}    (${SOURCE})\n`);
}

main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });
