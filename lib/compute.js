'use strict';

const { tables, balanceSheet } = require('./schema');

// Tracking began here. It is a fact about the past, not something to set.
const TRACKING_START = '2019-04-01';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const sum = (rows, key) => rows.reduce((t, r) => t + num(r[key]), 0);
const floorTo = (v, step) => Math.floor(v / step) * step;
const ceilTo = (v, step) => Math.ceil(v / step) * step;

function settingsMap(rows) {
  const m = {};
  for (const r of rows || []) if (r.key) m[r.key] = num(r.value);
  return m;
}

/** Same day of the month, n years on; 29 February falls back to the 28th. */
function addYears(iso, years) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  const n = Math.round(num(years));
  if (!m || !n) return null;

  const year = Number(m[1]) + n;
  const month = Number(m[2]);
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), lastOfMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
  const today = new Date().toISOString().slice(0, 10);

  // A rate typed into Settings wins outright: it is there for the hours when
  // the CBE has published a figure the mirror has not picked up yet. Blank
  // falls through to the feed, which is the normal case.
  const live = rates && Number.isFinite(rates.usd) && Number.isFinite(rates.eur) ? rates : null;
  const overridden = Boolean(s.usd_rate_override && s.eur_rate_override);
  const usdRate = overridden ? s.usd_rate_override : (live ? live.usd : 0);
  const eurRate = overridden ? s.eur_rate_override : (live ? live.eur : 0);

  const rateDate = overridden ? today : (live ? live.rateDate || null : null);
  const rateAgeDays = rateDate
    ? Math.round((Date.parse(today) - Date.parse(rateDate)) / 86_400_000)
    : null;

  // --- Deposits -----------------------------------------------------------
  for (const name of ['DepositsEGP', 'DepositsUSD']) {
    for (const r of db[name] || []) {
      r.monthly = (num(r.amount) * num(r.rate)) / 12;
      r.day = dayOfMonth(r.start);
      r.end = addYears(r.start, r.tenor);
      r.status = r.end ? (r.end >= today ? 'Running' : 'Matured') : '';
    }
  }
  const egpDeposits = sum(db.DepositsEGP, 'amount');
  const usdDeposits = sum(db.DepositsUSD, 'amount');

  const depositRows = [...(db.DepositsEGP || []), ...(db.DepositsUSD || [])];

  // Interest lands on the day of the month a deposit started, so what matters
  // is the schedule. The two currencies stay apart: they are not comparable
  // amounts, and converting one would hide what actually arrives.
  const byDay = new Map();
  for (const [table, currency] of [[db.DepositsEGP, 'egp'], [db.DepositsUSD, 'usd']]) {
    for (const r of table || []) {
      if (!Number.isFinite(r.day)) continue;
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day, egp: 0, usd: 0, count: 0, banks: new Set() });
      const row = byDay.get(r.day);
      row[currency] += num(r.monthly);
      row.count += 1;
      if (r.bank) row.banks.add(r.bank);
    }
  }

  const depositSummary = {
    schedule: [...byDay.values()].sort((a, b) => a.day - b.day).map((r) => ({ ...r, banks: r.banks.size })),
    egp: sum(db.DepositsEGP, 'monthly'),
    usd: sum(db.DepositsUSD, 'monthly'),
    count: depositRows.length,
    banks: new Set(depositRows.map((r) => r.bank).filter(Boolean)).size,
    // A deposit with no start date has no day to land on.
    undated: depositRows.filter((r) => !Number.isFinite(r.day)).length,
  };

  // --- Furniture and debts -------------------------------------------------
  // Totalled before the ledger, because a ledger entry can link to them.
  for (const r of db.Furniture || []) r.amount = num(r.count) * num(r.price);
  const furnitureTotal = sum(db.Furniture, 'amount');
  const debtsTotal = sum(db.Debts, 'amount');

  // --- Ledger entries -----------------------------------------------------
  for (const r of db.Entries || []) {
    if (r.link === 'deposits_egp') r.amount = egpDeposits;
    else if (r.link === 'deposits_usd') r.amount = usdDeposits * usdRate;
    else if (r.link === 'furniture') r.amount = furnitureTotal;
    else if (r.link === 'debts') r.amount = debtsTotal;
    else if (r.currency === 'USD') r.amount = num(r.fx_amount) * usdRate;
    else if (r.currency === 'EUR') r.amount = num(r.fx_amount) * eurRate;
    // An EGP row is already in pounds, so the two columns agree.
    else r.amount = num(r.fx_amount);
  }

  // --- Driving / fuel -----------------------------------------------------
  for (const r of db.DrivingMonthly || []) {
    r.round_km = num(r.km) * 2;
    r.distance_km = r.round_km * num(r.frequency);
  }
  const kmPerYear = sum(db.DrivingMonthly, 'distance_km');
  const kmPerMonth = kmPerYear / 12;

  // Fuel use is litres per 100 km, so the distance is scaled to match it.
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
  for (const r of db.Distances || []) r.round_km = num(r.distance_km) * 2;


  for (const r of db.Macro || []) {
    const a = num(r.y2014);
    r.multiplier = a ? (num(r.y2026) - a) / a : null;
  }

  // Only the first year is typed in. Deposits roll forward by what was added
  // the year before, and expenses grow by that year's inflation rate.
  let previous = null;
  for (const r of db.CashFlow || []) {
    if (previous) {
      r.deposits = num(previous.deposits) + num(previous.added_deposits);
      r.expenses = Math.round((num(previous.expenses) * (1 + num(r.inf_rate))) / 1000) * 1000;
    }

    r.interest = (num(r.deposits) * num(r.rate)) / 12;
    r.earnings = num(r.interest) + num(r.salary) + num(r.other_income);
    r.saving = r.earnings - num(r.expenses);
    r.yearly_saving = r.saving * 12;
    r.spending = r.yearly_saving - num(r.added_deposits) - num(r.to_be_invested);
    previous = r;
  }

  // What comes in each month: this year's salary from the projection, plus
  // the interest the deposits actually pay.
  const thisYear = String(new Date().getFullYear());
  const yearRow = (db.CashFlow || []).find((r) => String(r.year || '').endsWith(thisYear));
  const monthlySalary = yearRow ? num(yearRow.salary) : 0;
  const depositInterest = depositSummary.egp + depositSummary.usd * usdRate;
  const monthlyEarnings = monthlySalary + depositInterest;

  // The outlook picks up where the projection leaves off.
  const lastYear = (db.CashFlow || [])[(db.CashFlow || []).length - 1];
  const outlook = {
    Deposits: lastYear ? num(lastYear.deposits) + num(lastYear.added_deposits) : 0,
    Invested: sum(db.CashFlow, 'to_be_invested'),
  };
  for (const r of db.Horizon || []) {
    if (r.item in outlook) r.value = outlook[r.item];
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
  const years = (Date.now() - Date.parse(TRACKING_START)) / (365 * 24 * 3600 * 1000);
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
      debtsTotal,
      usdDepositsEgp: usdDeposits * usdRate,
      monthlySalary,
      depositInterest,
      monthlyEarnings,
      kmPerYear,
      kmPerMonth,
      fuelCost,
      deposits: depositSummary,
      billsTotal,
      annualFeesTotal,
      expensesTotal,
      usdRate,
      eurRate,
      rateIsLive: overridden || Boolean(live),
      rateOverridden: overridden,
      rateFetched: live ? live.fetched : null,
      rateDate,
      rateAgeDays,
      rateAttribution: overridden ? null : (live ? live.attribution || null : null),
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
