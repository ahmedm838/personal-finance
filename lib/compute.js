'use strict';

const { tables, balanceSheet } = require('./schema');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const sum = (rows, key) => rows.reduce((t, r) => t + num(r[key]), 0);
const floorTo = (v, step) => Math.floor(v / step) * step;
const ceilTo = (v, step) => Math.ceil(v / step) * step;

function settingsMap(rows) {
  const m = {};
  for (const r of rows || []) if (r.key) m[r.key] = num(r.value);
  return m;
}

function dayOfMonth(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? Number(m[3]) : null;
}

/**
 * Derives every calculated value from the stored inputs.
 *
 * Order matters: deposits feed the ledger entries, the ledger feeds the balance
 * sheet, and bills/fees/fuel feed the monthly expense lines.
 */
function compute(db, rates) {
  const s = settingsMap(db.Settings);
  // A published rate wins; the Settings figures are the fallback when the
  // scheduled fetch has not run or could not reach the source.
  const live = rates && Number.isFinite(rates.usd) && Number.isFinite(rates.eur) ? rates : null;
  const usdRate = live ? live.usd : s.usd_rate || 0;
  const eurRate = live ? live.eur : s.eur_rate || 0;

  // --- Deposits -----------------------------------------------------------
  for (const name of ['DepositsEGP', 'DepositsUSD']) {
    for (const r of db[name] || []) {
      r.monthly = (num(r.amount) * num(r.rate)) / 12;
      r.day = dayOfMonth(r.start);
    }
  }
  const egpDeposits = sum(db.DepositsEGP, 'amount');
  const usdDeposits = sum(db.DepositsUSD, 'amount');

  // --- Furniture ----------------------------------------------------------
  // Totalled before the ledger, because a ledger entry can now link to it.
  for (const r of db.Furniture || []) r.amount = num(r.count) * num(r.price);
  const furnitureTotal = sum(db.Furniture, 'amount');

  // --- Ledger entries -----------------------------------------------------
  for (const r of db.Entries || []) {
    if (r.link === 'deposits_egp') r.amount = egpDeposits;
    else if (r.link === 'deposits_usd') r.amount = usdDeposits * usdRate;
    else if (r.link === 'furniture') r.amount = furnitureTotal;
    else if (r.currency === 'USD') r.amount = num(r.fx_amount) * usdRate;
    else if (r.currency === 'EUR') r.amount = num(r.fx_amount) * eurRate;
    // EGP rows keep their typed amount.
  }

  // --- Driving / fuel -----------------------------------------------------
  const kmPerMonth = sum(db.DrivingMonthly, 'distance_km');
  const fuelCost = (kmPerMonth / 100) * (s.litres_per_100km || 0) * (s.egp_per_litre || 0);

  // --- Expense roll-ups ---------------------------------------------------
  const billsTotal = sum(db.Bills, 'amount');
  const annualFeesTotal = sum(db.AnnualFees, 'amount');
  for (const r of db.Expenses || []) {
    if (r.link === 'annual_fees') r.amount = floorTo(annualFeesTotal / 12, 100);
    else if (r.link === 'bills') r.amount = ceilTo(billsTotal, 500);
    else if (r.link === 'fuel') r.amount = ceilTo(fuelCost, 100);
  }
  const expensesTotal = sum(db.Expenses, 'amount');
  for (const r of db.Expenses || []) {
    r.share = expensesTotal ? num(r.amount) / expensesTotal : 0;
  }

  // --- Simple per-row derivations ----------------------------------------

  for (const r of db.Macro || []) {
    const a = num(r.y2014);
    r.multiplier = a ? (num(r.y2026) - a) / a : null;
  }

  for (const r of db.CashFlow || []) {
    r.earnings = num(r.interest) + num(r.salary) + num(r.other_income);
    r.saving = r.earnings - num(r.expenses);
  }

  // --- Balance sheet ------------------------------------------------------
  const byAccount = {};
  for (const r of db.Entries || []) {
    byAccount[r.account] = (byAccount[r.account] || 0) + num(r.amount);
  }

  // A line is either an account name, or { account, label } when the balance
  // sheet calls it something other than the chart of accounts does.
  const buildSide = (groups) => groups.map((g) => {
    const lines = g.lines.map((line) => {
      const account = typeof line === 'string' ? line : line.account;
      return { label: typeof line === 'string' ? line : line.label || account, amount: byAccount[account] || 0 };
    });
    return { section: g.section, total: lines.reduce((t, l) => t + l.amount, 0), lines };
  });

  const assets = buildSide(balanceSheet.assets);
  const liabilities = buildSide(balanceSheet.liabilities);
  const assetsTotal = assets.reduce((t, g) => t + g.total, 0);
  const liabilitiesTotal = liabilities.reduce((t, g) => t + g.total, 0);
  const capitalTotal = sum(db.Capital, 'amount');

  const equity = assetsTotal - liabilitiesTotal;
  const profit = equity - capitalTotal;
  const startDate = (db.Settings || []).find((r) => r.key === 'start_date');
  const startMs = startDate && startDate.value ? Date.parse(String(startDate.value)) : NaN;
  const years = Number.isFinite(startMs) ? (Date.now() - startMs) / (365 * 24 * 3600 * 1000) : 0;
  const overYears = capitalTotal ? profit / capitalTotal : 0;

  return {
    balance: {
      asOf: new Date().toISOString().slice(0, 10),
      assets,
      liabilities,
      capital: (db.Capital || []).map((r) => ({ label: r.item, amount: num(r.amount) })),
      totals: { assets: assetsTotal, liabilities: liabilitiesTotal, capital: capitalTotal },
      summary: {
        capitalPaid: capitalTotal,
        equity,
        profit,
        overYears,
        years,
        averagePerYear: years ? overYears / years : 0,
      },
    },
    derived: {
      egpDeposits,
      usdDeposits,
      furnitureTotal,
      usdDepositsEgp: usdDeposits * usdRate,
      kmPerMonth,
      fuelCost,
      billsTotal,
      annualFeesTotal,
      expensesTotal,
      usdRate,
      eurRate,
      rateIsLive: Boolean(live),
      rateSource: live ? live.source : 'Settings',
      rateFetched: live ? live.fetched : null,
    },
  };
}

/** Column totals for a table, following the `totals` spec in the schema. */
function tableTotals(name, rows) {
  const def = tables[name];
  if (!def || !def.totals) return null;
  const out = {};
  for (const [key, how] of Object.entries(def.totals)) {
    if (how === 'sum') {
      out[key] = sum(rows, key);
    } else if (how.startsWith('wavg:')) {
      const weightKey = how.slice(5);
      const w = sum(rows, weightKey);
      out[key] = w ? rows.reduce((t, r) => t + num(r[key]) * num(r[weightKey]), 0) / w : 0;
    }
  }
  return out;
}

module.exports = { compute, tableTotals };
