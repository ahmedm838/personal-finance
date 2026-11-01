'use strict';

/** Reconciles the imported database against the original workbook's figures. */

// The rates the original workbook valued foreign holdings at. They are no
// longer in Settings, and the live ones move daily, so reconciling against
// the original has to pin them here.
const ORIGINAL_RATES = { usd: 55.85, eur: 62.3174, source: 'original workbook' };

const { load } = require('../lib/workbook');
const { compute, tableTotals } = require('../lib/compute');

const EXPECTED = [
  ['Current assets', 5404581.024],
  ['Non-current assets', 31800000],
  ['Assets total', 37204581.024],
  ['Current liabilities', 70000],
  ['Non-current liabilities', 1436000],
  ['Liabilities total', 1506000],
  ['Capital total', 9378000],
  ['Equity', 35698581.024],
  ['Profit & loss', 26320581.024],
  ['EGP deposits', 3500000],
  ['USD deposits (USD)', 22000],
  ['USD deposits (EGP)', 1228700],
  ['Expenses total', 120000],
  ['Bills total', 6845.333333333333],
  ['Annual fees total', 600000],
  ['KM per month', 2765],
  ['Fuel cost', 6436.92],
  ['Furniture total', 300000],
  ['Debts total', 1400000],
];

(async () => {
  const { db } = await load({ force: true });
  const { balance, derived } = compute(db, ORIGINAL_RATES);

  const actual = {
    'Current assets': balance.assets[0].total,
    'Non-current assets': balance.assets[1].total,
    'Assets total': balance.totals.assets,
    'Current liabilities': balance.liabilities[0].total,
    'Non-current liabilities': balance.liabilities[1].total,
    'Liabilities total': balance.totals.liabilities,
    'Capital total': balance.totals.capital,
    Equity: balance.summary.equity,
    'Profit & loss': balance.summary.profit,
    'EGP deposits': derived.egpDeposits,
    'USD deposits (USD)': derived.usdDeposits,
    'USD deposits (EGP)': derived.usdDepositsEgp,
    'Expenses total': derived.expensesTotal,
    'Bills total': derived.billsTotal,
    'Annual fees total': derived.annualFeesTotal,
    'KM per month': derived.kmPerMonth,
    'Fuel cost': derived.fuelCost,
    'Furniture total': tableTotals('Furniture', db.Furniture).amount,
    'Debts total': tableTotals('Debts', db.Debts).amount,
  };

  let bad = 0;
  const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  for (const [label, want] of EXPECTED) {
    const got = actual[label];
    const ok = Math.abs(got - want) < 0.01;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(24)} ${fmt(got).padStart(16)}  (expected ${fmt(want)})`);
  }

  console.log(`\n${EXPECTED.length - bad}/${EXPECTED.length} reconciled`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
